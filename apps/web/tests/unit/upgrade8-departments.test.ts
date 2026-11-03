import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTS, DEPT_KEYS, ROLE_TO_DEPT, buildDepartments, cleanBudget, deptForRole, deptName, deptStats, effectiveDailyCap, goalForDept, headOf, manualPlacement, placeMembers, type MemberLite, type Placement } from "@/lib/team/departments-core";
import { DEFAULT_SOPS } from "@/lib/team/sop-defaults-core";
import { contentFingerprint, decideSopProposal, effectiveSops, normalizeSop, planSopChange, sopFor, sopKeyFor, sopLine, sopPrompt, sopTerms, type NewSop, type SopVersion } from "@/lib/team/sop-core";
import { ROLE_EXTRA_TOOLS_ORG8, UPGRADE8_ORG_TOOLS, withHeadGrant, withRoleExtrasOrg8 } from "@/lib/team/tools-org8-core";
import { ROLES } from "@/lib/team/roles";
import { TOOL_MAP, validateArgs } from "@/lib/team/tools-core";
import { decide } from "@/lib/team/policy-core";

const NOW = Date.parse("2026-11-04T10:00:00Z");
const M = (id: string, role_key: string, position = 0, status = "active"): MemberLite => ({ id, role_key, position, status });

describe("B1 — departments: structure and placement", () => {
  it("has the six default departments with names in three languages", () => {
    expect(DEPT_KEYS).toEqual(["sales", "marketing", "service", "operations", "finance", "management"]);
    for (const d of DEFAULT_DEPTS) expect(d.name.he && d.name.en && d.name.ar).toBeTruthy();
    expect(deptName("service", "he")).toBe("שירות לקוחות");
    expect(deptName("finance", "ar")).toBe("المالية");
  });
  it("every role of the catalog is mapped to a department", () => {
    for (const r of Object.keys(ROLES)) expect(ROLE_TO_DEPT[r], r).toBeTruthy();
  });
  it("places an employee by role and unknown roles go to operations", () => {
    expect(deptForRole("sales")).toBe("sales");
    expect(deptForRole("collections")).toBe("finance");
    expect(deptForRole("manager")).toBe("management");
    expect(deptForRole("content_writer")).toBe("marketing");
    expect(deptForRole("something_new")).toBe("operations");
    expect(deptForRole(null)).toBe("operations");
  });
  it("a manual placement is kept and never overwritten by the automatic mapping", () => {
    const members = [M("a", "sales"), M("b", "marketing")];
    const existing: Placement[] = [{ member_id: "a", dept_key: "management", manual: true }];
    const r = placeMembers(members, existing);
    expect(r.all.find((p) => p.member_id === "a")).toEqual({ member_id: "a", dept_key: "management", manual: true });
    expect(r.toWrite.map((p) => p.member_id)).toEqual(["b"]);
  });
  it("an automatic placement follows a role change, a manual one does not", () => {
    const r = placeMembers([M("a", "collections")], [{ member_id: "a", dept_key: "sales", manual: false }]);
    expect(r.toWrite).toEqual([{ member_id: "a", dept_key: "finance", manual: false }]);
    expect(placeMembers([M("a", "collections")], [{ member_id: "a", dept_key: "finance", manual: false }]).toWrite).toEqual([]);
  });
  it("manualPlacement refuses an unknown department", () => {
    expect(manualPlacement("a", "nope")).toBeNull();
    expect(manualPlacement("a", "sales")).toEqual({ member_id: "a", dept_key: "sales", manual: true });
  });
  it("the head: the owner's pick wins, else the best role, paused people never lead", () => {
    const members = [M("w", "content_writer", 1), M("m", "marketing", 2), M("p", "marketing", 0, "paused")];
    const pl = placeMembers(members, []).all;
    expect(headOf("marketing", members, pl)?.id).toBe("m");
    expect(headOf("marketing", members, pl, "w")?.id).toBe("w");
    expect(headOf("marketing", members, pl, "p")?.id).toBe("m");
    expect(headOf("sales", members, pl)).toBeNull();
  });
  it("management is led by the manager", () => {
    const members = [M("l", "team_lead", 0), M("g", "manager", 1)];
    expect(headOf("management", members, placeMembers(members, []).all)?.id).toBe("g");
  });
  it("department stats come from the real tasks only", () => {
    const tasks = [
      { id: "1", status: "done", assignee_id: "a", created_at: "2026-11-04T08:00:00Z", finished_at: "2026-11-04T08:30:00Z", credits_used: 4, updated_at: "2026-11-04T08:30:00Z" },
      { id: "2", status: "failed", assignee_id: "a", created_at: "2026-11-01T08:00:00Z", finished_at: "2026-11-01T09:00:00Z", credits_used: 9, updated_at: "2026-11-01T09:00:00Z" },
      { id: "3", status: "blocked", assignee_id: "a" },
      { id: "4", status: "in_progress", assignee_id: "b" },
      { id: "5", status: "done", assignee_id: "zzz", created_at: "2026-11-04T08:00:00Z", finished_at: "2026-11-04T08:10:00Z" },
    ];
    const s = deptStats(["a", "b"], tasks, NOW);
    expect(s).toMatchObject({ open: 2, working: 1, blocked: 1, done30: 1, failed30: 1, successRate: 0.5, avgMinutes: 30, credits24h: 4, load: 1 });
    expect(deptStats([], tasks, NOW)).toMatchObject({ open: 0, successRate: null, avgMinutes: null, load: 0 });
  });
  it("one active goal per department by its metric; management takes the unclaimed one", () => {
    const goals = [
      { id: "g1", title: "deals", metric: "deals_won", status: "active" },
      { id: "g2", title: "old", metric: "leads_new", status: "missed" },
      { id: "g3", title: "custom", metric: "custom", status: "active" },
    ];
    expect(goalForDept("sales", goals)?.id).toBe("g1");
    expect(goalForDept("marketing", goals)).toBeNull();
    expect(goalForDept("management", goals)?.id).toBe("g3");
  });
  it("buildDepartments gives six views with members, head, budget and goal", () => {
    const members = [M("s", "sales"), M("c", "customer_service"), M("g", "manager")];
    const v = buildDepartments({ members, placements: placeMembers(members, []).all, rows: [{ dept_key: "sales", head_member_id: null, credit_budget: 50 }], tasks: [], goals: [{ id: "g1", title: "x", metric: "revenue_won", status: "active" }], now: NOW });
    expect(v).toHaveLength(6);
    const sales = v.find((d) => d.key === "sales")!;
    expect(sales.member_ids).toEqual(["s"]);
    expect(sales.head_member_id).toBe("s");
    expect(sales.credit_budget).toBe(50);
    expect(sales.goal?.id).toBe("g1");
    expect(v.find((d) => d.key === "finance")!.head_member_id).toBeNull();
  });
});

