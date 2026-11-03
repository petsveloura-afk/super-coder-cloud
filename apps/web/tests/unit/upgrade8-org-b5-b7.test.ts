import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_KEYS } from "@/lib/team/roles";
import { TOOL_MAP } from "@/lib/team/tools-core";
import { decide, type PolicyMember, type PolicySettings } from "@/lib/team/policy-core";
import { DEFAULT_SOPS } from "@/lib/team/sop-defaults-core";
import { effectiveSops } from "@/lib/team/sop-core";
import { buildDepartments, DEFAULT_DEPTS, DEPT_KEYS, placeMembers, type DeptView, type MemberLite } from "@/lib/team/departments-core";
import { DEFAULT_MATRIX, matrixCheck, tighten } from "@/lib/team/raci-core";
import { DEFAULT_SLAS, measureSlas, slaLine, type HandoffLite } from "@/lib/team/dept-sla-core";
import { buildReport } from "@/lib/team/reports-core";
import {
  ALWAYS_FORBIDDEN, DEPT_MISSION, ROLE_PROFILES, buildJobProfile, cleanProfileOverride, employeeCard, performanceLine, profilePrompt, relevantProcedures,
} from "@/lib/team/job-profile-core";
import * as profilesData from "@/lib/team/org8-profiles-data";
import { buildDailyMeeting, buildWeeklyMeeting, deptSplitSections, isUrgent, withDeptSplit, type MeetingTask } from "@/lib/team/dept-meeting-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
const get = (d: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);
const LANGS = ["he", "en", "ar"] as const;

