import { describe, expect, it } from "vitest";
import { DECISION_FORMAT_DEEP, GENESIS, appendRecord, approvalNote, auditDecision, auditorPrompt, classifyRoute, combineAudit, lessonFromDecision, parseAuditVerdict, parseDecision, pickAuditor, renderRecord, verifyChain, type DecisionDraft, type DecisionRecord } from "@/lib/team/decision-core";

const deepDraft = (over: Partial<DecisionDraft> = {}): DecisionDraft => ({
  understood: "The customer wants a refund for a missed appointment",
  decided: "Offer a free reschedule instead of a refund and ask the owner to approve",
  why: "A reschedule keeps the customer and costs the business nothing",
  confidence: 0.7,
  would_change_mind: ["The customer refuses a reschedule", "The owner's policy allows refunds"],
  options: [
    { id: "A", title: "Refund", summary: "Pay back", pros: ["fast"], cons: ["loses revenue"], risk: "high", reversible: false },
    { id: "B", title: "Free reschedule", summary: "New slot", pros: ["keeps customer"], cons: ["customer may still be upset"], risk: "low", reversible: true },
  ],
  chosen: "B",
  premortem: { failure_modes: [{ cause: "The customer is already too angry", likelihood: "medium", mitigation: "A person calls first" }, { cause: "No free slot this week", likelihood: "low", mitigation: "Offer the next two weeks" }], tripwires: ["Customer writes a third message"] },
  ...over,
});
const fastDraft = (over: Partial<DecisionDraft> = {}): DecisionDraft => ({ understood: "Asks the opening hours", decided: "Answer from the business profile", why: "The hours are confirmed by the owner", confidence: 0.9, would_change_mind: ["Hours changed today"], options: [], chosen: null, premortem: null, ...over });

describe("routing is code, not model — deep only for risk", () => {
  it("a simple question stays on the fast path", () => {
    expect(classifyRoute({ steps: [{ tool: "crm.find_contacts", sensitivity: "internal" }], text: "מתי אתם פתוחים" })).toEqual({ route: "fast", reasons: [] });
  });
  it("money, irreversible, large amounts, risky wording, high cost, many recipients and unsure customer-facing go deep — with reasons", () => {
    expect(classifyRoute({ steps: [{ tool: "x", sensitivity: "money" }] }).reasons).toContain("money_action");
    expect(classifyRoute({ steps: [{ tool: "x", sensitivity: "irreversible" }] }).route).toBe("deep");
    expect(classifyRoute({ amounts: [1500] }).reasons).toContain("large_amount");
    expect(classifyRoute({ amounts: [150] }).route).toBe("fast");
    expect(classifyRoute({ text: "הלקוח דורש החזר" }).reasons).toContain("high_risk_wording");
    expect(classifyRoute({ text: "he threatens a lawsuit" }).route).toBe("deep");
    expect(classifyRoute({ cost: "high" }).reasons).toContain("high_cost_of_error");
    expect(classifyRoute({ customerFacing: true, recipients: 12 }).reasons).toContain("many_recipients");
    expect(classifyRoute({ customerFacing: true, confidence: 0.3 }).reasons).toContain("unsure_reading");
    expect(classifyRoute({ customerFacing: false, confidence: 0.3 }).route).toBe("fast");
  });
});

describe("parseDecision", () => {
  it("reads the decision key of a plan, bounded and cleaned", () => {
    const raw = JSON.stringify({ understanding: "x", steps: [], decision: { understood: "u", decided: "d", why: "because it is cheap and safe", confidence: 85, would_change_mind: ["a", "b"] } });
    const d = parseDecision(raw)!;
    expect(d.confidence).toBe(0.85);
    expect(d.options).toEqual([]);
    expect(d.would_change_mind).toHaveLength(2);
  });
  it("reads options and a pre-mortem; caps at 3 options and invents ids", () => {
    const d = parseDecision(JSON.stringify({ decision: { decided: "x", why: "y", options: [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }], premortem: { failure_modes: [{ cause: "c1", mitigation: "m1" }], tripwires: ["t"] } } }))!;
    expect(d.options.map((o) => o.id)).toEqual(["A", "B", "C"]);
    expect(d.premortem?.failure_modes[0]?.likelihood).toBe("medium");
  });
  it("returns null for answers without a decision, and survives broken JSON", () => {
    expect(parseDecision('{"understanding":"x","steps":[]}')).toBeNull();
    expect(parseDecision("nothing")).toBeNull();
    expect(parseDecision('{"decision": {"decided": "d", "why": "because reasons here", "confidence": 0.6,}}')?.decided).toBe("d");
  });
  it("the deep format asks for options, a pre-mortem and tripwires", () => {
    expect(DECISION_FORMAT_DEEP).toMatch(/options/);
    expect(DECISION_FORMAT_DEEP).toMatch(/premortem/);
    expect(DECISION_FORMAT_DEEP).toMatch(/tripwires/);
  });
});