describe("B1 — department credit budget (in addition to the daily cap)", () => {
  it("no budget and no cap changes nothing", () => {
    expect(effectiveDailyCap({ cap: 0, used: 10 }, { budget: 0, used: 0 }).by).toBe("none");
  });
  it("the tighter of the two wins, and the business cap is never loosened", () => {
    expect(effectiveDailyCap({ cap: 100, used: 40 }, { budget: 50, used: 30 })).toEqual({ cap: 60, used: 40, by: "department" });
    expect(effectiveDailyCap({ cap: 100, used: 40 }, { budget: 500, used: 30 })).toEqual({ cap: 100, used: 40, by: "business" });
  });
  it("a department budget works when the business has no cap", () => {
    expect(effectiveDailyCap({ cap: 0, used: 5 }, { budget: 20, used: 10 })).toEqual({ cap: 15, used: 5, by: "department" });
  });
  it("an exhausted department budget is expressed as cap = used (at least 1) so the engine stops", () => {
    const r = effectiveDailyCap({ cap: 0, used: 0 }, { budget: 10, used: 10 });
    expect(r.by).toBe("department");
    expect(r.cap).toBeGreaterThan(0);
    expect(r.used).toBeGreaterThanOrEqual(r.cap);
  });
  it("cleanBudget accepts integers 0..1,000,000 only", () => {
    expect(cleanBudget("25")).toBe(25);
    expect(cleanBudget(0)).toBe(0);
    expect(cleanBudget(-1)).toBeNull();
    expect(cleanBudget("abc")).toBeNull();
    expect(cleanBudget(2_000_000)).toBeNull();
  });
});

