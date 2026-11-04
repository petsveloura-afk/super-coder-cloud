import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { timeContext } from "@/lib/ai/social-intel-core";
import { findPeerOverlap, planMoves, taskBriefing, type MemberFacts, type MemberRow, type OpenTaskRow, type PeerTask } from "./team-intel-core";

/**
 * Wave 64 — server side of the team intelligence. Every function is optional glue: on ANY error (missing table or column, no
 * network) it returns the neutral value and the team keeps working exactly as before. No secrets are read, logged or returned.
 */
const db = () => createAdminClient();
const OPEN_STATUSES = ["pending", "in_progress", "awaiting_approval", "awaiting_input"];
const DAY = 86_400_000;

/** the briefing an employee gets before it starts a task ("" when there is nothing to add) */
export async function briefingFor(ctx: { orgId: string; taskId: string; memberRole: string; title: string; brief: string }): Promise<string> {
  try {
    const a = db();
    const wantsRoster = ctx.memberRole === "manager" || ctx.memberRole === "team_lead" || ctx.memberRole === "project_coordinator";
    const [taskRes, orgRes, memRes, openRes] = await Promise.all([
      a.from("team_tasks").select("priority, origin, due_at, assignee_id").eq("organization_id", ctx.orgId).eq("id", ctx.taskId).maybeSingle(),
      a.from("organizations").select("timezone").eq("id", ctx.orgId).maybeSingle(),
      a.from("team_members").select("id, name, role_key, status").eq("organization_id", ctx.orgId).limit(100),
      a.from("team_tasks").select("id, title, assignee_id, status").eq("organization_id", ctx.orgId).in("status", OPEN_STATUSES).neq("id", ctx.taskId).limit(400),
    ]);
    const task = (taskRes.data ?? null) as { priority: number | null; origin: string | null; due_at: string | null; assignee_id: string | null } | null;
    const members = (memRes.data ?? []) as { id: string; name: string; role_key: string; status: string }[];
    const open = (openRes.data ?? []) as { id: string; title: string; assignee_id: string | null; status: string }[];
    const byId = new Map(members.map((m) => [m.id, m]));

    // colleagues' open work that is close to this task (never the employee's own)
    const others = open
      .filter((o) => o.assignee_id && o.assignee_id !== task?.assignee_id)
      .map((o) => ({ id: o.id, title: o.title, name: byId.get(o.assignee_id as string)?.name ?? "—", role: byId.get(o.assignee_id as string)?.role_key ?? "", status: o.status }));
    const peers: PeerTask[] = findPeerOverlap(ctx.title, others);

    const tc = timeContext(new Date(), (orgRes.data?.timezone as string | null) ?? null);
    const time = tc ? { shabbat: tc.shabbat, holiday: tc.holiday, holidayTomorrow: tc.holidayTomorrow, night: tc.dayPart === "night", isIsrael: tc.isIsrael } : null;

    const loadOf = new Map<string, number>();
    for (const o of open) if (o.assignee_id) loadOf.set(o.assignee_id, (loadOf.get(o.assignee_id) ?? 0) + 1);

    let roster: MemberFacts[] | undefined;
    if (wantsRoster) roster = await rosterFacts(ctx.orgId, members, loadOf).catch(() => undefined);

    return taskBriefing({
      role: ctx.memberRole,
      title: ctx.title,
      brief: ctx.brief,
      priority: task?.priority ?? null,
      origin: task?.origin ?? null,
      dueAt: task?.due_at ?? null,
      time,
      peers,
      roster,
      queueAhead: task?.assignee_id ? (loadOf.get(task.assignee_id) ?? 0) : 0,
    });
  } catch {
    return "";
  }
}

