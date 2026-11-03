import { describe, expect, it } from "vitest";
import { arbitrate, contractBrief, nextEscalation, pickAssignee, standup, validateHandoff, type Claim } from "@/lib/team/coordination-core";

const c = (over: Partial<Claim>): Claim => ({ member: "m1", role: "sales", subject: "haircut price", value: "120", source: "employee", confidence: 0.6, at: 1_000_000, ...over });
describe("handoff contracts", () => {
  const ok = { from_role: "sales", to_role: "content_writer", title: "Write offer post", deliverable: "One Hebrew post with the offer", acceptance: ["mentions the 120 price", "under 80 words"], inputs: ["offer id 7"] };
  it("valid", () => expect(validateHandoff(ok, ["content_writer"]).ok).toBe(true));
  it("rejects missing pieces, self-handoff, unknown roles and secrets", () => {
    const r = validateHandoff({ ...ok, acceptance: [], deliverable: "x", to_role: "sales", inputs: ["api_key=abc"] }, ["content_writer"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(["missing_acceptance", "missing_deliverable", "unknown_to_role", "handoff_to_self", "secret_in_inputs"]));
  });
  it("the brief carries the acceptance criteria", () => {
    const r = validateHandoff(ok, ["content_writer"]);
    if (r.ok) expect(contractBrief(r.contract)).toContain("2. under 80 words");
  });
});
describe("arbitration: the owner's confirmed facts win", () => {
  it("owner confirmed beats any number of employees", () => expect(arbitrate([c({ value: "150" }), c({ value: "150", member: "m2" }), c({ value: "120", source: "owner_confirmed", role: "manager" })], "price")).toMatchObject({ reason: "owner_confirmed", winner: { value: "120" } }));
  it("two different owner-confirmed values → the owner decides", () => expect(arbitrate([c({ source: "owner_confirmed", value: "120" }), c({ source: "owner_confirmed", value: "130" })]).needsOwner).toBe(true));
  it("a recorded fact beats an employee's memory", () => expect(arbitrate([c({ value: "99" }), c({ value: "120", source: "unconfirmed_fact" })]).reason).toBe("source"));
  it("authority breaks a tie of equal sources", () => expect(arbitrate([c({ value: "100", role: "content_writer" }), c({ value: "120", role: "sales" })], "price")).toMatchObject({ reason: "authority", winner: { value: "120" } }));
  it("clear confidence gap, else recency, else the owner", () => {
    expect(arbitrate([c({ value: "1", role: "x", confidence: 0.9 }), c({ value: "2", role: "y", confidence: 0.5 })]).reason).toBe("confidence");
    expect(arbitrate([c({ value: "1", role: "x", at: 9e9 }), c({ value: "2", role: "y", at: 1 })]).reason).toBe("recency");
    expect(arbitrate([c({ value: "1", role: "x" }), c({ value: "2", role: "y" })]).needsOwner).toBe(true);
  });
  it("agreement and empty input are trivial", () => {
    expect(arbitrate([c({}), c({ member: "m2" })]).reason).toBe("single");
    expect(arbitrate([]).winner).toBeNull();
  });
});
describe("escalation ladder", () => {
  it("climbs with attempts, age and severity; never skips down", () => {
    expect(nextEscalation({ attempts: 0, ageHours: 0, severity: "low" })).toBe("self_retry");
    expect(nextEscalation({ attempts: 1, ageHours: 1, severity: "low" })).toBe("peer_help");
    expect(nextEscalation({ attempts: 1, ageHours: 3, severity: "high" })).toBe("manager");
    expect(nextEscalation({ attempts: 2, ageHours: 50, severity: "low" })).toBe("owner");
    expect(nextEscalation({ attempts: 1, ageHours: 3, severity: "low", current: "team_lead" })).toBe("manager");
    expect(nextEscalation({ attempts: 9, ageHours: 99, severity: "high", current: "owner" })).toBe("owner");
  });
});
describe("stand-up", () => {
  const now = 10_000_000_000;
  it("short, per employee, in the business language", () => {
    const items = [{ id: "1", title: "פוסט", member: "a", status: "done" as const, updated_at: now - 3600_000 }, { id: "2", title: "מענה", member: "a", status: "in_progress" as const, updated_at: now }, { id: "3", title: "אתר", member: "b", status: "blocked" as const, updated_at: now }, { id: "4", title: "ישן", member: "b", status: "done" as const, updated_at: now - 99 * 3600_000 }];
    const r = standup(items, { a: "דנה", b: "רון" }, now, "he");
    expect(r).toMatchObject({ done: 1, doing: 1, blocked: 1 });
    expect(r.lines[0]).toContain("דנה");
    expect(r.lines.join()).not.toContain("ישן");
    expect(standup(items, { a: "A", b: "B" }, now, "en").lines[0]).toContain("Done");
  });
});
describe("load balancing + specialization", () => {
  it("least loaded among the right role; paused and full are skipped", () => {
    const r = pickAssignee({ role: "content_writer" }, [{ id: "a", role: "content_writer", status: "active", load: 5 }, { id: "b", role: "content_writer", status: "active", load: 1 }, { id: "c", role: "content_writer", status: "paused", load: 0 }, { id: "d", role: "content_writer", status: "active", load: 9 }]);
    expect(r?.id).toBe("b");
  });
  it("proven specialization can outweigh a small load difference", () => {
    const r = pickAssignee({ role: "content_writer", tags: ["hebrew_post"] }, [{ id: "a", role: "content_writer", status: "active", load: 2, history: { hebrew_post: { done: 9, failed: 0 } } }, { id: "b", role: "content_writer", status: "active", load: 1, history: { hebrew_post: { done: 1, failed: 4 } } }]);
    expect(r?.id).toBe("a");
  });
  it("no one fits → null (the caller falls back to the lead)", () => expect(pickAssignee({ role: "analyst" }, [{ id: "a", role: "sales", status: "active", load: 0 }])).toBeNull());
});