const sop = (over: Partial<NewSop> = {}): NewSop => ({ sop_key: "c_test", title: "Refund handling", purpose: "p", trigger: "refund money back", steps: ["a", "b"], owner_role: "manager", success_metric: "m", escalation: "e", approvals: ["refund"], dept: "finance", lang: "en", ...over });
const ver = (over: Partial<SopVersion>): SopVersion => ({ ...sop(), id: "v1", version: 1, status: "current", source: "owner", proposed_by: null, valid_from: "2026-11-01T00:00:00Z", valid_to: null, created_at: "2026-11-01T00:00:00Z", ...over });

describe("B2 — procedures: defaults", () => {
  it("has at least three defaults for every department, in three languages", () => {
    for (const d of DEPT_KEYS) {
      const own = DEFAULT_SOPS.filter((s) => s.dept === d);
      expect(own.length, d).toBeGreaterThanOrEqual(3);
      for (const s of own) for (const l of ["he", "en", "ar"] as const) {
        const t = s.text[l];
        expect(t.title.length, `${s.key} ${l}`).toBeGreaterThan(2);
        expect(t.steps.length, `${s.key} ${l}`).toBeGreaterThanOrEqual(3);
        expect(t.trigger.length, `${s.key} ${l}`).toBeGreaterThan(5);
        expect(t.success_metric, `${s.key} ${l}`).toBeTruthy();
      }
    }
  });
  it("default keys are unique and valid", () => {
    const keys = DEFAULT_SOPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9_]{3,40}$/);
  });
  it("every default whose action touches a customer, money or a refund names what needs approval", () => {
    for (const k of ["sales_new_lead", "sales_quote", "svc_complaint", "fin_overdue", "fin_refund", "mkt_campaign_launch"]) {
      expect(DEFAULT_SOPS.find((s) => s.key === k)!.text.en.approvals.length, k).toBeGreaterThan(0);
    }
  });
});

describe("B2 — procedures: versions are append-only", () => {
  it("normalizeSop validates and cleans", () => {
    expect(normalizeSop({ title: "ab", steps: "x" })).toEqual({ rejected: "bad:title" });
    expect(normalizeSop({ title: "Good title", steps: "" })).toEqual({ rejected: "bad:steps" });
    const r = normalizeSop({ title: "  Good   title ", steps: "one | two ; three", dept: "sales", approvals: "a|b" }, "en");
    expect("sop" in r && r.sop.steps).toEqual(["one", "two", "three"]);
    expect("sop" in r && r.sop.dept).toBe("sales");
    expect("sop" in r && r.sop.approvals).toEqual(["a", "b"]);
    expect("sop" in r && r.sop.lang).toBe("en");
  });
  it("a Hebrew title still gets a stable valid key", () => {
    const k = sopKeyFor("נוהל החזרים");
    expect(k).toMatch(/^[a-z0-9_]{3,40}$/);
    expect(sopKeyFor("נוהל החזרים")).toBe(k);
    expect(sopKeyFor("x", "my_key")).toBe("my_key");
  });
  it("the first owner save creates version 1", () => {
    expect(planSopChange([], sop(), "owner")).toEqual({ action: "create", version: 1 });
  });
  it("an owner change is a NEW version that closes the old one (nothing is edited)", () => {
    const cur = ver({ id: "v1", version: 1 });
    expect(planSopChange([cur], sop({ steps: ["a", "b", "c"] }), "owner")).toEqual({ action: "new_version", version: 2, supersedesId: "v1" });
  });
  it("the same content twice is a duplicate, not a version", () => {
    const cur = ver({ id: "v1" });
    expect(planSopChange([cur], sop(), "owner")).toEqual({ action: "duplicate", id: "v1" });
  });
  it("an employee's change is ALWAYS a proposal, even for a new procedure", () => {
    expect(planSopChange([], sop(), "agent")).toEqual({ action: "propose", version: 1, againstId: null });
    const cur = ver({ id: "v1", version: 3 });
    expect(planSopChange([cur], sop({ steps: ["z"] }), "agent")).toEqual({ action: "propose", version: 4, againstId: "v1" });
  });
  it("the same open proposal is not proposed twice", () => {
    const p = ver({ id: "p1", version: 2, status: "proposed", source: "agent", steps: ["z"] });
    expect(planSopChange([ver({}), p], sop({ steps: ["z"] }), "agent")).toEqual({ action: "duplicate", id: "p1" });
  });
  it("saving a built-in default unchanged is not a version", () => {
    const d = DEFAULT_SOPS.find((s) => s.key === "fin_refund")!;
    const t = d.text.en;
    const same = sop({ sop_key: "fin_refund", title: t.title, purpose: t.purpose, trigger: t.trigger, steps: t.steps, success_metric: t.success_metric, escalation: t.escalation, approvals: t.approvals, dept: d.dept, owner_role: d.owner_role, lang: "en" });
    expect(planSopChange([], same, "owner")).toEqual({ action: "duplicate", id: null });
  });
  it("accepting a proposal makes it current and closes the old current; rejecting only closes the proposal", () => {
    const cur = ver({ id: "v1", version: 1 });
    const p = ver({ id: "p1", version: 2, status: "proposed", source: "agent" });
    const ok = decideSopProposal([cur, p], "p1", true, NOW);
    expect(ok).toMatchObject({ ok: true, becomeCurrent: "p1", closeCurrent: "v1" });
    expect(decideSopProposal([cur, p], "p1", false, NOW)).toMatchObject({ ok: true, reject: "p1" });
    expect(decideSopProposal([cur, p], "v1", true, NOW)).toEqual({ ok: false, error: "not_proposed" });
  });
  it("fingerprint ignores case and punctuation but not content", () => {
    expect(contentFingerprint(sop({ title: "Refund, Handling!" }))).toBe(contentFingerprint(sop({ title: "refund handling" })));
    expect(contentFingerprint(sop({ steps: ["a"] }))).not.toBe(contentFingerprint(sop()));
  });
});

