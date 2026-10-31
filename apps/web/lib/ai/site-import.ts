import "server-only";
import type { AgentProfile } from "./autopilot-core";
import { IMPORT_MAX_CHARS, htmlToText, importSystemPrompt, interestingLinks, normalizeImport, pageMeta } from "./site-import-core";

/**
 * Wave 59 — reads the business's website (home page + up to 4 key pages: about, services, prices, contact,
 * FAQ) and lets the AI prepare the agent's profile. Public https sites only (no private / internal hosts),
 * bounded in size and time. Never throws.
 */
async function getPage(url: string): Promise<string | null> {
  try {
    const { assertPublicHttpsUrl } = await import("@/lib/net/safe-url");
    const u = await assertPublicHttpsUrl(url);
    const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SuperCoderCloudBot/1.0; +agent-setup)", Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok || !/text\/html|xhtml/i.test(res.headers.get("content-type") ?? "text/html")) return null;
    const final = new URL(res.url || u.toString());
    if (final.protocol !== "https:") return null;
    const buf = await res.arrayBuffer();
    return new TextDecoder("utf-8").decode(buf.slice(0, 800_000));
  } catch {
    return null;
  }
}

export function normalizeSiteUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 300) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s.replace(/^http:/i, "https:") : `https://${s}`);
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export async function importFromSite(input: { orgId: string; agentId: string; url: string; locale: string }): Promise<{ ok: true; profile: Partial<AgentProfile>; pages: number } | { ok: false; error: string }> {
  const url = normalizeSiteUrl(input.url);
  if (!url) return { ok: false, error: "siteImport.badUrl" };
  const home = await getPage(url);
  if (!home) return { ok: false, error: "siteImport.unreachable" };
  const base = new URL(url);
  const meta = pageMeta(home);
  const more = await Promise.all(interestingLinks(home, base, 4).map((l) => getPage(l)));
  const texts = [htmlToText(home), ...more.filter((x): x is string => Boolean(x)).map(htmlToText)];
  const text = [meta.title && `Title: ${meta.title}`, meta.description && `Description: ${meta.description}`, ...texts].filter(Boolean).join("\n\n---\n\n").slice(0, IMPORT_MAX_CHARS);
  if (text.replace(/\s/g, "").length < 80) return { ok: false, error: "siteImport.empty" };
  const { runAISystem } = await import("./run-system");
  const out = await runAISystem({
    orgId: input.orgId,
    feature: "insights",
    agentId: input.agentId,
    system: importSystemPrompt(input.locale),
    messages: [{ role: "user", content: `Website: ${url}\n\n${text}` }],
    temperature: 0.2,
    maxTokens: 1800,
    patienceMs: 25_000,
  });
  if (!out.ok) return { ok: false, error: out.error ?? "siteImport.aiFailed" };
  const { extractJson } = await import("./site-json");
  const profile = normalizeImport(extractJson(out.text));
  if (!Object.keys(profile).length) return { ok: false, error: "siteImport.nothing" };
  return { ok: true, profile, pages: 1 + more.filter(Boolean).length };
}
