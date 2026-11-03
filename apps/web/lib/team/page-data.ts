import "server-only";
import type { LiveState, TeamPageData } from "@/components/ai-team/types";

/**
 * Everything the "My team" screen shows, for one business (service role, scoped by organization_id). Kept out of
 * the page component so the screen gets one consistent "now" for live states and relative times.
 */
export async function loadTeamPageData(orgId: string, opts: { canManage: boolean; platformAdmin: boolean }): Promise<TeamPageData> {
  const now = Date.now();
  const runner = await import("@/lib/team/runner");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const a = createAdminClient();
  const org = orgId;
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const [settings, { data: members }, { data: tasks }, { data: approvals }, { data: memory }, { data: activity }, { data: extras }, { data: meetingRow }, stats, routingRows] = await Promise.all([
    runner.loadSettings(org),
    a.from("team_members").select("id, role_key, name, title, avatar, tone, instructions, tools, autonomy, auto_actions, reports_to, status, limits, position").eq("organization_id", org).order("position"),
    a.from("team_tasks").select("id, title, brief, status, priority, assignee_id, goal_id, parent_id, origin, question, depends_on, credits_used, created_at, finished_at, plan, result, updated_at").eq("organization_id", org).gte("updated_at", since).order("created_at", { ascending: false }).limit(250),
    a.from("team_approvals").select("id, task_id, member_id, tool, preview, reason, sensitivity, status, payload, created_at").eq("organization_id", org).eq("status", "pending").order("created_at").limit(100),
    a.from("team_memory").select("id, member_id, layer, kind, subject, content, confidence, status, created_at").eq("organization_id", org).neq("status", "expired").order("created_at", { ascending: false }).limit(400),
    a.from("team_activity").select("id, task_id, member_id, phase, summary, ok, created_at").eq("organization_id", org).order("id", { ascending: false }).limit(60),
    a.from("team_playbooks").select("role_key, extra").eq("organization_id", org),
    a.from("team_tasks").select("created_at, result").eq("organization_id", org).eq("origin", "schedule").like("plan_key", "meeting-%").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    runner.teamStats(org),
    opts.platformAdmin ? a.from("ai_routing").select("task_kind, models") : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const taskRows = (tasks ?? []) as (TeamPageData["tasks"][number] & { updated_at: string })[];
  const memRows = (memory ?? []) as TeamPageData["memory"];
  const liveOf = (id: string): { live: LiveState; working_on: string | null } => {
    const mine = taskRows.filter((x) => x.assignee_id === id);
    const working = mine.find((x) => x.status === "in_progress");
    if (working) return { live: "working", working_on: working.title };
    const waiting = mine.find((x) => x.status === "awaiting_approval" || x.status === "awaiting_input");
    if (waiting) return { live: "waiting", working_on: waiting.title };
    const last = mine.filter((x) => x.finished_at).sort((x, y) => Date.parse(y.finished_at!) - Date.parse(x.finished_at!))[0];
    if (last && now - Date.parse(last.finished_at!) < 30 * 60_000) return { live: last.status === "done" ? "success" : last.status === "failed" || last.status === "blocked" ? "error" : "idle", working_on: null };
    const next = mine.find((x) => x.status === "pending");
    return { live: "idle", working_on: next?.title ?? null };
  };
  const { TOOLS } = await import("@/lib/team/tools-core");
  const models = opts.platformAdmin ? await runner.availableModels().catch(() => []) : [];
  const data: TeamPageData = {
    now,
    canManage: opts.canManage,
    platformAdmin: opts.platformAdmin,
    settings,
    members: ((members ?? []) as Omit<TeamPageData["members"][number], "live" | "working_on" | "last_learned">[]).map((m) => ({
      ...m,
      ...liveOf(m.id),
      last_learned: memRows.find((x) => x.member_id === m.id && x.layer === "semantic" && (x.status === "active" || x.status === "proposed"))?.content ?? null,
    })),
    tasks: taskRows,
    approvals: (approvals ?? []) as TeamPageData["approvals"],
    memory: memRows,
    activity: (activity ?? []) as TeamPageData["activity"],
    stats,
    playbookExtras: Object.fromEntries(((extras ?? []) as { role_key: string; extra: string }[]).map((x) => [x.role_key, x.extra])),
    meeting: meetingRow ? { created_at: meetingRow.created_at as string, narrative: ((meetingRow.result as { narrative?: string | null })?.narrative ?? null) as string | null, facts: ((meetingRow.result as { facts?: Record<string, unknown> })?.facts ?? {}) as Record<string, unknown> } : null,
    routing: ((routingRows.data ?? []) as { task_kind: string; models: { provider: string; model: string }[] }[]).map((r) => ({ kind: r.task_kind, models: Array.isArray(r.models) ? r.models : [] })),
    models: [...new Map(models.map((m) => [`${m.provider}/${m.model}`, m])).values()],
    toolCatalog: TOOLS.map((x) => ({ key: x.key, kind: x.kind, sensitivity: x.sensitivity, about: x.about })),
    dayCredits: taskRows.filter((x) => Date.parse(x.updated_at) > now - 86_400_000).reduce((s, x) => s + (x.credits_used || 0), 0),
  };

  try {
    const { loadTeamHealth } = await import("@/lib/team/runner-plus");
    const h = await loadTeamHealth(org, settings);
    data.health = { level: h.verdict.level, issues: h.verdict.issues, models: h.models, failures: h.failures, stuck: h.stuck, failed24h: h.failed24h };
  } catch {
    /* the health card is optional — the screen works without it */
  }

  try {
    const ops = await import("@/lib/team/runner-ops");
    const { WORK_TEMPLATES } = await import("@/lib/team/ops-core");
    data.ops = await ops.loadOps(org);
    data.sla = await ops.loadSla(org, data.ops.sla.targetMin).catch(() => undefined);
    data.templates = WORK_TEMPLATES.map((x) => ({ id: x.id, role: x.role, brief: x.brief }));
  } catch {
    /* the operations card is optional — the screen works without it */
  }

  try {
    const { loadFacts } = await import("@/lib/team/business-facts");
    const f = await loadFacts(org, { fresh: true });
    if (f.available) data.facts = { rows: f.rows };
  } catch {
    /* the business facts card is optional — the screen works without it */
  }

  try {
    // upgrade 7 (stages C–J): goals + forecasts, experiments, decision records, the board, the latest reports (each part optional)
    const { data: orgRow } = await a.from("organizations").select("locale").eq("id", org).maybeSingle();
    const lang = (orgRow?.locale === "en" || orgRow?.locale === "ar" ? orgRow.locale : "he") as "he" | "en" | "ar";
    const [g, e, d, b, rep, brief] = await Promise.all([
      import("@/lib/team/goals").then((m) => m.evaluateGoals(org, lang)).catch(() => null),
      import("@/lib/team/tools-plus7c").then((m) => m.loadExperiments(org)).catch(() => null),
      import("@/lib/team/decisions").then((m) => m.loadDecisions(org, { limit: 20 })).catch(() => null),
      import("@/lib/team/tools-plus7c").then((m) => m.loadBoard(org, lang)).catch(() => null),
      import("@/lib/team/tools-plus7c").then((m) => m.latestReport(org, "week")).catch(() => null),
      import("@/lib/team/tools-plus7c").then((m) => m.latestReport(org, "brief")).catch(() => null),
    ]);
    data.plus7 = {
      goals: g?.available ? g.views.map((v) => ({ goal: v.goal, forecast: v.forecast })) : undefined,
      experiments: e?.available ? e.rows : undefined,
      decisions: d?.available ? d.rows.map((r) => ({ id: r.id, task_id: r.task_id, route: r.route, route_reasons: r.route_reasons, record: r.record, confidence: r.confidence, audit_verdict: r.audit_verdict, created_at: r.created_at })) : undefined,
      standup: b?.standup.lines,
      report: rep ? { title: rep.title, text: rep.text, period_start: rep.period_start } : undefined,
      brief: brief ? { text: brief.text } : undefined,
    };
  } catch {
    /* the upgrade-7 cards are optional — the screen works without them */
  }

  return data;
}