describe("B2 — procedures: the effective set and retrieval by relevance", () => {
  it("shows the default until the owner stores a version, then the stored current one", () => {
    const v0 = effectiveSops([], "he");
    expect(v0.length).toBe(DEFAULT_SOPS.length);
    expect(v0.find((s) => s.sop_key === "fin_refund")).toMatchObject({ isDefault: true, version: 0, title: "בקשת החזר כספי" });
    const stored = ver({ sop_key: "fin_refund", id: "x1", title: "החזרים אצלנו", lang: "he", version: 2 });
    const v1 = effectiveSops([stored], "he").find((s) => s.sop_key === "fin_refund")!;
    expect(v1).toMatchObject({ isDefault: false, version: 2, title: "החזרים אצלנו" });
  });
  it("custom procedures appear and proposals are attached, not applied", () => {
    const custom = ver({ sop_key: "c_vip", id: "c1" });
    const prop = ver({ sop_key: "fin_refund", id: "p9", version: 1, status: "proposed", source: "agent" });
    const v = effectiveSops([custom, prop], "en");
    expect(v.find((s) => s.sop_key === "c_vip")).toBeTruthy();
    const fr = v.find((s) => s.sop_key === "fin_refund")!;
    expect(fr.isDefault).toBe(true);
    expect(fr.proposals.map((p) => p.id)).toEqual(["p9"]);
  });
  it("sopTerms strips Hebrew prefixes (also two) and the Arabic article", () => {
    expect(sopTerms("ללידים החדשים").has("לידים")).toBe(true);
    expect(sopTerms("ולהחזר").has("החזר")).toBe(true);
    expect(sopTerms("المبيعات الجديدة").has("مبيعات")).toBe(true);
  });
  it("finds the matching procedure for a Hebrew task, with prefixes", () => {
    const views = effectiveSops([], "he");
    expect(sopFor("טיפול בליד חדש שהגיע מהאתר", views)[0]?.sop.sop_key).toBe("sales_new_lead");
    expect(sopFor("הלקוח ביקש החזר כספי על ההזמנה", views)[0]?.sop.sop_key).toBe("fin_refund");
    expect(sopFor("לתכנן תוכן שבועי לאינסטגרם", views)[0]?.sop.sop_key).toBe("mkt_weekly_content");
    expect(sopFor("הלקוח כועס ומגיש תלונה על השירות", views)[0]?.sop.sop_key).toBe("svc_complaint");
  });
  it("finds procedures for English and Arabic tasks too, and across languages", () => {
    const en = effectiveSops([], "en");
    expect(sopFor("overdue invoice payment reminder", en)[0]?.sop.sop_key).toBe("fin_overdue");
    const ar = effectiveSops([], "ar");
    expect(sopFor("طلب استرداد مالي من العميل", ar)[0]?.sop.sop_key).toBe("fin_refund");
    // an English task in a Hebrew business still finds the procedure (all-language terms)
    expect(sopFor("new lead from the website", effectiveSops([], "he"))[0]?.sop.sop_key).toBe("sales_new_lead");
  });
  it("an unrelated task gets no procedure at all", () => {
    expect(sopFor("לסדר את הצבעים של הלוגו", effectiveSops([], "he"))).toEqual([]);
    expect(sopFor("", effectiveSops([], "he"))).toEqual([]);
  });
  it("the steps alone never select a procedure (only trigger / title words)", () => {
    const v = effectiveSops([], "en").filter((s) => s.sop_key === "ops_task_intake");
    expect(sopFor("clear goal", v)).toEqual([]);
  });
  it("returns at most one procedure by default", () => {
    expect(sopFor("refund complaint customer", effectiveSops([], "en")).length).toBeLessThanOrEqual(1);
    expect(sopFor("refund complaint customer", effectiveSops([], "en"), { max: 3, min: 0.1 }).length).toBeGreaterThan(1);
  });
  it("the prompt block is separate, states the approval rules stay, and is empty without a hit", () => {
    expect(sopPrompt([])).toBe("");
    const hit = sopFor("refund request", effectiveSops([], "en"))[0]!;
    const b = sopPrompt([hit]);
    expect(b).toContain("Company procedure");
    expect(b).toContain("does NOT replace the approval rules");
    expect(b).toContain(hit.sop.title);
    expect(b).toContain("Needs the owner's approval");
  });
  it("outcome lines exist in three languages", () => {
    for (const l of ["he", "en", "ar"] as const) {
      for (const kind of ["created", "changed", "proposed", "accepted", "rejected", "same"] as const) {
        const line = sopLine(kind === "created" || kind === "changed" ? { kind, title: "T", version: 2 } : { kind, title: "T" }, l);
        expect(line).toContain("T");
      }
    }
  });
});

