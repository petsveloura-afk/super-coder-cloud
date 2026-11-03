import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { analyze, analysisLine, normalizeExperiment, recommend, type Experiment } from "./experiments-core";
import { standup, type BoardItem } from "./coordination-core";
import { buildReport, detectAnomaly, morningBrief, type Anomaly, type Period } from "./reports-core";
import { dayKey, type Lang } from "./goals-core";

/**
 * Upgrade 7 / stages F–H — experiments, the shared board and reports, server side. Every function is scoped to one business and
 * fails soft: a missing table answers "migration_not_applied" (writes) or "nothing" (reads); the team keeps working as before.
 */
const db = () => createAdminClient();
const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|migration/i.test(e.message ?? ""));
const DAY = 86_400_000;

/* ------------------------------------------------------------------ experiments */
type ExpRow = { id: string; title: string; hypothesis: string; metric: string; owner_member_id: string | null; status: Experiment["status"]; baseline_rate: number | null; min_effect: number; min_days: number; a_name: string; b_name: string; a_trials: number; a_successes: number; b_trials: number; b_successes: number; started_at: string | null };
const toExp = (r: ExpRow): Experiment => ({ id: r.id, title: r.title, hypothesis: r.hypothesis, metric: r.metric, owner: r.owner_member_id, status: r.status, baseline_rate: r.baseline_rate === null ? null : Number(r.baseline_rate), min_effect: Number(r.min_effect), min_days: r.min_days, started_at: r.started_at, a: { name: r.a_name, trials: r.a_trials, successes: r.a_successes }, b: { name: r.b_name, trials: r.b_trials, successes: r.b_successes } });

