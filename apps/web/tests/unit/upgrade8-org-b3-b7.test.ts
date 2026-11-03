import { describe, expect, it } from "vitest";
import { ROLE_KEYS, ROLES } from "@/lib/team/roles";
import { decide, type PolicyMember, type PolicySettings, type Decision } from "@/lib/team/policy-core";
import { TOOL_MAP } from "@/lib/team/tools-core";
import { DEFAULT_SOPS } from "@/lib/team/sop-defaults-core";
import { sopPrompt, sopFor, effectiveSops } from "@/lib/team/sop-core";
import { placeMembers, type MemberLite, type Placement } from "@/lib/team/departments-core";
import {
  DEFAULT_MATRIX, DEFAULT_RACI, OWNER, RACI_MAP, allRaci, cleanMatrixOverride, cleanRaci, cleanThreshold, discountsIn, effectiveApprover, holdReason, matrixCheck, mentionsBroadcast, mergeRaci, raciForTask, raciPromptOpt, resolveMatrix, strictness, tighten,
} from "@/lib/team/raci-core";
import {
  DEFAULT_SLAS, alertKey, cleanMinutes, cleanSlaOverride, measureSlas, resolveSlas, slaBriefLine, slaLevel, slaLine, slaName, timeHandoffs, type HandoffLite,
} from "@/lib/team/dept-sla-core";