describe("B2 — tools and permissions (a separate function, nothing existing changed)", () => {
  it("both tools are in the catalog and are internal", () => {
    for (const t of UPGRADE8_ORG_TOOLS) {
      expect(TOOL_MAP[t.key]).toBeTruthy();
      expect(t.sensitivity).toBe("internal");
    }
    expect(TOOL_MAP["sop.lookup"]!.kind).toBe("read");
  });
  it("sop.lookup for everybody, sop.propose only for the manager and the team lead", () => {
    for (const r of Object.keys(ROLES)) expect(withRoleExtrasOrg8(r, []), r).toContain("sop.lookup");
    const proposers = Object.keys(ROLE_EXTRA_TOOLS_ORG8).filter((r) => ROLE_EXTRA_TOOLS_ORG8[r]!.includes("sop.propose"));
    expect(proposers.sort()).toEqual(["manager", "team_lead"]);
  });
  it("withRoleExtrasOrg8 never removes what the member has; a department head gets the right to propose", () => {
    expect(withRoleExtrasOrg8("sales", ["crm.add_note"])).toEqual(["crm.add_note", "sop.lookup"]);
    expect(withHeadGrant(["a"], false)).toEqual(["a"]);
    expect(withHeadGrant(["a"], true)).toEqual(["a", "sop.lookup", "sop.propose"]);
  });
  it("a worker who is not a head has no sop.propose: the policy blocks it", () => {
    const worker = { tools: withRoleExtrasOrg8("sales", []), autonomy: "auto" as const, auto_actions: [], status: "active" as const };
    expect(decide("sop.propose", worker, { enabled: true, emergency_stop: false })).toEqual({ do: "blocked", why: "tool_not_allowed" });
    const lead = { ...worker, tools: withRoleExtrasOrg8("team_lead", []) };
    expect(decide("sop.propose", lead, { enabled: true, emergency_stop: false })).toEqual({ do: "execute" });
  });
  it("tool arguments are validated: a title and the steps (body) are required", () => {
    expect(validateArgs("sop.propose", { title: "x" })).toEqual({ ok: false, error: "missing:body" });
    expect(validateArgs("sop.propose", { title: "Good", body: "a | b" })).toMatchObject({ ok: true });
    expect(validateArgs("sop.lookup", {})).toEqual({ ok: false, error: "missing:query" });
  });
});