const NOW = Date.parse("2026-11-05T10:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const UUID = "11111111-1111-4111-8111-111111111111";

const MEMBERS: MemberLite[] = [
  { id: "m1", role_key: "sales", name: "Dana", position: 1 },
  { id: "m2", role_key: "customer_service", name: "Omer", position: 2 },
  { id: "m3", role_key: "marketing", name: "Noa", position: 3 },
  { id: "m4", role_key: "manager", name: "Boss", position: 0 },
];
const PLACE = placeMembers(MEMBERS, []).all;
const task = (over: Partial<MeetingTask> & { id: string }): MeetingTask => ({ status: "pending", assignee_id: "m1", priority: 2, created_at: iso(300), updated_at: iso(60), title: `t-${over.id}`, credits_used: 0, ...over });
const views = (tasks: MeetingTask[]): DeptView[] => buildDepartments({ members: MEMBERS, placements: PLACE, rows: [], tasks, goals: [], now: NOW });
const salesView = (tasks: MeetingTask[]) => views(tasks).find((v) => v.key === "sales")!;

/* =========================================================== B5 — job descriptions */
describe("B5 — job descriptions", () => {
  it("every role has a profile in three languages with all three parts filled", () => {
    for (const r of ROLE_KEYS) {
      const p = ROLE_PROFILES[r];
      expect(p, r).toBeTruthy();
      for (const l of LANGS) {
        expect(p![l].responsibilities.length, `${r}/${l}`).toBeGreaterThanOrEqual(1);
        expect(p![l].authority.length, `${r}/${l}`).toBeGreaterThanOrEqual(1);
        expect(p![l].forbidden.length, `${r}/${l}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it("the three languages have the same number of items for each role (no language is thinner)", () => {
    for (const r of ROLE_KEYS) for (const part of ["responsibilities", "authority", "forbidden"] as const) {
      const n = ROLE_PROFILES[r]!.he[part].length;
      expect(ROLE_PROFILES[r]!.en[part].length, `${r}.${part}`).toBe(n);
      expect(ROLE_PROFILES[r]!.ar[part].length, `${r}.${part}`).toBe(n);
    }
  });
  it("Hebrew and Arabic profiles are really in their script (not copied English)", () => {
    for (const r of ROLE_KEYS) {
      expect(ROLE_PROFILES[r]!.he.responsibilities.join(" ")).toMatch(/[\u0590-\u05FF]/);
      expect(ROLE_PROFILES[r]!.ar.responsibilities.join(" ")).toMatch(/[\u0600-\u06FF]/);
    }
  });
  it("the profile follows the role's department and mission", () => {
    const p = buildJobProfile({ id: "m1", role_key: "sales" }, "en", []);
    expect(p.dept).toBe("sales");
    expect(p.deptName).toBe("Sales");
    expect(p.mission).toBe(DEPT_MISSION.sales.en);
    expect(buildJobProfile({ id: "x", role_key: "collections" }, "he", []).dept).toBe("finance");
  });
  it("an owner's manual department placement wins over the role's default", () => {
    expect(buildJobProfile({ id: "m1", role_key: "sales" }, "en", [], null, "finance").dept).toBe("finance");
  });
  it("a missing or unknown role falls back to the custom profile (never throws)", () => {
    const p = buildJobProfile({ id: "z", role_key: "wizard" }, "en", []);
    expect(p.responsibilities).toEqual(ROLE_PROFILES.custom!.en.responsibilities);
  });
  it("the universal prohibitions are in EVERY profile in every language, and last", () => {
    for (const r of ROLE_KEYS) for (const l of LANGS) {
      const f = buildJobProfile({ id: "a", role_key: r }, l, []).forbidden;
      for (const x of ALWAYS_FORBIDDEN[l]) expect(f, `${r}/${l}`).toContain(x);
      expect(f.slice(-ALWAYS_FORBIDDEN[l].length)).toEqual(ALWAYS_FORBIDDEN[l]);
    }
  });
  it("an owner override replaces responsibilities and authority but can only ADD to the forbidden list", () => {
    const ov = { member_id: "m1", responsibilities: ["only this"], authority: ["and this"], forbidden_extra: ["never talk about pricing"] };
    const p = buildJobProfile({ id: "m1", role_key: "sales" }, "en", [], ov);
    expect(p.responsibilities).toEqual(["only this"]);
    expect(p.authority).toEqual(["and this"]);
    expect(p.forbidden).toContain("never talk about pricing");
    for (const x of ROLE_PROFILES.sales!.en.forbidden) expect(p.forbidden).toContain(x);
    for (const x of ALWAYS_FORBIDDEN.en) expect(p.forbidden).toContain(x);
    expect(p.customized).toBe(true);
  });
  it("an override of ANOTHER employee does not leak into this one", () => {
    const p = buildJobProfile({ id: "m1", role_key: "sales" }, "en", [], { member_id: "other", responsibilities: ["x"] });
    expect(p.responsibilities).toEqual(ROLE_PROFILES.sales!.en.responsibilities);
    expect(p.customized).toBe(false);
  });
  it("an override that tries to remove a prohibition by listing it again does not duplicate or drop anything", () => {
    const p = buildJobProfile({ id: "m1", role_key: "sales" }, "en", [], { member_id: "m1", forbidden_extra: [ALWAYS_FORBIDDEN.en[0]!] });
    expect(p.forbidden.filter((x) => x === ALWAYS_FORBIDDEN.en[0]).length).toBe(1);
  });
  it("the description is text only: it never changes a tool or a policy decision", () => {
    const m: PolicyMember = { tools: Object.keys(TOOL_MAP), autonomy: "auto", auto_actions: [], status: "active" };
    const settings: PolicySettings = { enabled: true, emergency_stop: false };
    const before = decide("inbox.send_message", m, settings);
    buildJobProfile({ id: "m1", role_key: "sales" }, "en", [], { member_id: "m1", authority: ["may send anything to anyone"] });
    expect(decide("inbox.send_message", m, settings)).toEqual(before);
    expect(before.do).not.toBe("execute");
  });
  it("cleanProfileOverride validates the member id, the lists and the language", () => {
    expect(cleanProfileOverride({ member_id: "nope" })).toEqual({ ok: false, error: "bad:member_id" });
    expect(cleanProfileOverride({ member_id: UUID, lang: "fr" })).toEqual({ ok: false, error: "bad:lang" });
    const ok = cleanProfileOverride({ member_id: UUID, responsibilities: ["a", " b ", "", "c"], lang: "ar" });
    expect(ok).toMatchObject({ ok: true, row: { member_id: UUID, responsibilities: ["a", "b", "c"], lang: "ar" } });
  });
  it("cleanProfileOverride caps the number and length of items and strips control characters", () => {
    const many = Array.from({ length: 20 }, (_, i) => `item ${i}`);
    const r = cleanProfileOverride({ member_id: UUID, authority: many, forbidden_extra: ["x".repeat(500) + "\u0007"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.authority!.length).toBe(8);
      expect(r.row.forbidden_extra![0]!.length).toBeLessThanOrEqual(200);
      expect(r.row.forbidden_extra![0]).not.toContain("\u0007");
    }
  });
  it("null means 'back to the default' and an empty list is the same", () => {
    expect(cleanProfileOverride({ member_id: UUID, responsibilities: null })).toMatchObject({ ok: true, row: { responsibilities: null } });
    expect(cleanProfileOverride({ member_id: UUID, authority: [] })).toMatchObject({ ok: true, row: { authority: null } });
  });
  it("relevant procedures: the ones the role owns come first, then the department's, at most five", () => {
    const sv = effectiveSops([], "en");
    const procs = relevantProcedures("sales", "sales", sv);
    expect(procs.length).toBeGreaterThan(0);
    expect(procs.length).toBeLessThanOrEqual(5);
    const ownedKeys = DEFAULT_SOPS.filter((s) => s.owner_role === "sales").map((s) => s.key);
    for (const p of procs.filter((x) => x.owns)) expect(ownedKeys).toContain(p.key);
    const firstNotOwned = procs.findIndex((x) => !x.owns);
    if (firstNotOwned >= 0) expect(procs.slice(firstNotOwned).every((x) => !x.owns)).toBe(true);
  });
  it("a role that owns no procedure still gets its department's", () => {
    const sv = effectiveSops([], "he");
    const procs = relevantProcedures("content_writer", "marketing", sv);
    expect(procs.every((x) => !x.owns)).toBe(true);
    expect(procs.length).toBeGreaterThan(0);
  });
  it("the prompt block is short, in the language, and lists what is forbidden", () => {
    for (const l of LANGS) {
      const txt = profilePrompt(buildJobProfile({ id: "a", role_key: "sales" }, l, []), l);
      expect(txt.split("\n")).toHaveLength(4);
      expect(txt).toContain(ALWAYS_FORBIDDEN[l][0]);
    }
  });
});

/* =========================================================== B5 — the employee card */
describe("B5 — the employee card", () => {
  const profile = buildJobProfile({ id: "m1", role_key: "sales" }, "en", []);
  const fin = (id: string, status: "done" | "failed", mins: number) => task({ id, status, created_at: iso(mins + 100), finished_at: iso(100), updated_at: iso(100) });
  it("success rate and average time come only from this employee's own finished tasks", () => {
    const tasks = [fin("a", "done", 10), fin("b", "done", 30), fin("c", "failed", 5), task({ id: "x", assignee_id: "m2", status: "failed" })];
    const c = employeeCard(profile, tasks, NOW);
    expect(c.successPct).toBe(67);
    expect(c.avgMinutes).toBe(20);
    expect(c.sample).toBe(3);
  });
  it("no finished task = no percentage (never a made-up 0% or 100%)", () => {
    const c = employeeCard(profile, [task({ id: "p" })], NOW);
    expect(c.successPct).toBeNull();
    expect(performanceLine(c, "he")).toContain("עדיין אין");
  });
  it("a small sample is labelled as such in every language", () => {
    const c = employeeCard(profile, [fin("a", "done", 10)], NOW);
    expect(c.lowSample).toBe(true);
    expect(performanceLine(c, "en")).toContain("small sample");
    expect(performanceLine(c, "he")).toContain("מדגם קטן");
    expect(performanceLine(c, "ar")).toContain("عينة صغيرة");
  });
  it("five finished tasks are no longer a small sample", () => {
    const c = employeeCard(profile, [1, 2, 3, 4, 5].map((i) => fin(`d${i}`, "done", 10)), NOW);
    expect(c.lowSample).toBe(false);
    expect(performanceLine(c, "en")).not.toContain("small sample");
  });
  it("open tasks and load are counted for the card", () => {
    const c = employeeCard(profile, [task({ id: "o1" }), task({ id: "o2", status: "in_progress" }), task({ id: "o3", status: "done", finished_at: iso(5) })], NOW);
    expect(c.stats.open).toBe(2);
    expect(c.stats.load).toBe(2);
  });
});

/* =========================================================== B6 — department meetings */
describe("B6 — the daily department meeting (built by code)", () => {
  it("lists the queue, what is blocked and what is urgent, from the real tasks", () => {
    const tasks = [task({ id: "q1" }), task({ id: "q2", status: "in_progress" }), task({ id: "b1", status: "blocked" }), task({ id: "u1", priority: 1 })];
    const m = buildDailyMeeting(salesView(tasks), tasks, { lang: "en", now: NOW, members: MEMBERS });
    expect(m.queue.count).toBe(3);
    expect(m.blocked.count).toBe(1);
    expect(m.blocked.items).toEqual(["t-b1"]);
    expect(m.urgent.count).toBe(1);
    expect(m.text).toContain("Morning meeting");
  });
  it("a requires_connection task counts as blocked, not as a failure", () => {
    const tasks = [task({ id: "r1", status: "requires_connection" })];
    expect(buildDailyMeeting(salesView(tasks), tasks, { lang: "en", now: NOW }).blocked.count).toBe(1);
  });
  it("closed tasks (done / failed / canceled) never appear in the meeting", () => {
    const tasks = [task({ id: "d", status: "done" }), task({ id: "f", status: "failed" }), task({ id: "c", status: "canceled" })];
    const m = buildDailyMeeting(salesView(tasks), tasks, { lang: "en", now: NOW });
    expect(m.queue.count + m.blocked.count + m.urgent.count).toBe(0);
  });
  it("makes exactly ONE decision, by a fixed order: blocked first, then urgent, then the queue", () => {
    const blocked = [task({ id: "b1", status: "blocked" }), task({ id: "u1", priority: 1 })];
    expect(buildDailyMeeting(salesView(blocked), blocked, { lang: "en", now: NOW }).decision.code).toBe("unblock");
    const urgent = [task({ id: "u1", priority: 1 }), task({ id: "q" })];
    expect(buildDailyMeeting(salesView(urgent), urgent, { lang: "en", now: NOW }).decision.code).toBe("urgent");
    const plain = [task({ id: "q" })];
    expect(buildDailyMeeting(salesView(plain), plain, { lang: "en", now: NOW }).decision.code).toBe("continue");
    expect(buildDailyMeeting(salesView([]), [], { lang: "en", now: NOW }).decision.code).toBe("none");
  });
  it("the decision line has one sentence and names the real task", () => {
    const t = [task({ id: "b1", status: "blocked", title: "Send the quote" })];
    const d = buildDailyMeeting(salesView(t), t, { lang: "en", now: NOW }).decision;
    expect(d.text).toContain("Send the quote");
    expect(d.text.split("\n")).toHaveLength(1);
  });
  it("a breached agreement where the department RECEIVES the handoff becomes the decision", () => {
    const P2 = placeMembers([{ id: "a", role_key: "marketing" }, { id: "m1", role_key: "sales" }], []).all;
    const h: HandoffLite = { task_id: "h1", from_member: "a", to_member: "m1", created_at: iso(300), started_at: null, finished_at: null, status: "pending" };
    const sla = measureSlas([h], P2, DEFAULT_SLAS, NOW);
    const m = buildDailyMeeting(salesView([]), [], { lang: "en", now: NOW, sla });
    expect(m.decision.code).toBe("sla");
    expect(m.decision.text).toContain("Marketing");
  });
  it("high load alone, with nothing blocked or urgent, suggests rebalancing", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => task({ id: `l${i}`, priority: 3 }));
    expect(buildDailyMeeting(salesView(tasks), tasks, { lang: "en", now: NOW }).decision.code).toBe("rebalance");
  });
  it("urgent = priority 1 still open, or waiting for a person more than a day; a done one is never urgent", () => {
    expect(isUrgent(task({ id: "a", priority: 1 }), NOW)).toBe(true);
    expect(isUrgent(task({ id: "b", priority: 1, status: "done" }), NOW)).toBe(false);
    expect(isUrgent(task({ id: "c", status: "awaiting_approval", updated_at: iso(60 * 30) }), NOW)).toBe(true);
    expect(isUrgent(task({ id: "d", status: "awaiting_approval", updated_at: iso(60) }), NOW)).toBe(false);
  });
  it("is deterministic: the same data gives the same text, and the order follows urgency", () => {
    const tasks = [task({ id: "z", priority: 3 }), task({ id: "a", priority: 1 }), task({ id: "m", priority: 2 })];
    const a = buildDailyMeeting(salesView(tasks), tasks, { lang: "en", now: NOW });
    const b = buildDailyMeeting(salesView([...tasks].reverse()), [...tasks].reverse(), { lang: "en", now: NOW });
    expect(a.text).toBe(b.text);
    expect(a.queue.top[0]).toBe("t-a");
  });
  it("uses the display translation passed in and clips very long titles", () => {
    const t = [task({ id: "q", title: "Reply to the lead " + "x".repeat(200) })];
    const m = buildDailyMeeting(salesView(t), t, { lang: "he", now: NOW, localize: (s) => s.replace("Reply to the lead", "מענה לליד") });
    expect(m.queue.top[0]).toContain("מענה לליד");
    expect(m.queue.top[0]!.length).toBeLessThanOrEqual(70);
  });
  it("an empty department says so instead of inventing work", () => {
    const empty = views([]).find((v) => v.key === "finance")!;
    expect(buildDailyMeeting(empty, [], { lang: "en", now: NOW }).text).toContain("No employees");
    expect(buildDailyMeeting(empty, [], { lang: "he", now: NOW }).text).toContain("אין עובדים");
  });
  it("every language produces a full text for every department with no leftover placeholders", () => {
    for (const l of LANGS) for (const v of views([task({ id: "q" })])) {
      const m = buildDailyMeeting(v, [task({ id: "q" })], { lang: l, now: NOW });
      expect(m.text).not.toMatch(/undefined|\[object|NaN/);
      expect(m.name).toBe(DEFAULT_DEPTS.find((d) => d.key === v.key)!.name[l]);
    }
  });
  it("a department only sees ITS employees' tasks", () => {
    const tasks = [task({ id: "s1", assignee_id: "m1" }), task({ id: "c1", assignee_id: "m2" })];
    const m = buildDailyMeeting(salesView(tasks), tasks, { lang: "en", now: NOW });
    expect(m.queue.count).toBe(1);
    expect(m.queue.top).toEqual(["t-s1"]);
  });
});

describe("B6 — the weekly meeting and the weekly report split", () => {
  const week = [
    task({ id: "d1", status: "done", created_at: iso(500), finished_at: iso(450), updated_at: iso(450), credits_used: 3 }),
    task({ id: "d2", status: "done", created_at: iso(600), finished_at: iso(570), updated_at: iso(570), credits_used: 2 }),
    task({ id: "f1", status: "failed", updated_at: iso(100), credits_used: 1 }),
    task({ id: "old", status: "done", updated_at: iso(60 * 24 * 12), created_at: iso(60 * 24 * 12 + 10), finished_at: iso(60 * 24 * 12) }),
    task({ id: "o1", status: "pending" }),
  ];
  it("counts only the last 7 days, with the real success rate, average time and credits", () => {
    const w = buildWeeklyMeeting(salesView(week), week, { lang: "en", now: NOW });
    expect(w.done).toBe(2);
    expect(w.failed).toBe(1);
    expect(w.successPct).toBe(67);
    expect(w.avgMinutes).toBe(40);
    expect(w.credits).toBe(6);
    expect(w.carryOver).toBe(1);
  });
  it("includes only agreements that touch the department and have a problem", () => {
    const P2 = placeMembers([{ id: "a", role_key: "marketing" }, { id: "m1", role_key: "sales" }], []).all;
    const sla = measureSlas([{ task_id: "h", from_member: "a", to_member: "m1", created_at: iso(300), started_at: null, finished_at: null, status: "pending" }], P2, DEFAULT_SLAS, NOW);
    const w = buildWeeklyMeeting(salesView([]), [], { lang: "en", now: NOW, sla, slaLine: (r) => slaLine(r, "en") });
    expect(w.slaLines.length).toBe(1);
    expect(w.slaLines[0]).toContain("Marketing → Sales");
    const fin = buildWeeklyMeeting(views([]).find((v) => v.key === "finance")!, [], { lang: "en", now: NOW, sla });
    expect(fin.slaLines).toEqual([]);
  });
  const base = buildReport({ period: "week", cur: { leads: 30 }, prev: { leads: 20 }, lang: "he" });
  it("the split is APPENDED: the original report object and its text are untouched", () => {
    const before = JSON.stringify(base);
    const sections = deptSplitSections(views(week), week, { lang: "he", now: NOW });
    const out = withDeptSplit(base, sections, "he");
    expect(JSON.stringify(base)).toBe(before);
    expect(out.text.startsWith(base.text)).toBe(true);
    expect(out.sections.slice(0, base.sections.length)).toEqual(base.sections);
    expect(out.sections.length).toBeGreaterThan(base.sections.length);
    expect(out.text).toContain("לפי מחלקה — מכירות");
  });
  it("departments with no employees are left out of the split", () => {
    const sections = deptSplitSections(views(week), week, { lang: "en", now: NOW });
    expect(sections.map((s) => s.key)).toContain("dept_sales");
    expect(sections.map((s) => s.key)).not.toContain("dept_finance");
    expect(sections.length).toBe(views(week).filter((v) => v.member_ids.length).length);
  });
  it("no sections = the very same report; applying the split twice adds nothing the second time", () => {
    expect(withDeptSplit(base, [], "he")).toBe(base);
    const once = withDeptSplit(base, deptSplitSections(views(week), week, { lang: "he", now: NOW }), "he");
    const twice = withDeptSplit(once, deptSplitSections(views(week), week, { lang: "he", now: NOW }), "he");
    expect(twice.text).toBe(once.text);
  });
  it("the figures grow, so the 'no invented numbers' check still knows every number in the split", () => {
    const out = withDeptSplit(base, deptSplitSections(views(week), week, { lang: "en", now: NOW }), "en");
    for (const n of base.figures) expect(out.figures).toContain(n);
    expect(out.figures).toContain(6);
    expect(out.figures).toContain(67);
  });
  it("the split exists in all three languages", () => {
    for (const l of LANGS) {
      const out = withDeptSplit(buildReport({ period: "week", cur: { leads: 3 }, prev: { leads: 2 }, lang: l }), deptSplitSections(views(week), week, { lang: l, now: NOW }), l);
      expect(out.text).toContain({ he: "לפי מחלקה", en: "By department", ar: "حسب القسم" }[l]);
    }
  });
});

/* =========================================================== B3 / B4 are not weakened by B5–B7 */
describe("B5–B7 never weaken the existing protections", () => {
  it("the approval matrix can still only tighten", () => {
    const hit = matrixCheck("inbox.send_message", { text: "discount of 25%" });
    expect(hit).not.toBeNull();
    const t = tighten({ do: "execute", reason: "x" } as never, hit);
    expect(t.do).not.toBe("execute");
    expect(DEFAULT_MATRIX.length).toBeGreaterThan(0);
  });
  it("the department list and the SOP set are the same six / eighteen as before", () => {
    expect([...DEPT_KEYS]).toEqual(["sales", "marketing", "service", "operations", "finance", "management"]);
    expect(DEFAULT_SOPS.length).toBe(18);
  });
});

/* =========================================================== failure is silent (no table / no key) */
describe("B5–B7 data layer fails soft", () => {
  it("with no service key every read gives the defaults and every write answers an error code (nothing throws)", async () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const d = profilesData;
      expect(await d.loadProfileOverrides("org")).toEqual({ available: false, rows: [] });
      expect(await d.saveProfileOverride("org", { member_id: UUID, authority: ["x"] }, null)).toEqual({ ok: false, error: "write_failed" });
      expect(await d.saveProfileOverride("org", { member_id: "bad" }, null)).toEqual({ ok: false, error: "bad:member_id" });
      expect(await d.loadEmployeeCards("org", "en")).toEqual({ cards: [], overridesAvailable: false });
      expect(await d.loadDailyMeetings("org", "en")).toEqual([]);
      const rep = buildReport({ period: "week", cur: { leads: 3 }, prev: { leads: 2 }, lang: "en" });
      expect(await d.weeklyWithDeptSplit("org", rep, "en")).toBe(rep);
      expect(await d.weeklyTextWithDeptSplit("org", rep.title, rep.text, "en")).toBe(rep.text);
    } finally {
      if (saved !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
    }
  });
  it("the data layer treats a missing table as 'migration not applied'", () => {
    const src = read("lib/team/org8-profiles-data.ts");
    expect(src).toContain('"migration_not_applied"');
    expect(src).toContain('e.code === "42P01"');
    expect(src).toContain('eq("organization_id", orgId)');
    expect(src).toContain('.eq("organization_id", orgId).eq("id", c.row.member_id)'); // a member of another business is refused
  });
  it("the migration is one additive, idempotent file that deletes nothing", () => {
    const sql = read("../../supabase/migrations/20261105000012_team_upgrade_8_job_profiles.sql");
    expect(sql).toContain("create table if not exists public.team_job_profiles");
    expect(sql).toContain("create index if not exists");
    expect(sql).toContain("drop policy if exists");
    expect(sql).not.toMatch(/drop table|delete from|truncate|alter table .* drop column/i);
    expect(sql).toContain("revoke insert, update, delete on public.team_job_profiles from anon, authenticated");
  });
});

/* =========================================================== wiring, i18n, self-check */
describe("B5–B7 wiring, translations and the stage-B self-check", () => {
  it("every new UI key exists in he, en and ar", () => {
    const keys = ["card.title", "card.dept", "card.mission", "card.resp", "card.auth", "card.forb", "card.procs", "card.owns", "card.perf", "card.open", "card.load", "card.edit", "card.save", "card.cancel", "card.custom", "card.hint", "card.addForb", "card.saveFail", "card.migration", "card.reset", "meet.daily", "meet.weekly", "meet.queue", "meet.blocked", "meet.urgent", "meet.decision", "meet.none", "meet.split"];
    for (const l of LANGS) for (const k of keys) expect(typeof get(dict(l), `aiTeam.org8.${k}`), `${l}:${k}`).toBe("string");
  });
  it("the three dictionaries have exactly the same org8 keys", () => {
    const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as object).flatMap(([k, v]) => flat(v, `${p}${p ? "." : ""}${k}`)) : [p]);
    const he = flat(dict("he").aiTeam.org8).sort();
    expect(flat(dict("en").aiTeam.org8).sort()).toEqual(he);
    expect(flat(dict("ar").aiTeam.org8).sort()).toEqual(he);
  });
  it("the card component and its action exist and use only existing, owner-gated paths", () => {
    expect(existsSync(join(root, "components/ai-team/employee-card.tsx"))).toBe(true);
    const a = read("app/[locale]/(dashboard)/ai-team/org-actions.ts");
    expect(a).toContain('ctx.can("ai.manage")');
    expect(a).toContain('orgHasFeature(ctx.org.id, "ai_team")');
    expect(a).toContain("saveJobProfileAction");
    const c = read("components/ai-team/employee-card.tsx");
    expect(c).toContain("optimistic(");
    expect(c).toContain("aiTeam.org8.card.saveFail");
  });
  it("the weekly split is added at display time in page-data and is optional", () => {
    const p = read("lib/team/page-data.ts");
    expect(p).toContain("weeklyTextWithDeptSplit");
    expect(p).toMatch(/department split is optional/);
  });
  it("the stage-B self-check is a NEW file that lists every stage-B table, reports OK / MISSING and changes nothing", () => {
    const sql = read("../../supabase/checks/upgrade_8_stage_b_selfcheck.sql");
    for (const t of ["team_departments", "team_dept_members", "team_sops", "team_raci_roles", "team_raci_matrix", "team_dept_sla", "team_sla_alerts", "team_job_profiles"]) expect(sql, t).toContain(`'${t}'`);
    expect(sql).toContain("'OK'");
    expect(sql).toContain("'MISSING'");
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|drop table|create table|alter table)\b/i);
  });
  it("the stage-B self-check names the unique indexes and the SOP guard trigger", () => {
    const sql = read("../../supabase/checks/upgrade_8_stage_b_selfcheck.sql");
    for (const x of ["team_sops_one_current", "team_sops_guard", "team_job_profiles_unique", "team_dept_sla_unique", "team_sla_alerts_unique"]) expect(sql, x).toContain(x);
  });
  it("the existing stage-7/8 self-check and the two existing contract files were not touched by B5–B7", () => {
    expect(read("lib/team/plus8b-hooks.ts")).toContain("export async function dailyTick");
    expect(read("components/ai-team/plus8b-panels.tsx")).toContain("export type Plus8bSlot");
  });
});