/** per-employee facts for the roster: open load + the last 30 days of finished tasks and decided approvals */
async function rosterFacts(orgId: string, members: { id: string; name: string; role_key: string; status: string }[], loadOf: Map<string, number>): Promise<MemberFacts[]> {
  const a = db();
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [{ data: fin }, { data: apr }] = await Promise.all([
    a.from("team_tasks").select("assignee_id, status").eq("organization_id", orgId).in("status", ["done", "failed"]).gte("updated_at", since).limit(1500),
    a.from("team_approvals").select("member_id, status").eq("organization_id", orgId).in("status", ["approved", "executed", "rejected"]).gte("created_at", since).limit(1500),
  ]);
  const stat = new Map<string, { done: number; failed: number; rejected: number; clean: number }>();
  const row = (id: string) => stat.get(id) ?? stat.set(id, { done: 0, failed: 0, rejected: 0, clean: 0 }).get(id)!;
  for (const t of (fin ?? []) as { assignee_id: string | null; status: string }[]) {
    if (!t.assignee_id) continue;
    if (t.status === "done") row(t.assignee_id).done++;
    else row(t.assignee_id).failed++;
  }
  for (const p of (apr ?? []) as { member_id: string | null; status: string }[]) {
    if (!p.member_id) continue;
    if (p.status === "rejected") row(p.member_id).rejected++;
    else row(p.member_id).clean++;
  }
  return members.map((m) => {
    const s = stat.get(m.id);
    return { id: m.id, name: m.name, role: m.role_key, status: m.status, load: loadOf.get(m.id) ?? 0, done: s?.done ?? 0, failed: s?.failed ?? 0, rejected: s?.rejected ?? 0, approvedClean: s?.clean ?? 0 };
  });
}

/* ------------------------------------------------------------------ harmony: who should own what (runs from the team clock) */

const lastRun = new Map<string, number>();
const MIN_GAP_MS = 20 * 60_000;

/**
 * Routes pending tasks nobody owns (they would otherwise stop with "no_assignee") and moves not-yet-started work off an
 * overloaded employee to a free colleague with the same role. Never touches a task the owner created himself, never runs
 * more often than every 20 minutes per business, at most 3 changes each time, and every change is written to the activity log.
 */
export async function harmonyTick(orgId: string, _lang: "he" | "en" | "ar"): Promise<{ moved: number }> {
  try {
    const now = Date.now();
    if (now - (lastRun.get(orgId) ?? 0) < MIN_GAP_MS) return { moved: 0 };
    lastRun.set(orgId, now);
    const a = db();
    const [{ data: mem }, { data: tasks }] = await Promise.all([
      a.from("team_members").select("id, role_key, status").eq("organization_id", orgId).limit(100),
      a.from("team_tasks").select("id, title, status, origin, assignee_id, priority, created_at, due_at, depth").eq("organization_id", orgId).in("status", OPEN_STATUSES).limit(800),
    ]);
    const members: MemberRow[] = ((mem ?? []) as { id: string; role_key: string; status: string }[]).map((m) => ({ id: m.id, role: m.role_key, status: m.status }));
    const open = (tasks ?? []) as OpenTaskRow[];
    if (!members.length || !open.length) return { moved: 0 };
    const moves = planMoves(members, open, now, 3);
    let moved = 0;
    for (const m of moves) {
      // the guards in the update make this race-safe: only a task that is still pending and still has the same owner moves
      let q = a.from("team_tasks").update({ assignee_id: m.to, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", m.taskId).eq("status", "pending");
      q = m.from ? q.eq("assignee_id", m.from) : q.is("assignee_id", null);
      const { data, error } = await q.select("id");
      if (error || !data?.length) continue;
      moved++;
      const summary = m.kind === "route_unassigned" ? "A task with no owner was routed to the employee whose role fits it." : "A task that had not started moved to a free colleague with the same role (the previous owner had too many open tasks).";
      await a.from("team_activity").insert({ organization_id: orgId, task_id: m.taskId, member_id: m.to, phase: "system", summary, details: { harmony: m.kind, from: m.from, to: m.to }, ok: true }).then(
        () => undefined,
        () => undefined,
      );
    }
    return { moved };
  } catch {
    return { moved: 0 };
  }
}
