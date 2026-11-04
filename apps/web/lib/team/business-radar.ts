import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { automatedContactIds } from "./tools";
import { EMPTY_RADAR, radarFindings, radarProposals, type RadarInput } from "./business-radar-core";
import { initiatives, type Proposal, type Signals } from "./insight-core";

/**
 * Wave 63 — loads the radar's numbers from the real data (best effort: a query that fails counts as
 * "nothing found", never as an error) and returns the proposals the existing initiatives do not cover.
 */
export async function loadRadarInput(orgId: string, tz: string): Promise<RadarInput> {
  const a = createAdminClient();
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const t = (v: string | null) => (v ? Date.parse(v) : 0);
  const input: RadarInput = JSON.parse(JSON.stringify(EMPTY_RADAR));

  // conversations: hot leads waiting + customers waiting more than 4 hours
  try {
    const { data } = await a.from("conversations").select("contact_id, lead_score, last_customer_at, last_human_at, last_ai_at, last_auto_at").eq("organization_id", orgId).eq("status", "open").gte("last_customer_at", iso(now - 3 * 86_400_000)).limit(300);
    const rows = (data ?? []) as { contact_id: string | null; lead_score: string | null; last_customer_at: string | null; last_human_at: string | null; last_ai_at: string | null; last_auto_at: string | null }[];
    const robots = await automatedContactIds(orgId, rows.map((r) => r.contact_id)).catch(() => new Set<string>());
    const waiting = rows.filter((r) => !(r.contact_id && robots.has(r.contact_id)) && t(r.last_customer_at) > Math.max(t(r.last_human_at), t(r.last_ai_at), t(r.last_auto_at)));
    const hours = (r: { last_customer_at: string | null }) => (now - t(r.last_customer_at)) / 3_600_000;
    const hot = waiting.filter((r) => r.lead_score === "hot" && hours(r) >= 1);
    input.hotLeadsWaiting = { count: hot.length, oldestHours: hot.reduce((m, r) => Math.max(m, hours(r)), 0) };
    const long = waiting.filter((r) => hours(r) >= 4);
    input.longWaiting = { count: long.length, oldestHours: long.reduce((m, r) => Math.max(m, hours(r)), 0) };
  } catch {
    /* nothing found */
  }

  // leads yesterday vs average (same source the existing initiative uses)
  try {
    const { metricsFor } = await import("@/lib/agents/run");
    const m = await metricsFor(orgId, tz);
    input.leadsYesterday = m.y.leads;
    input.leadsAvg = m.avg.leads;
    input.leadsAvgDays = m.avg.leads > 0 ? 7 : 0;
  } catch {
    /* metrics are best effort */
  }

  // dormant open deals, with the money in them (the currency most deals use)
  try {
    const { data } = await a.from("deals").select("value, currency, updated_at").eq("organization_id", orgId).eq("status", "open").lt("updated_at", iso(now - 7 * 86_400_000)).limit(500);
    const rows = (data ?? []) as { value: number | string | null; currency: string | null; updated_at: string }[];
    const cur = dominantCurrency(rows.map((r) => r.currency));
    const same = rows.filter((r) => (r.currency ?? "ILS") === cur);
    input.dormantDeals = { count: rows.length, amount: same.reduce((s, r) => s + Number(r.value ?? 0), 0), currency: cur, oldestDays: rows.reduce((m, r) => Math.max(m, Math.floor((now - t(r.updated_at)) / 86_400_000)), 0) };
  } catch {
    /* nothing found */
  }

  // overdue invoices, with the money
  try {
    const today = new Date(now).toISOString().slice(0, 10);
    const { data } = await a.from("documents").select("total, currency, due_date").eq("organization_id", orgId).eq("kind", "invoice").in("status", ["sent", "accepted"]).lt("due_date", today).limit(500);
    const rows = (data ?? []) as { total: number | string | null; currency: string | null; due_date: string | null }[];
    const cur = dominantCurrency(rows.map((r) => r.currency));
    const same = rows.filter((r) => (r.currency ?? "ILS") === cur);
    input.overdueDebts = { count: rows.length, amount: same.reduce((s, r) => s + Number(r.total ?? 0), 0), currency: cur, maxDaysLate: rows.reduce((m, r) => Math.max(m, r.due_date ? Math.floor((now - Date.parse(`${r.due_date}T00:00:00Z`)) / 86_400_000) : 0), 0) };
  } catch {
    /* nothing found */
  }
  return input;
}

function dominantCurrency(list: (string | null)[]): string {
  const c = new Map<string, number>();
  for (const x of list) c.set(x ?? "ILS", (c.get(x ?? "ILS") ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ILS";
}

/** Extra proposals for today: what the radar found that `initiatives()` has not already proposed. */
export async function radarInitiatives(orgId: string, tz: string, day: string, signals: Signals): Promise<Proposal[]> {
  try {
    const existing = initiatives(signals, day);
    return radarProposals(radarFindings(await loadRadarInput(orgId, tz), day), existing, 3);
  } catch {
    return [];
  }
}
