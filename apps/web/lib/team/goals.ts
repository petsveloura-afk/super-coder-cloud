import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { GOAL_METRICS, alertLine, dayKey, forecast, forecastLine, goalAlert, goalsPrompt, normalizeGoal, type DailyPoint, type Forecast, type Goal, type GoalMetric, type Lang } from "./goals-core";

/**
 * Upgrade 7 / stage C — goals, server side. Scoped to one business (service role + organization_id on every query).
 * When the tables are not there yet (migration not run) nothing throws: reads give "nothing", writes answer
 * "migration_not_applied" and the team keeps working exactly as before.
 */
const db = () => createAdminClient();
const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|migration/i.test(e.message ?? ""));
const COLUMNS = "id, title, metric, baseline, target, start_date, due_date, owner_member_id, owner_user_id, status, source, last_risk";
const DAY = 86_400_000;

type Row = Omit<Goal, "baseline" | "target"> & { baseline: number | string; target: number | string };
const toGoal = (r: Row): Goal => ({ ...r, baseline: Number(r.baseline), target: Number(r.target) });

export async function loadGoals(orgId: string): Promise<{ rows: Goal[]; available: boolean }> {
  try {
    const { data, error } = await db().from("team_business_goals").select(COLUMNS).eq("organization_id", orgId).order("due_date", { ascending: true }).limit(100);
    if (error) return { rows: [], available: !missing(error) };
    return { rows: ((data ?? []) as Row[]).map(toGoal), available: true };
  } catch {
    return { rows: [], available: false };
  }
}

/** the daily values of a metric since `from` — measured from the CRM, never typed by a model */
export async function measureSeries(orgId: string, metric: GoalMetric, from: string, now = Date.now()): Promise<DailyPoint[]> {
  const a = db();
  const since = `${from}T00:00:00.000Z`;
  const until = new Date(now + DAY).toISOString();
  const add = (m: Map<string, number>, iso: string | null | undefined, v: number) => {
    if (!iso) return;
    const k = iso.slice(0, 10);
    m.set(k, (m.get(k) ?? 0) + v);
  };
  const out = new Map<string, number>();
  const counts = new Map<string, number>();
  if (metric === "leads_new" || metric === "conversations") {
    const table = metric === "leads_new" ? "contacts" : "conversations";
    const { data } = await a.from(table).select("created_at").eq("organization_id", orgId).gte("created_at", since).lt("created_at", until).limit(20000);
    for (const r of (data ?? []) as { created_at: string }[]) add(out, r.created_at, 1);
  } else if (metric === "deals_won" || metric === "revenue_won") {
    const { data } = await a.from("deals").select("closed_at, value").eq("organization_id", orgId).eq("status", "won").gte("closed_at", since).lt("closed_at", until).limit(20000);
    for (const r of (data ?? []) as { closed_at: string; value: number }[]) add(out, r.closed_at, metric === "deals_won" ? 1 : Number(r.value ?? 0));
  } else if (metric === "reviews_avg") {
    const { data } = await a.from("reviews").select("created_at, rating").eq("organization_id", orgId).not("rating", "is", null).gte("created_at", since).lt("created_at", until).limit(20000);
    for (const r of (data ?? []) as { created_at: string; rating: number }[]) {
      add(out, r.created_at, Number(r.rating));
      add(counts, r.created_at, 1);
    }
    for (const [k, v] of out) out.set(k, v / (counts.get(k) || 1));
  } else if (metric === "reply_minutes") {
    // the AI agent's measured reply time (the platform stores it per message)
    const { data } = await a.from("messages").select("created_at, meta").eq("organization_id", orgId).not("ai_agent_id", "is", null).gte("created_at", since).lt("created_at", until).not("meta->timing", "is", null).limit(20000);
    for (const r of (data ?? []) as { created_at: string; meta: { timing?: { total?: number } } | null }[]) {
      const ms = Number(r.meta?.timing?.total);
      if (Number.isFinite(ms) && ms >= 0) {
        add(out, r.created_at, ms / 60000);
        add(counts, r.created_at, 1);
      }
    }
    for (const [k, v] of out) out.set(k, v / (counts.get(k) || 1));
  }
  return [...out.entries()].map(([day, value]) => ({ day, value })).sort((x, y) => x.day.localeCompare(y.day));
}

export interface GoalView {
  goal: Goal;
  forecast: Forecast;
  line: string;
}

/** measures + forecasts every goal (custom goals have no automatic source: their value stays the baseline until the owner updates it) */
export async function evaluateGoals(orgId: string, lang: Lang = "he", now = Date.now()): Promise<{ views: GoalView[]; available: boolean }> {
  const { rows, available } = await loadGoals(orgId);
  const views: GoalView[] = [];
  for (const g of rows) {
    if (g.status === "paused" || g.status === "proposed") {
      const f = forecast(g, [], now);
      views.push({ goal: g, forecast: f, line: forecastLine(f, lang) });
      continue;
    }
    const series = g.metric === "custom" ? [] : await measureSeries(orgId, g.metric, g.start_date, now).catch(() => [] as DailyPoint[]);
    const f = forecast(g, series, now);
    views.push({ goal: g, forecast: f, line: forecastLine(f, lang) });
  }
  return { views, available };
}

