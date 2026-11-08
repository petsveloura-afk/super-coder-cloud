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
    a.from("team_tasks").select("id, title, brief, status, priority, assignee_id, goal_id, parent_id, origin, question, depends_on, credits_used, created_at, finished_at, plan, result, updated_at, error, attempts").eq("organization_id", org).gte("updated_at", since).order("created_at", { ascending: false }).limit(250),
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
    orgId: org,
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
    // the same count the team clock uses for the cap (by when the work ran) — the screen and the cap never disagree
    dayCredits: await runner.dayCredits(org).catch(() => taskRows.filter((x) => Date.parse(x.updated_at) > now - 86_400_000).reduce((s, x) => s + (x.credits_used || 0), 0)),
    dayCap: await runner.effectiveDayCap(org, settings.daily_credit_cap).catch(() => settings.daily_credit_cap),
  };

  try {
    const { loadTeamHealth } = await import("@/lib/team/runner-plus");
    const h = await loadTeamHealth(org, settings);
    // the list of AI engines / models is technical: shown to the platform admin only (business owners see the verdict and the failures)
    data.health = { level: h.verdict.level, issues: h.verdict.issues, models: opts.platformAdmin ? h.models : [], failures: h.failures, stuck: h.stuck, failed24h: h.failed24h, showModels: opts.platformAdmin };
  } catch {
    /* the health card is optional — the screen works without it */
  }

  try {
    // wave 68: today's health for the owner (tasks that worked / failed and why, which AI provider is healthy)
    const { loadDayHealth } = await import("@/lib/team/day-health");
    const dh = await loadDayHealth(org);
    if (dh) data.dayHealth = { ...dh, showProviders: opts.platformAdmin };
  } catch {
    /* the card is optional */
  }

  try {
    // wave 70: the team log in the owner's words (the card is optional)
    const { loadOwnerLog } = await import("@/lib/team/owner-log");
    const ol = await loadOwnerLog(org);
    if (ol) data.ownerLog = ol;
  } catch {
    /* the card is optional */
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
      // the stand-up lines carry stored task titles — shown in the business language (display only)
      standup: b?.standup.lines ? await import("@/lib/team/title-i18n-core").then((m) => b.standup.lines.map((l: string) => l.replace(/^(.*?:\s)(.+)$/, (_x: string, head: string, title: string) => head + m.localizeTitle(title, lang)))).catch(() => b.standup.lines) : undefined,
      report: rep ? { title: rep.title, text: rep.text, period_start: rep.period_start } : undefined,
      brief: brief ? { text: brief.text } : undefined,
    };
  } catch {
    /* the upgrade-7 cards are optional — the screen works without them */
  }

  try {
    // upgrade 8 (stage A): stability — skipped engines, tasks that need attention (with the one action), the waiting-customers queue,
    // and DISPLAY translation of old English titles / log lines into the business's language (the database is not changed)
    const { data: orgRow8 } = await a.from("organizations").select("locale").eq("id", org).maybeSingle();
    const lang8 = (orgRow8?.locale === "en" || orgRow8?.locale === "ar" ? orgRow8.locale : "he") as "he" | "en" | "ar";
    const [{ localizeTitle, localizeLog }, { explainToolFailure, reasonCode }, p8, { statsLine, slaAlertText }] = await Promise.all([import("@/lib/team/title-i18n-core"), import("@/lib/team/tool-failure-core"), import("@/lib/team/runner-plus8"), import("@/lib/team/response-queue-core")]);
    data.tasks = data.tasks.map((x) => ({ ...x, title: localizeTitle(x.title, lang8) }));
    if (data.health) data.health = { ...data.health, failures: data.health.failures.map((f) => ({ ...f, title: localizeTitle(f.title, lang8) })) };
    data.activity = data.activity.map((x) => ({ ...x, summary: localizeLog(x.summary, lang8) }));
    // tool lines ("goals.list: no goals recorded") — the tool's name from the dictionary and the result in the business language
    try {
      const { getT } = await import("@/lib/i18n/server");
      const { t } = await getT(lang8);
      const { localizeToolLine } = await import("@/lib/team/title-i18n-core");
      const label = (k: string) => {
        const key = `aiTeam.tools.${k.replace(".", "_")}`;
        const v = t(key);
        return v && v !== key ? v : null;
      };
      data.activity = data.activity.map((x) => ({ ...x, summary: localizeToolLine(x.summary, lang8, label) }));
      if (data.ownerLog) data.ownerLog = data.ownerLog.map((e) => (e.text ? { ...e, text: localizeToolLine(localizeLog(e.text, lang8), lang8, label) } : e));
    } catch {
      /* display translation is optional */
    }
    data.members = data.members.map((m) => ({ ...m, working_on: m.working_on ? localizeTitle(m.working_on, lang8) : m.working_on }));
    // wave 67: the memory tab in the business language, duplicates merged (×N), empty rows hidden — display only, the database is not changed
    try {
      const mc = await import("@/lib/team/memory-clean-core");
      data.memory = mc.safeMemoryView(data.memory, lang8, { now, localize: (s) => localizeTitle(s, lang8) });
      data.activity = data.activity.map((x) => ({ ...x, summary: mc.localizeGateSummary(x.summary, lang8) }));
    } catch {
      /* display clean-up is optional */
    }
    // wave 70: the owner's team log in the business language (display only)
    try {
      if (data.ownerLog) data.ownerLog = data.ownerLog.map((e) => (e.text ? { ...e, text: localizeLog(e.text, lang8) } : e));
    } catch {
      /* display translation is optional */
    }
    // display tidy-up (additive): no database ids, validation codes, raw timestamps or "(ASSUMPTION)" markers on the screen
    try {
      const { tidyActivityText } = await import("@/lib/team/activity-tidy-core");
      data.activity = data.activity.map((x) => ({ ...x, summary: tidyActivityText(x.summary, lang8) }));
      if (data.ownerLog) data.ownerLog = data.ownerLog.map((e) => (e.text ? { ...e, text: tidyActivityText(e.text, lang8) } : e));
      data.tasks = data.tasks.map((x) => {
        const r = (x.result ?? null) as { report?: unknown } | null;
        return r && typeof r.report === "string" ? { ...x, result: { ...r, report: tidyActivityText(r.report, lang8) } } : x;
      });
    } catch {
      /* display clean-up is optional */
    }
    const [skipped, { data: bad }, resp] = await Promise.all([
      // "add a key in Vercel" is platform work — business owners never see it
      opts.platformAdmin ? p8.loadSkippedProviders(lang8) : Promise.resolve([]),
      a.from("team_tasks").select("id, title, status, error, updated_at").eq("organization_id", org).in("status", ["failed", "blocked", "requires_connection"]).gte("updated_at", new Date(now - 30 * 86_400_000).toISOString()).order("updated_at", { ascending: false }).limit(40),
      p8.loadResponseQueue(org, data.ops?.sla.targetMin ?? 60),
    ]);
    const badRows = (bad ?? []) as { id: string; title: string; status: string; error: string | null; updated_at: string }[];
    data.plus8 = {
      skipped,
      attention: badRows.slice(0, 12).map((r) => {
        const e = explainToolFailure(r.error, lang8);
        const generic = r.status === "requires_connection" || reasonCode(r.error).startsWith("tool_");
        // "unexpected error" (additive): the technical reason in one short, clean line — so the owner can tell us what happened
        const code = reasonCode(r.error);
        const detail = code === "tool_bug" || code === "unknown" ? String(r.error ?? "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "").replace(/\s+/g, " ").trim().slice(0, 140) : "";
        return { id: r.id, title: localizeTitle(r.title, lang8), status: r.status, label: generic ? e.label : "", action: generic ? e.action : "", reason: code, ageDays: Math.floor((now - Date.parse(r.updated_at)) / 86_400_000), ...(detail ? { detail } : {}) };
      }),
      staleBlocked: badRows.filter((r) => (r.status === "blocked" || r.status === "requires_connection") && now - Date.parse(r.updated_at) > 3 * 86_400_000).length,
      response: resp ? { targetMin: resp.targetMin, line: statsLine(resp.stats, resp.targetMin, lang8), alert: { level: resp.alert.level, text: slaAlertText(resp.alert, lang8) }, queue: resp.queue.slice(0, 8).map((q) => ({ id: q.id, waitingMin: q.waitingMin, state: q.state })) } : undefined,
    };
  } catch {
    /* the stability card is optional — the screen works without it */
  }

  try {
    // upgrade 8 / stage B4: ONE department-agreement (SLA) line is added to the morning brief that is SHOWN (the stored report is unchanged)
    const { data: orgRowB } = await a.from("organizations").select("locale").eq("id", org).maybeSingle();
    const langB = (orgRowB?.locale === "en" || orgRowB?.locale === "ar" ? orgRowB.locale : "he") as "he" | "en" | "ar";
    const slaLine = await import("@/lib/team/runner-org8").then((m) => m.slaBriefLine(org, langB));
    if (slaLine && data.plus7) data.plus7 = { ...data.plus7, brief: { text: `${data.plus7.brief?.text ?? ""}${data.plus7.brief?.text ? "\n" : ""}• ${slaLine}` } };
  } catch {
    /* the agreements line is optional — the screen works without it */
  }

  try {
    // upgrade 8 / stage B6: the weekly report that is SHOWN gets a split by department (the stored report is unchanged)
    if (data.plus7?.report) {
      const { data: orgRowC } = await a.from("organizations").select("locale").eq("id", org).maybeSingle();
      const langC = (orgRowC?.locale === "en" || orgRowC?.locale === "ar" ? orgRowC.locale : "he") as "he" | "en" | "ar";
      const text = await import("@/lib/team/org8-profiles-data").then((m) => m.weeklyTextWithDeptSplit(org, data.plus7!.report!.title, data.plus7!.report!.text, langC));
      data.plus7 = { ...data.plus7, report: { ...data.plus7.report!, text } };
    }
  } catch {
    /* the department split is optional — the screen works without it */
  }

  return data;
}
