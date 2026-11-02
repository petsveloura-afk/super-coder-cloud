import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { enabledProviders, parseBrave, parseDuckHtml, parseGoogleCse, parseSearxng, parseSerper, parseTavily, searxngInstances, duckBlocked, type SearchHit, type SearchProviderId } from "./search-providers-core";
import { changesBrief, diffScans, externalContent, findingKey, isPublicSourceUrl, MARKET_RULES, normalizeFinding, scanDay, searchAvailability, splitScans, type StoredFinding } from "./market-intel-core";

/**
 * Upgrade 4 / 4c — market intelligence executors. Public sources only; every query is scoped to the business.
 * Search runs through a failover chain (see search-providers-core.ts): Tavily, Serper, Brave, Google CSE and SearXNG
 * switch on when their environment variable is set; DuckDuckGo (keyless) is the safety net unless MARKET_SEARCH_KEYLESS=off.
 * Request / response shapes were written from the providers' public documentation and have NOT been exercised against the
 * live services from the build environment. A provider that fails or returns nothing is skipped; if all fail, the tool says so.
 */
type Args = Record<string, string | number>;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export function configuredSearchProviders(): string[] {
  return enabledProviders(process.env);
}

const PROVIDER_TIMEOUT_MS = 8_000;

async function callProvider(p: SearchProviderId, query: string): Promise<SearchHit[]> {
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  const q = encodeURIComponent(query);
  const json = async (res: Response) => {
    if (!res.ok) throw new Error(`${p}_http_${res.status}`);
    return (await res.json()) as unknown;
  };
  switch (p) {
    case "tavily":
      return parseTavily(await json(await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s(process.env.TAVILY_API_KEY)}` }, body: JSON.stringify({ query, max_results: 8, search_depth: "basic" }), signal })));
    case "serper":
      return parseSerper(await json(await fetch("https://google.serper.dev/search", { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": s(process.env.SERPER_API_KEY) }, body: JSON.stringify({ q: query, num: 8 }), signal })));
    case "brave":
      return parseBrave(await json(await fetch(`https://api.search.brave.com/res/v1/web/search?q=${q}&count=8`, { headers: { Accept: "application/json", "X-Subscription-Token": s(process.env.BRAVE_SEARCH_API_KEY) }, signal })));
    case "google_cse":
      return parseGoogleCse(await json(await fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(s(process.env.GOOGLE_CSE_API_KEY))}&cx=${encodeURIComponent(s(process.env.GOOGLE_CSE_ID))}&num=8&q=${q}`, { signal })));
    case "searxng": {
      for (const base of searxngInstances(process.env)) {
        try {
          const hits = parseSearxng(await json(await fetch(`${base}/search?q=${q}&format=json`, { headers: { Accept: "application/json" }, signal })));
          if (hits.length) return hits;
        } catch {
          /* try the next instance */
        }
      }
      return [];
    }
    case "duckduckgo": {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SuperCoderCloud/1.0)", Accept: "text/html" }, signal });
      if (!res.ok) throw new Error(`duckduckgo_http_${res.status}`);
      const html = await res.text();
      if (duckBlocked(html)) throw new Error("duckduckgo_blocked");
      return parseDuckHtml(html);
    }
  }
}

/** tries the enabled providers in order; the first one with results wins */
async function webSearch(query: string): Promise<{ hits: SearchHit[]; provider: string; tried: string[] }> {
  const tried: string[] = [];
  for (const p of enabledProviders(process.env)) {
    try {
      const hits = await callProvider(p, query);
      if (hits.length) return { hits, provider: p, tried };
      tried.push(`${p}:empty`);
    } catch (e) {
      tried.push(`${p}:${(e as Error).message.slice(0, 40)}`);
    }
  }
  return { hits: [], provider: "", tried };
}

export async function runMarketTool(orgId: string, tool: string, args: Args, ctx: { memberId?: string | null } = {}): Promise<ToolRun> {
  const db = createAdminClient();
  try {
    switch (tool) {
      case "market.scan": {
        const av = searchAvailability(configuredSearchProviders());
        if (!av.available) return { ok: false, summary: av.message, error: "web_search_unavailable" };
        const q = `${s(args.competitor)} ${s(args.query)}`.replace(/\s+/g, " ").trim().slice(0, 200);
        if (q.length < 3) return { ok: false, summary: "", error: "query_too_short" };
        const at = new Date().toISOString();
        const found = await webSearch(q);
        const hits = found.hits;
        if (!hits.length) return { ok: true, summary: `no public results found for "${q}" at ${at} (providers tried: ${found.tried.join(", ") || "none"}). Nothing was invented.` };
        const text = hits.map((h, i) => `${i + 1}. ${h.title} — ${h.snippet} (${h.url})`).join("\n");
        const ext = externalContent(text, { url: `search:${q}`, observedAt: at });
        return { ok: true, data: hits, summary: `${MARKET_RULES}\nSnippets only (pages were not opened). Source: ${found.provider} search. Read at ${at}.\n${ext.block}${ext.notice ? `\n${ext.notice}` : ""}` };
      }
      case "market.record": {
        const n = normalizeFinding({ ...args, competitor: args.competitor, observed_at: args.observed_at ?? new Date().toISOString() });
        if ("rejected" in n) return { ok: false, summary: "", error: `finding_rejected:${n.rejected}` };
        const f = n.finding;
        const { error } = await db.from("team_market_findings").insert({
          organization_id: orgId,
          competitor: f.competitor,
          kind: f.kind,
          subject: f.subject,
          subject_key: findingKey(f),
          summary: f.summary,
          value: f.value,
          currency: f.currency,
          source_url: f.source_url,
          source_kind: f.source_kind,
          observed_at: f.observed_at,
          scan_day: scanDay(f.observed_at),
          confidence: f.confidence,
          confidence_reason: f.confidence_reason,
          recorded_by: ctx.memberId ?? null,
        });
        if (error) return { ok: false, summary: "", error: /does not exist|schema cache|relation/i.test(error.message) ? "migration_not_applied" : error.message.slice(0, 200) };
        return { ok: true, summary: `finding recorded: ${f.competitor} — ${f.kind} — ${f.subject} (confidence ${f.confidence}: ${f.confidence_reason})` };
      }
      case "market.what_changed": {
        let q = db.from("team_market_findings").select("competitor, kind, subject, summary, value, currency, source_url, source_kind, observed_at, scan_day, confidence, confidence_reason").eq("organization_id", orgId).order("observed_at", { ascending: false }).limit(600);
        if (s(args.competitor)) q = q.ilike("competitor", `%${s(args.competitor).replace(/[%,()*]/g, " ").trim().slice(0, 80)}%`);
        const { data, error } = await q;
        if (error) return { ok: false, summary: "", error: /does not exist|schema cache|relation/i.test(error.message) ? "migration_not_applied" : error.message.slice(0, 200) };
        const rows = ((data ?? []) as (Omit<StoredFinding, "value" | "confidence"> & { value: number | string | null; confidence: number | string })[]).map((r) => ({ ...r, value: r.value === null ? null : Number(r.value), confidence: Number(r.confidence) })) as StoredFinding[];
        if (!rows.length) return { ok: true, summary: "no competitor findings recorded yet — nothing to compare. Run market.scan and record findings first." };
        const { prev, next, lastDay, prevDay } = splitScans(rows);
        if (!prev.length) return { ok: true, summary: `only one scan so far (${lastDay}, ${next.length} findings) — there is no earlier scan to compare with yet.` };
        const d = diffScans(prev, next);
        return { ok: true, data: d.changes.slice(0, 30), summary: `Compared scan ${lastDay} with earlier scans (latest earlier: ${prevDay}). ${d.changes.length} change(s), ${d.unchanged} unchanged.\n${changesBrief(d.changes)}` };
      }
      default:
        return { ok: false, summary: "", error: "unknown_tool" };
    }
  } catch (e) {
    return { ok: false, summary: "", error: (e as Error).message.slice(0, 300) };
  }
}