export async function loadExperiments(orgId: string): Promise<{ rows: Experiment[]; available: boolean }> {
  try {
    const { data, error } = await db().from("team_experiments").select("id, title, hypothesis, metric, owner_member_id, status, baseline_rate, min_effect, min_days, a_name, b_name, a_trials, a_successes, b_trials, b_successes, started_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(50);
    if (error) return { rows: [], available: !missing(error) };
    return { rows: ((data ?? []) as ExpRow[]).map(toExp), available: true };
  } catch {
    return { rows: [], available: false };
  }
}

export async function proposeExperiment(orgId: string, raw: Record<string, unknown>, ctx: { source: "owner" | "agent"; memberId?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const n = normalizeExperiment(raw);
  if ("rejected" in n) return { ok: false, error: n.rejected };
  const { exp } = n;
  const { data, error } = await db().from("team_experiments").insert({ organization_id: orgId, title: exp.title, hypothesis: exp.hypothesis, metric: exp.metric, owner_member_id: ctx.memberId ?? null, status: ctx.source === "owner" ? "running" : "proposed", source: ctx.source, baseline_rate: exp.baseline_rate, min_effect: exp.min_effect, min_days: exp.min_days, a_name: exp.a_name, b_name: exp.b_name, started_at: ctx.source === "owner" ? new Date().toISOString() : null }).select("id").single();
  if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
  return { ok: true, id: data?.id as string };
}

export async function setExperimentStatus(orgId: string, id: string, status: "running" | "stopped" | "concluded"): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "running") patch.started_at = new Date().toISOString();
  if (status === "concluded") patch.concluded_at = new Date().toISOString();
  const { error } = await db().from("team_experiments").update(patch).eq("organization_id", orgId).eq("id", id);
  return error ? { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" } : { ok: true };
}

/* ------------------------------------------------------------------ board */
export async function loadBoard(orgId: string, lang: Lang, now = Date.now()) {
  const a = db();
  const [{ data: tasks }, { data: members }, notes] = await Promise.all([
    a.from("team_tasks").select("id, title, status, assignee_id, updated_at").eq("organization_id", orgId).gte("updated_at", new Date(now - 3 * DAY).toISOString()).order("updated_at", { ascending: false }).limit(200),
    a.from("team_members").select("id, name").eq("organization_id", orgId),
    a.from("team_board_notes").select("id, member_id, kind, title, detail, resolved, created_at").eq("organization_id", orgId).eq("resolved", false).order("created_at", { ascending: false }).limit(30).then((r) => (r.error ? { data: [] as never[], available: !missing(r.error) } : { data: r.data ?? [], available: true })),
  ]);
  const names: Record<string, string> = Object.fromEntries(((members ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const items: BoardItem[] = ((tasks ?? []) as { id: string; title: string; status: BoardItem["status"]; assignee_id: string | null; updated_at: string }[]).filter((t) => t.assignee_id).map((t) => ({ id: t.id, title: t.title, member: t.assignee_id!, status: t.status, kind: "task", updated_at: Date.parse(t.updated_at) }));
  return { standup: standup(items, names, now, lang), notes: notes.data as { id: string; member_id: string | null; kind: string; title: string; detail: string | null; created_at: string }[], available: notes.available, names };
}

export async function postNote(orgId: string, memberId: string | null, input: { title: string; kind: string; detail?: string }): Promise<{ ok: boolean; error?: string }> {
  const kind = ["blocker", "finding", "request", "status"].includes(input.kind) ? input.kind : "status";
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (title.length < 2) return { ok: false, error: "title" };
  const { error } = await db().from("team_board_notes").insert({ organization_id: orgId, member_id: memberId, kind, title, detail: input.detail?.slice(0, 2000) ?? null });
  return error ? { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" } : { ok: true };
}

/* ------------------------------------------------------------------ reports */
async function sumSeries(orgId: string, since: string, until: string) {
  const { measureSeries } = await import("./goals");
  const s = new Date(since).getTime();
  const from = dayKey(s);
  const get = async (m: "leads_new" | "conversations" | "deals_won" | "revenue_won" | "reviews_avg") => (await measureSeries(orgId, m, from, new Date(until).getTime()).catch(() => [])).filter((p) => p.day >= from && p.day < until.slice(0, 10));
  const [leads, conv, won, rev, rating] = await Promise.all([get("leads_new"), get("conversations"), get("deals_won"), get("revenue_won"), get("reviews_avg")]);
  const sum = (x: { value: number }[]) => x.reduce((a, p) => a + p.value, 0);
  return { leads: sum(leads), conversations: sum(conv), deals_won: sum(won), revenue: Math.round(sum(rev)), ...(rating.length ? { reviews_avg: Math.round((sum(rating) / rating.length) * 10) / 10 } : {}), series: { leads, conversations: conv } };
}

export async function makeReport(orgId: string, period: Period, lang: Lang, now = Date.now(), store = true) {
  const days = period === "week" ? 7 : 30;
  const end = dayKey(now);
  const curStart = dayKey(now - days * DAY);
  const prevStart = dayKey(now - 2 * days * DAY);
  const [cur, prev, wide] = await Promise.all([sumSeries(orgId, `${curStart}T00:00:00Z`, `${end}T00:00:00Z`), sumSeries(orgId, `${prevStart}T00:00:00Z`, `${curStart}T00:00:00Z`), sumSeries(orgId, `${dayKey(now - 35 * DAY)}T00:00:00Z`, `${end}T00:00:00Z`)]);
  const anomalies: Anomaly[] = [];
  for (const m of ["leads", "conversations"] as const) {
    const a = detectAnomaly(m, wide.series[m]);
    if (a) anomalies.push(a);
  }
  const { evaluateGoals } = await import("./goals");
  const goals = (await evaluateGoals(orgId, lang, now).catch(() => ({ views: [] as never[], available: false }))).views.filter((v) => v.goal.status === "active").map((v) => ({ title: v.goal.title, risk: v.forecast.risk, line: v.line }));
  const recs = recommend({ goalsAtRisk: goals.filter((g) => g.risk === "at_risk" || g.risk === "off_track").length }, lang);
  const { series: _s1, ...c } = cur;
  const { series: _s2, ...p } = prev;
  void _s1; void _s2;
  const report = buildReport({ period, cur: c, prev: p, anomalies, goals, recommendations: recs.map((r) => ({ title: r.title, why: r.why })), lang });
  let stored = false;
  if (store) {
    const { error } = await db().from("team_reports").upsert({ organization_id: orgId, kind: period, period_start: curStart, title: report.title, body: { sections: report.sections, figures: report.figures, anomalies }, text: report.text.slice(0, 20000) }, { onConflict: "organization_id,kind,period_start", ignoreDuplicates: true });
    stored = !error;
  }
  return { report, stored, anomalies };
}

export async function makeBrief(orgId: string, lang: Lang, now = Date.now()) {
  const a = db();
  const { evaluateGoals } = await import("./goals");
  const [{ views }, { count: approvals }, { count: stuck }] = await Promise.all([
    evaluateGoals(orgId, lang, now).catch(() => ({ views: [] as never[] })),
    a.from("team_approvals").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "pending"),
    a.from("deals").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "open").lt("updated_at", new Date(now - 7 * DAY).toISOString()),
  ]);
  const b = morningBrief({ goals: views.filter((v) => v.goal.status === "active").map((v) => ({ title: v.goal.title, risk: v.forecast.risk })), waitingApprovals: approvals ?? 0, stuckDeals: stuck ?? 0, lang });
  await a.from("team_reports").upsert({ organization_id: orgId, kind: "brief", period_start: dayKey(now), title: b.text.split("\n")[0]!.slice(0, 200), body: { items: b.items }, text: b.text }, { onConflict: "organization_id,kind,period_start", ignoreDuplicates: true });
  return b;
}

export async function latestReport(orgId: string, kind: "week" | "month" | "brief") {
  try {
    const { data, error } = await db().from("team_reports").select("title, period_start, text, body, created_at").eq("organization_id", orgId).eq("kind", kind).order("period_start", { ascending: false }).limit(1).maybeSingle();
    return error ? null : (data as { title: string; period_start: string; text: string; body: Record<string, unknown>; created_at: string } | null);
  } catch {
    return null;
  }
}

/** the daily plus-7 tick: goals snapshot / alert, the morning brief, the weekly report on Mondays, the monthly on the 1st (idempotent) */
export async function plus7Tick(orgId: string, lang: Lang, tz: string, now = Date.now()): Promise<void> {
  try {
    const { goalsTick } = await import("./goals");
    await goalsTick(orgId, lang, now);
    const local = new Date(new Date(now).toLocaleString("en-US", { timeZone: tz }));
    await makeBrief(orgId, lang, now).catch(() => undefined);
    if (local.getDay() === 1) await makeReport(orgId, "week", lang, now).catch(() => undefined);
    if (local.getDate() === 1) await makeReport(orgId, "month", lang, now).catch(() => undefined);
  } catch {
    /* optional */
  }
}

/* ------------------------------------------------------------------ tool dispatcher */
export async function runPlus7cTool(orgId: string, tool: string, args: Record<string, string | number>, ctx: { lang: Lang; memberId?: string | null }): Promise<ToolRun> {
  const { lang } = ctx;
  try {
    if (tool.startsWith("goals.")) {
      const { runGoalsTool } = await import("./goals");
      return runGoalsTool(orgId, tool, args, ctx);
    }
    if (tool === "experiments.list") {
      const { rows, available } = await loadExperiments(orgId);
      if (!available) return { ok: false, summary: "", error: "migration_not_applied" };
      if (!rows.length) return { ok: true, summary: "no experiments recorded", data: [] };
      return { ok: true, data: rows.map((e) => ({ id: e.id, title: e.title, status: e.status, metric: e.metric })), summary: rows.map((e) => `${e.title} [${e.status}] — ${analysisLine(analyze(e), e, lang)} (id ${e.id})`).join("; "), link: "/ai-team" };
    }
    if (tool === "experiments.propose") {
      const r = await proposeExperiment(orgId, args, { source: "agent", memberId: ctx.memberId ?? null });
      return r.ok ? { ok: true, summary: "experiment proposed — waiting for the owner to start it", data: { id: r.id }, link: "/ai-team" } : { ok: false, summary: "", error: r.error };
    }
    if (tool === "board.view") {
      const b = await loadBoard(orgId, lang);
      return { ok: true, data: { standup: b.standup, notes: b.notes }, summary: [...b.standup.lines, ...b.notes.map((n) => `[${n.kind}] ${n.title}`)].join("; ") || "the board is empty", link: "/ai-team" };
    }
    if (tool === "board.post") {
      const r = await postNote(orgId, ctx.memberId ?? null, { title: String(args.title ?? ""), kind: String(args.kind ?? "status"), detail: typeof args.detail === "string" ? args.detail : undefined });
      return r.ok ? { ok: true, summary: "posted on the board" } : { ok: false, summary: "", error: r.error ?? "failed" };
    }
    if (tool === "reports.latest") {
      const kind = args.period === "month" ? "month" : "week";
      const r = await latestReport(orgId, kind);
      return r ? { ok: true, summary: r.text.slice(0, 1800), data: { period_start: r.period_start } } : { ok: true, summary: "no stored report yet" };
    }
  } catch (e) {
    return { ok: false, summary: "", error: (e as Error).message.slice(0, 200) };
  }
  return { ok: false, summary: "", error: "unknown_tool" };
}
