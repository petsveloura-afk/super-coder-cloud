import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDepartments, type DeptView, type Lang, type MemberLite } from "./departments-core";
import { buildJobProfile, cleanProfileOverride, employeeCard, type EmployeeCard, type JobProfile, type ProfileOverride } from "./job-profile-core";
import { buildDailyMeeting, deptSplitSections, withDeptSplit, type DailyMeeting, type MeetingTask } from "./dept-meeting-core";
import type { Report } from "./reports-core";

/**
 * Upgrade 8 / stage B5–B6 — server side: job-profile overrides, employee cards, department meetings and the weekly split.
 * Scoped to one business (service role, organization_id on every query). A missing table never throws: reads give the defaults in code
 * and writes answer "migration_not_applied"; the team keeps working exactly as before.
 */
const db = () => createAdminClient();
const missing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|migration/i.test(e.message ?? ""));
type Res = { ok: true } | { ok: false; error: string };

export async function loadProfileOverrides(orgId: string): Promise<{ available: boolean; rows: ProfileOverride[] }> {
  try {
    const { data, error } = await db().from("team_job_profiles").select("member_id, responsibilities, authority, forbidden_extra, lang").eq("organization_id", orgId);
    if (error) return { available: false, rows: [] };
    return { available: true, rows: ((data ?? []) as ProfileOverride[]).map((r) => ({ member_id: r.member_id, responsibilities: r.responsibilities?.length ? r.responsibilities : null, authority: r.authority?.length ? r.authority : null, forbidden_extra: r.forbidden_extra?.length ? r.forbidden_extra : null, lang: r.lang ?? null })) };
  } catch {
    return { available: false, rows: [] };
  }
}

/** the owner adapts one employee's job description; a member of another business is refused */
export async function saveProfileOverride(orgId: string, raw: Record<string, unknown>, userId: string | null): Promise<Res> {
  const c = cleanProfileOverride(raw);
  if (!c.ok) return { ok: false, error: c.error };
  try {
    const a = db();
    const { data: m } = await a.from("team_members").select("id").eq("organization_id", orgId).eq("id", c.row.member_id).maybeSingle();
    if (!m) return { ok: false, error: "not_found" };
    const { error } = await a.from("team_job_profiles").upsert({ organization_id: orgId, member_id: c.row.member_id, responsibilities: c.row.responsibilities ?? [], authority: c.row.authority ?? [], forbidden_extra: c.row.forbidden_extra ?? [], lang: c.row.lang ?? null, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id,member_id" });
    return error ? { ok: false, error: missing(error) ? "migration_not_applied" : "write_failed" } : { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

async function loadAll(orgId: string, now: number) {
  const [{ loadDeptState, loadSops }, { loadTaskRows, measureOrgSlas }, { loadGoals }] = await Promise.all([import("./org8-data"), import("./org8-stageb-data"), import("./goals")]);
  const [st, sops, tasks, sla, g] = await Promise.all([loadDeptState(orgId), loadSops(orgId), loadTaskRows(orgId, 30), measureOrgSlas(orgId, now), loadGoals(orgId).catch(() => ({ rows: [], available: false }))]);
  const goals = (g.rows as { id: string; title: string; metric: string; status: string }[]).map((x) => ({ id: x.id, title: x.title, metric: x.metric, status: x.status }));
  const views = buildDepartments({ members: st.members, placements: st.placements, rows: st.rows, tasks, goals, now });
  return { st, sops, tasks, sla, views };
}

/** a job description + the performance card for every employee of the business; never throws ([] when nothing can be read) */
export async function loadEmployeeCards(orgId: string, lang: Lang, now = Date.now()): Promise<{ cards: EmployeeCard[]; overridesAvailable: boolean }> {
  try {
    const { effectiveSops } = await import("./sop-core");
    const [{ st, sops, tasks }, ov] = await Promise.all([loadAll(orgId, now), loadProfileOverrides(orgId)]);
    const views = effectiveSops(sops.rows, lang);
    const cards = st.members.map((m: MemberLite) => {
      const dept = st.placements.find((p) => p.member_id === m.id)?.dept_key ?? null;
      const profile: JobProfile = buildJobProfile(m, ov.rows.find((r) => r.member_id === m.id)?.lang ?? lang, views, ov.rows.find((r) => r.member_id === m.id) ?? null, dept);
      return employeeCard(profile, tasks, now);
    });
    return { cards, overridesAvailable: ov.available };
  } catch {
    return { cards: [], overridesAvailable: false };
  }
}

/** the daily meeting of every department that has employees; built in code from real tasks */
export async function loadDailyMeetings(orgId: string, lang: Lang, now = Date.now()): Promise<DailyMeeting[]> {
  try {
    const { localizeTitle } = await import("./title-i18n-core");
    const { st, tasks, sla, views } = await loadAll(orgId, now);
    return views.filter((v: DeptView) => v.member_ids.length).map((v: DeptView) => buildDailyMeeting(v, tasks as MeetingTask[], { lang, now, localize: (s) => localizeTitle(s, lang), sla: sla.results, members: st.members }));
  } catch {
    return [];
  }
}

/** the weekly report with the department split appended; the report that was passed in is returned unchanged when anything fails */
export async function weeklyWithDeptSplit(orgId: string, report: Report, lang: Lang, now = Date.now()): Promise<Report> {
  try {
    const { localizeTitle } = await import("./title-i18n-core");
    const { slaLine } = await import("./dept-sla-core");
    const { st, tasks, sla, views } = await loadAll(orgId, now);
    const sections = deptSplitSections(views, tasks as MeetingTask[], { lang, now, localize: (s) => localizeTitle(s, lang), sla: sla.results, members: st.members, slaLine: (r) => slaLine(r, lang) });
    return withDeptSplit(report, sections, lang);
  } catch {
    return report;
  }
}

/** DISPLAY-time: the stored weekly report text with the department split added (the stored report itself is not changed); the same text when anything fails */
export async function weeklyTextWithDeptSplit(orgId: string, title: string, text: string, lang: Lang, now = Date.now()): Promise<string> {
  const r = await weeklyWithDeptSplit(orgId, { title, sections: [], text, figures: [] }, lang, now);
  return r.text;
}