/** the daily tick: snapshot + ONE alert when a goal slips into "at risk" / "off track"; closes goals whose date passed */
export async function goalsTick(orgId: string, lang: Lang = "he", now = Date.now()): Promise<{ snapshots: number; alerts: number }> {
  const res = { snapshots: 0, alerts: 0 };
  try {
    const { views, available } = await evaluateGoals(orgId, lang, now);
    if (!available) return res;
    const a = db();
    for (const v of views) {
      if (v.goal.status !== "active") continue;
      const f = v.forecast;
      await a.from("team_goal_snapshots").upsert({ goal_id: v.goal.id, organization_id: orgId, day: dayKey(now), value: f.current, expected: f.expected, low: f.low, high: f.high, probability: f.probability, risk: f.risk }, { onConflict: "goal_id,day" });
      res.snapshots++;
      const alert = goalAlert(v.goal.last_risk, f.risk);
      const patch: Record<string, unknown> = { last_risk: f.risk, updated_at: new Date(now).toISOString() };
      if (f.risk === "achieved") patch.status = "achieved";
      if (f.risk === "expired") patch.status = "missed";
      await a.from("team_business_goals").update(patch).eq("organization_id", orgId).eq("id", v.goal.id);
      if (alert) {
        res.alerts++;
        await a.from("team_activity").insert({ organization_id: orgId, phase: "system", summary: alertLine(v.goal.title, alert, f, lang).slice(0, 1000), details: { goal_id: v.goal.id, risk: f.risk, probability: f.probability }, ok: false });
        const { notifyOwners } = await import("@/lib/agents/run");
        await notifyOwners(orgId, "aiTeam.plus7.goalAlert", { title: v.goal.title.slice(0, 80) }, "/ai-team").catch(() => undefined);
      }
    }
  } catch {
    /* goals are optional — the clock never fails because of them */
  }
  return res;
}

export type SaveResult = { ok: true; id: string; line: string } | { ok: false; error: string };

/** `source` is decided by the CALLER: the team tool passes "agent" (stays proposed), only the owner's screen passes "owner" (active) */
export async function saveGoal(orgId: string, raw: Record<string, unknown>, ctx: { source: "owner" | "agent"; memberId?: string | null; userId?: string | null; lang?: Lang } = { source: "agent" }): Promise<SaveResult> {
  const n = normalizeGoal(raw);
  if ("rejected" in n) return { ok: false, error: n.rejected };
  let baseline = n.goal.baseline;
  // when the owner leaves the baseline empty, the baseline is what the CRM measured at the start (level metrics) or 0 (cumulative)
  if (raw.baseline === undefined || raw.baseline === "" || raw.baseline === null) {
    if (GOAL_METRICS[n.goal.metric].kind === "level" && n.goal.metric !== "custom") {
      const s = await measureSeries(orgId, n.goal.metric, dayKey(Date.now() - 30 * DAY)).catch(() => []);
      if (s.length) baseline = s.reduce((x, p) => x + p.value, 0) / s.length;
    }
  }
  const g = { ...n.goal, baseline };
  const check = normalizeGoal({ ...g }, Date.now());
  if ("rejected" in check) return { ok: false, error: check.rejected };
  const { data, error } = await db()
    .from("team_business_goals")
    .insert({ organization_id: orgId, ...g, owner_member_id: g.owner_member_id ?? ctx.memberId ?? null, owner_user_id: g.owner_user_id ?? ctx.userId ?? null, status: ctx.source === "owner" ? "active" : "proposed", source: ctx.source })
    .select("id")
    .single();
  if (error) return { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" };
  const line = ctx.lang === "en" ? `Goal saved: ${g.title}${ctx.source === "agent" ? " (waiting for the owner)" : ""}` : ctx.lang === "ar" ? `تم حفظ الهدف: ${g.title}${ctx.source === "agent" ? " (بانتظار المالك)" : ""}` : `היעד נשמר: ${g.title}${ctx.source === "agent" ? " (ממתין לאישור הבעלים)" : ""}`;
  return { ok: true, id: data?.id as string, line };
}

export async function setGoalStatus(orgId: string, id: string, status: "active" | "paused" | "achieved" | "missed"): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db().from("team_business_goals").update({ status, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", id);
  return error ? { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" } : { ok: true };
}

/** the goals block for a task's context ("" when none / migration not run) */
export async function goalsPromptFor(orgId: string, lang: Lang = "en"): Promise<string> {
  try {
    const { views, available } = await evaluateGoals(orgId, lang);
    return available ? goalsPrompt(views.map((v) => ({ goal: v.goal, forecast: v.forecast })), lang) : "";
  } catch {
    return "";
  }
}

export async function runGoalsTool(orgId: string, tool: string, args: Record<string, string | number>, ctx: { lang?: Lang; memberId?: string | null } = {}): Promise<ToolRun> {
  const lang = ctx.lang ?? "he";
  if (tool === "goals.set") {
    const r = await saveGoal(orgId, args, { source: "agent", memberId: ctx.memberId ?? null, lang });
    return r.ok ? { ok: true, summary: r.line, data: { id: r.id }, link: "/ai-team" } : { ok: false, summary: "", error: r.error };
  }
  const { views, available } = await evaluateGoals(orgId, lang);
  if (!available) return { ok: false, summary: "", error: "migration_not_applied" };
  const pick = tool === "goals.forecast" && typeof args.goal_id === "string" ? views.filter((v) => v.goal.id === args.goal_id) : views;
  if (!pick.length) return { ok: true, summary: "no goals recorded", data: [] };
  return { ok: true, data: pick.map((v) => ({ id: v.goal.id, title: v.goal.title, metric: v.goal.metric, status: v.goal.status, current: v.forecast.current, target: v.goal.target, due: v.goal.due_date, risk: v.forecast.risk, probability: v.forecast.probability, low: v.forecast.low, high: v.forecast.high })), summary: pick.map((v) => `${v.goal.title} [${v.goal.status}] → ${v.line} (id ${v.goal.id})`).join("; "), link: "/ai-team" };
}