const NOW = Date.parse("2026-11-04T10:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const SETTINGS: PolicySettings = { enabled: true, emergency_stop: false };
const mem = (over: Partial<PolicyMember> = {}): PolicyMember => ({ tools: Object.keys(TOOL_MAP), autonomy: "auto", auto_actions: [], status: "active", ...over });

/* =========================================================== B3 — RACI */
describe("B3 — RACI table", () => {
  it("has one row per default procedure, none missing and none extra", () => {
    expect(DEFAULT_RACI.map((r) => r.key).sort()).toEqual(DEFAULT_SOPS.map((s) => s.key).sort());
  });
  it("every row uses real roles, R is a role, the C / I lists never contain R and never overlap", () => {
    for (const r of DEFAULT_RACI) {
      expect(ROLE_KEYS as readonly string[], r.key).toContain(r.R);
      expect(r.A === OWNER || (ROLE_KEYS as readonly string[]).includes(r.A), r.key).toBe(true);
      for (const x of [...r.C, ...r.I]) expect(ROLE_KEYS as readonly string[]).toContain(x);
      expect(r.C).not.toContain(r.R);
      expect(r.I).not.toContain(r.R);
      expect(r.C.filter((x) => r.I.includes(x))).toEqual([]);
    }
  });
  it("R of a procedure is the role that owns the default procedure", () => {
    for (const s of DEFAULT_SOPS) expect(RACI_MAP[s.key]!.R, s.key).toBe(s.owner_role);
  });
  it("money / customer procedures are approved by the owner by default", () => {
    for (const k of ["fin_refund", "fin_overdue", "sales_quote", "svc_complaint", "mkt_campaign_launch"]) expect(RACI_MAP[k]!.A, k).toBe(OWNER);
  });
  it("an owner override replaces the row and leaves the defaults untouched", () => {
    const merged = mergeRaci("sales_new_lead", [{ key: "sales_new_lead", C: ["marketing", "analyst"] }])!;
    expect(merged.C).toEqual(["marketing", "analyst"]);
    expect(RACI_MAP.sales_new_lead!.C).toEqual(["customer_service"]);
  });
  it("cleanRaci rejects unknown procedures and roles", () => {
    expect(cleanRaci({ key: "nope" })).toEqual({ ok: false, error: "unknown_procedure" });
    expect(cleanRaci({ key: "sales_new_lead", R: "wizard" })).toEqual({ ok: false, error: "bad:R" });
    expect(cleanRaci({ key: "sales_new_lead", C: ["sales", "wizard"] })).toEqual({ ok: false, error: "bad:C" });
  });
  it("an owner-approved procedure cannot be moved to an employee (cannot_lower), in the editor and in the merge", () => {
    expect(cleanRaci({ key: "fin_refund", A: "manager" })).toEqual({ ok: false, error: "cannot_lower" });
    expect(mergeRaci("fin_refund", [{ key: "fin_refund", A: "manager" }])!.A).toBe(OWNER);
  });
  it("a procedure approved by an employee may be moved up to the owner or sideways", () => {
    expect(mergeRaci("sales_new_lead", [{ key: "sales_new_lead", A: OWNER }])!.A).toBe(OWNER);
    const c = cleanRaci({ key: "sales_new_lead", A: "team_lead", R: "sales", C: "sales,marketing" });
    expect(c.ok && c.row.C).toEqual(["marketing"]);
  });
  it("the approver is ALWAYS the owner for customer / money / irreversible actions, whatever the table says", () => {
    const loose = { key: "x", R: "sales", A: "manager", C: [], I: [] };
    for (const s of ["customer", "money", "irreversible"] as const) expect(effectiveApprover(loose, s)).toBe(OWNER);
    expect(effectiveApprover(loose, "internal")).toBe("manager");
    expect(effectiveApprover(null, "internal")).toBe(OWNER);
  });
  it("finds the row of the procedure that fits a task text, in three languages", () => {
    expect(raciForTask("ליד חדש נכנס מהאתר", [], "he")?.key).toBe("sales_new_lead");
    expect(raciForTask("write a quote for the customer", [], "en")?.key).toBe("sales_quote");
    expect(raciForTask("zzzz qqqq", [], "en")).toBeNull();
  });
  it("the RACI line reaches the procedure block", () => {
    const hits = sopFor("ליד חדש נכנס מהאתר", effectiveSops([], "he"), { max: 1 });
    const text = sopPrompt(hits, { raci: raciPromptOpt(RACI_MAP.sales_new_lead!) });
    expect(text).toContain("Responsibility:");
    expect(text).toContain("does it: sales");
    expect(sopPrompt(hits)).not.toContain("Responsibility:");
  });
  it("allRaci applies overrides to every row", () => {
    expect(allRaci([]).length).toBe(DEFAULT_RACI.length);
    expect(allRaci([{ key: "svc_inquiry", R: "sales" }]).find((r) => r.key === "svc_inquiry")!.R).toBe("sales");
  });
});

describe("B3 — reading discounts and broadcasts", () => {
  it("reads a percentage next to a discount word in he / en / ar", () => {
    expect(discountsIn("אני נותן לך הנחה של 20% על ההזמנה").pct).toBe(20);
    expect(discountsIn("Take 15% off today").pct).toBe(15);
    expect(discountsIn("خصم 30% للعملاء").pct).toBe(30);
  });
  it("ignores a percentage that has nothing to do with a discount", () => {
    expect(discountsIn("ההמרה עלתה ב-40% החודש").pct).toBe(0);
    expect(discountsIn("conversion is up 40%").pct).toBe(0);
  });
  it("reads a money discount only with a currency", () => {
    expect(discountsIn('הנחה של 700 ש"ח').amount).toBe(700);
    expect(discountsIn("a discount of $1,200").amount).toBe(1200);
    expect(discountsIn("הנחה לקבוצה של 12 אנשים").amount).toBe(0);
  });
  it("detects a message to everyone", () => {
    expect(mentionsBroadcast("שלחנו לכל הלקוחות מבצע")).toBe(true);
    expect(mentionsBroadcast("email all customers about it")).toBe(true);
    expect(mentionsBroadcast("שלום דנה, תודה על הפנייה")).toBe(false);
  });
});

describe("B3 — the approval matrix", () => {
  it("holds a discount above the threshold and lets a smaller one through", () => {
    const big = matrixCheck("inbox.send_message", { contact_id: "c", text: "נשמח לתת לך הנחה של 25%" });
    expect(big?.ruleId).toBe("discount_pct");
    expect(big?.value).toBe(25);
    expect(matrixCheck("inbox.send_message", { contact_id: "c", text: "הנחה של 5% לחבר מועדון" })).toBeNull();
  });
  it("the threshold is strict: exactly the limit is allowed, one above is held", () => {
    expect(matrixCheck("inbox.send_message", { text: "10% discount" })).toBeNull();
    expect(matrixCheck("inbox.send_message", { text: "11% discount" })?.ruleId).toBe("discount_pct");
  });
  it("holds a money discount, a big deal, a message to many and a bulk agent run", () => {
    expect(matrixCheck("collections.send_reminder", { text: 'אפשר הנחה של 900 ש"ח אם תשלם היום' })?.ruleId).toBe("discount_amount");
    expect(matrixCheck("deals.create", { title: "פרויקט", value: 50000 })?.ruleId).toBe("deal_value");
    expect(matrixCheck("deals.create", { title: "פרויקט", value: 5000 })).toBeNull();
    expect(matrixCheck("inbox.send_message", { text: "הודעה לכל הלקוחות" })?.ruleId).toBe("broadcast");
    expect(matrixCheck("agents.run_marketing", {})?.ruleId).toBe("bulk_agents");
  });
  it("does not look at tools it does not govern", () => {
    expect(matrixCheck("crm.add_note", { text: "הנחה של 90%" })).toBeNull();
    expect(matrixCheck("agents.run_analyst", {})).toBeNull();
  });
  it("the owner can switch a rule off or change its threshold", () => {
    const off = resolveMatrix([{ rule_id: "discount_pct", enabled: false }]);
    expect(matrixCheck("inbox.send_message", { text: "50% off" }, off)).toBeNull();
    const tight = resolveMatrix([{ rule_id: "discount_pct", threshold: 3 }]);
    expect(matrixCheck("inbox.send_message", { text: "5% off" }, tight)?.ruleId).toBe("discount_pct");
    expect(DEFAULT_MATRIX.find((r) => r.id === "discount_pct")!.threshold).toBe(10);
  });
  it("cleans what the owner types", () => {
    expect(cleanThreshold("discount_pct", 150)).toBeNull();
    expect(cleanThreshold("discount_pct", "12.34")).toBe(12.3);
    expect(cleanThreshold("deal_value", -1)).toBeNull();
    expect(cleanMatrixOverride({ rule_id: "x" })).toEqual({ ok: false, error: "unknown_rule" });
    expect(cleanMatrixOverride({ rule_id: "deal_value", threshold: "abc" })).toEqual({ ok: false, error: "bad:threshold" });
    expect(cleanMatrixOverride({ rule_id: "deal_value", threshold: 30000, enabled: "false" })).toEqual({ ok: true, row: { rule_id: "deal_value", threshold: 30000, enabled: false } });
  });
  it("explains the hold in three languages", () => {
    const hit = matrixCheck("inbox.send_message", { text: "25% off" })!;
    for (const l of ["he", "en", "ar"] as const) expect(holdReason(hit, l)).toContain("25");
  });
});

describe("B3 — the matrix never relaxes the existing protections", () => {
  const hits = [null, matrixCheck("inbox.send_message", { text: "50% off" })!];
  const bases: Decision[] = [{ do: "execute" }, { do: "approve", sensitivity: "customer", why: "customer_visible" }, { do: "approve", sensitivity: "money", why: "money_action" }, { do: "blocked", why: "emergency_stop" }];
  it("tighten never lowers strictness, for every base decision and every hit", () => {
    for (const b of bases) for (const h of hits) expect(strictness(tighten(b, h))).toBeGreaterThanOrEqual(strictness(b));
  });
  it("an execute becomes an approval only when the matrix hit; approvals and blocks are returned untouched", () => {
    const h = hits[1]!;
    expect(tighten({ do: "execute" }, null)).toEqual({ do: "execute" });
    expect(tighten({ do: "execute" }, h).do).toBe("approve");
    expect(tighten(bases[1]!, h)).toBe(bases[1]);
    expect(tighten(bases[3]!, h)).toBe(bases[3]);
  });
  it("an employee on auto autonomy is still held by the matrix, while the base policy would have executed", () => {
    const m = mem({ autonomy: "auto", auto_actions: ["inbox.send_message"] });
    const base = decide("inbox.send_message", m, SETTINGS, { interactive: true });
    expect(base.do).toBe("execute");
    const hit = matrixCheck("inbox.send_message", { text: "לכל הלקוחות 40% הנחה" });
    expect(tighten(base, hit).do).toBe("approve");
  });
  it("the emergency stop and a paused employee still block, whatever the matrix says", () => {
    const hit = matrixCheck("inbox.send_message", { text: "40% off" });
    expect(tighten(decide("inbox.send_message", mem(), { enabled: true, emergency_stop: true }), hit).do).toBe("blocked");
    expect(tighten(decide("inbox.send_message", mem({ status: "paused" }), SETTINGS), hit).do).toBe("blocked");
  });
  it("a suggest-only employee stays suggest-only with the matrix off or on", () => {
    const s = mem({ autonomy: "suggest" });
    const off = resolveMatrix(DEFAULT_MATRIX.map((r) => ({ rule_id: r.id, enabled: false })));
    expect(tighten(decide("crm.add_note", s, SETTINGS), matrixCheck("crm.add_note", { text: "x" }, off)).do).toBe("approve");
  });
  it("every default rule only governs tools that exist in the catalog", () => {
    for (const r of DEFAULT_MATRIX) for (const t of r.tools) expect(TOOL_MAP[t], `${r.id}:${t}`).toBeTruthy();
  });
});

/* =========================================================== B4 — SLA */
const placements = (pairs: [string, string][]): Placement[] => pairs.map(([member_id, dept_key]) => ({ member_id, dept_key: dept_key as Placement["dept_key"], manual: false }));
const P = placements([["m1", "marketing"], ["s1", "sales"], ["v1", "service"], ["f1", "finance"], ["m2", "marketing"]]);
const H = (over: Partial<HandoffLite> & { minAgo: number; waitedMin?: number }): HandoffLite => ({
  task_id: over.task_id ?? `t${Math.random()}`,
  from_member: over.from_member ?? "m1",
  to_member: over.to_member ?? "s1",
  created_at: iso(over.minAgo),
  started_at: over.waitedMin === undefined ? (over.started_at ?? null) : iso(over.minAgo - over.waitedMin),
  finished_at: null,
  status: over.status ?? "done",
});

describe("B4 — department agreements", () => {
  it("has defaults with real departments, positive limits and unique ids", () => {
    expect(new Set(DEFAULT_SLAS.map((s) => s.id)).size).toBe(DEFAULT_SLAS.length);
    for (const s of DEFAULT_SLAS) {
      expect(s.from).not.toBe(s.to);
      expect(s.minutes).toBeGreaterThan(0);
      expect(s.id).toBe(`${s.from}_${s.to}`);
    }
  });
  it("cleans minutes and overrides", () => {
    expect(cleanMinutes(3)).toBeNull();
    expect(cleanMinutes(10081)).toBeNull();
    expect(cleanMinutes("45")).toBe(45);
    expect(cleanSlaOverride({ sla_id: "zzz" })).toEqual({ ok: false, error: "unknown_sla" });
    expect(cleanSlaOverride({ sla_id: "marketing_sales", minutes: 2 })).toEqual({ ok: false, error: "bad:minutes" });
    expect(cleanSlaOverride({ sla_id: "marketing_sales", minutes: 30, enabled: false })).toEqual({ ok: true, row: { sla_id: "marketing_sales", minutes: 30, enabled: false } });
  });
  it("resolves the owner's change over the default without touching the default", () => {
    const r = resolveSlas([{ sla_id: "marketing_sales", minutes: 15, enabled: true }]);
    expect(r.find((s) => s.id === "marketing_sales")!.minutes).toBe(15);
    expect(DEFAULT_SLAS.find((s) => s.id === "marketing_sales")!.minutes).toBe(60);
  });
  it("times a handoff from created to started and flags one over the limit", () => {
    const t = timeHandoffs([H({ minAgo: 300, waitedMin: 20 }), H({ minAgo: 300, waitedMin: 90 })], P, DEFAULT_SLAS, NOW);
    expect(t.map((x) => x.waitedMin)).toEqual([20, 90]);
    expect(t.map((x) => x.breached)).toEqual([false, true]);
  });
  it("a handoff still waiting past its limit is a breach NOW (open), one still inside the limit is not", () => {
    const t = timeHandoffs([H({ minAgo: 200, status: "pending" }), H({ minAgo: 10, status: "pending" })], P, DEFAULT_SLAS, NOW);
    expect(t[0]).toMatchObject({ picked: false, breached: true, openBreach: true, waitedMin: 200 });
    expect(t[1]).toMatchObject({ picked: false, breached: false, openBreach: false });
  });
  it("ignores handoffs inside one department, to a department without an agreement, canceled ones and unknown employees", () => {
    const t = timeHandoffs(
      [H({ minAgo: 500, from_member: "m1", to_member: "m2", waitedMin: 400 }), H({ minAgo: 500, from_member: "f1", to_member: "m1", waitedMin: 400 }), H({ minAgo: 500, status: "canceled", waitedMin: 400 }), H({ minAgo: 500, from_member: "ghost", waitedMin: 400 })],
      P, DEFAULT_SLAS, NOW,
    );
    expect(t).toEqual([]);
  });
  it("measures per agreement: counts, rate, average and worst pickup", () => {
    const hs = [H({ minAgo: 600, waitedMin: 10 }), H({ minAgo: 500, waitedMin: 30 }), H({ minAgo: 400, waitedMin: 120 })];
    const r = measureSlas(hs, P, DEFAULT_SLAS, NOW).find((x) => x.def.id === "marketing_sales")!;
    expect(r).toMatchObject({ total: 3, met: 2, breached: 1, openBreached: 0, avgPickupMin: 53, worstMin: 120 });
    expect(r.rate).toBeCloseTo(2 / 3);
  });
  it("only counts the last 30 days and only enabled agreements", () => {
    const old = H({ minAgo: 60 * 24 * 40, waitedMin: 500 });
    const defs = resolveSlas([{ sla_id: "marketing_service", enabled: false }]);
    const res = measureSlas([old, H({ minAgo: 60, from_member: "m1", to_member: "v1", waitedMin: 500 })], P, defs, NOW);
    expect(res.find((x) => x.def.id === "marketing_sales")!.total).toBe(0);
    expect(res.find((x) => x.def.id === "marketing_service")).toBeUndefined();
  });
  it("levels: ok, watch (a late one), breach (open late one, or mostly late)", () => {
    const lvl = (hs: HandoffLite[]) => slaLevel(measureSlas(hs, P, DEFAULT_SLAS, NOW).find((x) => x.def.id === "marketing_sales")!);
    expect(lvl([H({ minAgo: 100, waitedMin: 5 })])).toBe("ok");
    expect(lvl([H({ minAgo: 100, waitedMin: 5 }), H({ minAgo: 100, waitedMin: 5 }), H({ minAgo: 100, waitedMin: 5 }), H({ minAgo: 100, waitedMin: 200 })])).toBe("watch");
    expect(lvl([H({ minAgo: 300, status: "pending" })])).toBe("breach");
    expect(lvl([H({ minAgo: 600, waitedMin: 200 }), H({ minAgo: 600, waitedMin: 200 }), H({ minAgo: 600, waitedMin: 5 })])).toBe("breach");
  });
  it("the brief line is ONE line, null when all is well, and names the worst agreement", () => {
    expect(slaBriefLine(measureSlas([H({ minAgo: 100, waitedMin: 5 })], P, DEFAULT_SLAS, NOW), "he")).toBeNull();
    const bad = measureSlas([H({ minAgo: 300, status: "pending" }), H({ minAgo: 400, status: "pending" })], P, DEFAULT_SLAS, NOW);
    for (const l of ["he", "en", "ar"] as const) {
      const line = slaBriefLine(bad, l)!;
      expect(line.split("\n")).toHaveLength(1);
      expect(line).toContain(slaName(DEFAULT_SLAS[0]!, l));
      expect(line).toContain("2");
    }
  });
  it("a plain line per agreement, including the case with no handoffs", () => {
    const rs = measureSlas([H({ minAgo: 100, waitedMin: 5 })], P, DEFAULT_SLAS, NOW);
    expect(slaLine(rs.find((x) => x.def.id === "marketing_sales")!, "en")).toContain("1 of 1 within 60 min");
    expect(slaLine(rs.find((x) => x.def.id === "sales_finance")!, "he")).toContain("אין העברות");
  });
  it("the owner alert key is one per agreement per day and only for a breach", () => {
    const rs = measureSlas([H({ minAgo: 300, status: "pending" })], P, DEFAULT_SLAS, NOW);
    expect(alertKey(rs.find((x) => x.def.id === "marketing_sales")!, NOW)).toBe("marketing_sales:2026-11-04");
    expect(alertKey(rs.find((x) => x.def.id === "sales_finance")!, NOW)).toBeNull();
  });
  it("placement of members works with the department core's own output (the real wiring)", () => {
    const members: MemberLite[] = [{ id: "a", role_key: "marketing" }, { id: "b", role_key: "sales" }];
    const { all } = placeMembers(members, []);
    const t = timeHandoffs([H({ minAgo: 400, from_member: "a", to_member: "b", status: "pending" })], all, DEFAULT_SLAS, NOW);
    expect(t[0]).toMatchObject({ from: "marketing", to: "sales", openBreach: true });
    expect(ROLES.sales).toBeTruthy();
  });
});
