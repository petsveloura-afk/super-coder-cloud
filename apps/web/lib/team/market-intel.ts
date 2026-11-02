import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { changesBrief, diffScans, externalContent, findingKey, isPublicSourceUrl, MARKET_RULES, normalizeFinding, scanDay, searchAvailability, splitScans, type StoredFinding } from "./market-intel-core";

/**
 * Upgrade 4 — market intelligence executors. Public sources only; every query is scoped to the business.
 * The ONLY search provider wired in is the Brave Search API, enabled by the BRAVE_SEARCH_API_KEY environment variable.
 * Its request / response shape was written from its public documentation and has NOT been exercised against the live
 * service from the build environment (no network there). With no key configured the tools say so and return no data.
 */
type Args = Record<string, string | number>;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export function configuredSearchProviders(): string[] {
  return [process.env.BRAVE_SEARCH_API_KEY ? "brave" : ""].filter(Boolean);
}

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

async function braveSearch(query: string): Promise<Hit[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
    headers: { Accept: "application/json", "X-Subscription-Token": String(process.env.BRAVE_SEARCH_API_KEY) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`search_http_${res.status}`);
  const j = (await res.json()) as { web?: { results?: { title?: unknown; url?: unknown; description?: unknown }[] } };
  return (j.web?.results ?? [])
    .map((r) => ({ title: s(r.title).slice(0, 160), url: s(r.url), snippet: s(r.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400) }))
    .filter((h) => isPublicSourceUrl(h.url).ok);
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
        const hits = await braveSearch(q);
        if (!hits.length) return { ok: true, summary: `no public results found for "${q}" at ${at}. Nothing was invented.` };
        const text = hits.map((h, i) => `${i + 1}. ${h.title} — ${h.snippet} (${h.url})`).join("\n");
        const ext = externalContent(text, { url: `search:${q}`, observedAt: at });
        return { ok: true, data: hits, summary: `${MARKET_RULES}\nSnippets only (pages were not opened). Read at ${at}.\n${ext.block}${ext.notice ? `\n${ext.notice}` : ""}` };
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