describe("deterministic audit", () => {
  it("a complete deep decision passes", () => expect(auditDecision(deepDraft(), { route: "deep" })).toMatchObject({ passed: true, failures: [] }));
  it("a complete fast decision passes", () => expect(auditDecision(fastDraft(), { route: "fast" }).passed).toBe(true));
  it("deep without options / chosen / pre-mortem / tripwire / mitigation fails", () => {
    expect(auditDecision(deepDraft({ options: [], chosen: null }), { route: "deep" }).failures).toContain("deep_needs_options");
    expect(auditDecision(deepDraft({ chosen: "Z" }), { route: "deep" }).failures).toContain("chosen_not_among_options");
    expect(auditDecision(deepDraft({ premortem: null }), { route: "deep" }).failures).toContain("deep_needs_premortem");
    expect(auditDecision(deepDraft({ premortem: { failure_modes: [{ cause: "a", likelihood: "low", mitigation: "m" }, { cause: "b", likelihood: "low", mitigation: "" }], tripwires: ["t"] } }), { route: "deep" }).failures).toContain("failure_mode_without_mitigation");
    expect(auditDecision(deepDraft({ premortem: { failure_modes: [{ cause: "a", likelihood: "low", mitigation: "m" }, { cause: "b", likelihood: "low", mitigation: "m" }], tripwires: [] } }), { route: "deep" }).failures).toContain("deep_needs_tripwire");
  });
  it("no reason / no decision / no 'would change my mind' fails on every route", () => {
    expect(auditDecision(fastDraft({ why: "ok" }), { route: "fast" }).failures).toContain("missing_reason");
    expect(auditDecision(fastDraft({ decided: "" }), { route: "fast" }).failures).toContain("missing_decision");
    expect(auditDecision(fastDraft({ would_change_mind: [] }), { route: "fast" }).failures).toContain("missing_change_my_mind");
  });
  it("overconfidence next to a HIGH-likelihood failure mode is rejected", () => {
    const d = deepDraft({ confidence: 0.92, premortem: { failure_modes: [{ cause: "a", likelihood: "high", mitigation: "m" }, { cause: "b", likelihood: "low", mitigation: "m" }], tripwires: ["t"] } });
    expect(auditDecision(d, { route: "deep" }).failures).toContain("confident_despite_high_risk_failure");
  });
  it("invented prices and leaked instructions are rejected", () => {
    expect(auditDecision(fastDraft({ why: "The haircut costs 999 ILS so it is fine" }), { route: "fast", known: "Haircut 120" }).failures.join()).toMatch(/invented_price/);
    expect(auditDecision(fastDraft({ why: "The ROLE PLAYBOOK says to always agree with everyone" }), { route: "fast" }).failures).toContain("leaks_internal_text");
  });
  it("warns (does not fail) when an irreversible risky option beats a safer reversible one", () => {
    const d = deepDraft({ chosen: "A" });
    const r = auditDecision(d, { route: "deep" });
    expect(r.warnings).toContain("irreversible_risky_option_chosen_over_safer_one");
  });
});

describe("the auditor: separate, and code can only make it stricter", () => {
  const members = [
    { id: "w", role: "content_writer", status: "active" },
    { id: "qc", role: "quality_control", status: "active" },
    { id: "tl", role: "team_lead", status: "active" },
    { id: "m", role: "manager", status: "paused" },
  ];
  it("never the author; quality control first, then lead, then manager", () => {
    expect(pickAuditor(members, "w")?.id).toBe("qc");
    expect(pickAuditor(members, "qc")?.id).toBe("tl");
    expect(pickAuditor(members.filter((x) => x.id === "w"), "w")).toBeNull();
    expect(pickAuditor([{ id: "m", role: "manager", status: "active" }], "m")).toBeNull();
  });
  it("a failed deterministic audit cannot be overridden by a friendly model", () => {
    const det = auditDecision(deepDraft({ premortem: null }), { route: "deep" });
    const f = combineAudit(det, { verdict: "approve", issues: [] });
    expect(f.verdict).toBe("revise");
    expect(f.deterministic).toBe(false);
  });
  it("a passed audit follows the model; an unavailable model does not block", () => {
    const det = auditDecision(deepDraft(), { route: "deep" });
    expect(combineAudit(det, { verdict: "escalate", issues: ["amount unclear"] }).verdict).toBe("escalate");
    expect(combineAudit(det, "not_run")).toMatchObject({ verdict: "approve", model: "not_run" });
    expect(combineAudit(det, null)).toMatchObject({ verdict: "approve", model: "unreadable" });
  });
  it("parses the auditor's verdict and builds an adversarial prompt without the author's raw thoughts", () => {
    expect(parseAuditVerdict('{"verdict":"revise","issues":["x","y"]}')).toEqual({ verdict: "revise", issues: ["x", "y"] });
    expect(parseAuditVerdict("looks fine")).toBeNull();
    const p = auditorPrompt(deepDraft(), "deep", ["money_action"]);
    expect(p).toMatch(/INDEPENDENT/);
    expect(p).toMatch(/Pre-mortem/);
  });
});

describe("append-only, hash-chained record", () => {
  const meta = (n: number) => ({ id: `d${n}`, task_id: "t1", member_id: "m1", route: "deep" as const, route_reasons: ["money_action"], confidence: 0.6, audit: null, now: Date.parse("2026-11-02T10:00:00Z") + n * 1000 });
  it("appending never changes the old log and chains the hashes", () => {
    const l0: DecisionRecord[] = [];
    const l1 = appendRecord(l0, deepDraft(), meta(1));
    const l2 = appendRecord(l1, fastDraft(), meta(2));
    expect(l0).toHaveLength(0);
    expect(l1).toHaveLength(1);
    expect(l2).toHaveLength(2);
    expect(l1[0]!.prev_hash).toBe(GENESIS);
    expect(l2[1]!.prev_hash).toBe(l1[0]!.hash);
    expect(l2[1]!.seq).toBe(2);
    expect(verifyChain(l2)).toEqual({ ok: true, brokenAt: null });
  });
  it("any edit, removal or reorder is detected", () => {
    const log = appendRecord(appendRecord(appendRecord([], deepDraft(), meta(1)), fastDraft(), meta(2)), fastDraft(), meta(3));
    const edited = log.map((r, i) => (i === 1 ? { ...r, why: "changed afterwards" } : r));
    expect(verifyChain(edited).brokenAt).toBe(1);
    expect(verifyChain([log[0]!, log[2]!]).ok).toBe(false);
    expect(verifyChain([log[1]!, log[0]!, log[2]!]).ok).toBe(false);
    const raised = log.map((r, i) => (i === 0 ? { ...r, confidence: 0.99 } : r));
    expect(verifyChain(raised).brokenAt).toBe(0);
  });
  it("keeps the raw and the calibrated confidence apart", () => {
    const r = appendRecord([], deepDraft({ confidence: 0.9 }), { ...meta(1), confidence: 0.55 })[0]!;
    expect(r.raw_confidence).toBe(0.9);
    expect(r.confidence).toBe(0.55);
  });
});

describe("lessons wait for the owner", () => {
  const rec = appendRecord([], deepDraft(), { id: "d", task_id: "t", member_id: null, route: "deep", route_reasons: [], confidence: 0.6, audit: null, now: 1 })[0]!;
  it("always PROPOSED, never active", () => {
    expect(lessonFromDecision(rec, { result: "good" })?.status).toBe("proposed");
    const bad = lessonFromDecision(rec, { result: "bad", note: "customer left" })!;
    expect(bad.status).toBe("proposed");
    expect(bad.kind).toBe("correction");
    expect(bad.content).toContain("customer left");
  });
  it("unknown outcome teaches nothing", () => expect(lessonFromDecision(rec, { result: "unknown" })).toBeNull());
});

describe("owner-facing text in three languages", () => {
  const rec = appendRecord([], deepDraft(), { id: "d", task_id: "t", member_id: null, route: "deep", route_reasons: ["money_action"], confidence: 0.62, audit: { verdict: "approve", issues: [], deterministic: true, model: "approve" }, now: 1 })[0]!;
  it("no raw chain of thought — only the record fields", () => {
    for (const l of ["he", "en", "ar"] as const) {
      const t = renderRecord(rec, l);
      expect(t).toContain("62%");
      expect(t).toContain(rec.why);
      expect(t.split("\n").length).toBeLessThan(10);
    }
    expect(renderRecord(rec, "he")).toContain("מה הבנתי");
    expect(renderRecord(rec, "ar")).toContain("ما فهمته");
    expect(approvalNote(rec, "en").length).toBeLessThanOrEqual(600);
  });
});
