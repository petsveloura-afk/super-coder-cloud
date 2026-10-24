import { describe, expect, it } from "vitest";
import { classifyOwnerMessage, normalizeForCompare } from "@/lib/channels/owner-core";
import { aiNoteKey, resumeAt, resumeInMinutes } from "@/lib/inbox/ai-note";

const T0 = Date.UTC(2026, 9, 24, 10, 0, 0);

describe("a message from the business's phone: owner typing, automatic, or the agent's own echo", () => {
  const base = { recentAgentTexts: [] as string[], seenInOtherChats: false };
  it("the agent's own answer coming back (whole or one bubble) is an echo", () => {
    const agent = "שלום דנה! 😊 תספורת לכלב קטן עולה 120 ₪.\n\nרוצה שאקבע לך תור למחר?";
    expect(classifyOwnerMessage({ ...base, text: agent, sentAtMs: T0, lastInboundAtMs: T0 - 20_000, recentAgentTexts: [agent] }).kind).toBe("echo");
    expect(classifyOwnerMessage({ ...base, text: "רוצה שאקבע לך תור למחר?", sentAtMs: T0, lastInboundAtMs: T0 - 20_000, recentAgentTexts: [agent] }).kind).toBe("echo");
    expect(classifyOwnerMessage({ ...base, text: "*שלום  דנה!* 😊 תספורת לכלב קטן עולה 120 ₪.‏\n\nרוצה שאקבע לך תור למחר?", sentAtMs: T0, lastInboundAtMs: null, recentAgentTexts: [agent] }).kind).toBe("echo");
    // a short "ok" is not taken as an echo of a long answer that happens to contain it
    expect(classifyOwnerMessage({ ...base, text: "כן", sentAtMs: T0, lastInboundAtMs: T0 - 60_000, recentAgentTexts: ["כן, יש לנו תור"] }).kind).toBe("person");
  });
  it("a greeting / away message fires within seconds of the customer → automatic", () => {
    expect(classifyOwnerMessage({ ...base, text: "שלום! תודה שפנית לפט-ליין, נחזור אליך בהקדם", sentAtMs: T0 + 1_200, lastInboundAtMs: T0 })).toEqual({ kind: "auto", reason: "instant_reply" });
    // the phone clock can be a little behind the server
    expect(classifyOwnerMessage({ ...base, text: "אנחנו סגורים כרגע", sentAtMs: T0 - 2_000, lastInboundAtMs: T0 }).kind).toBe("auto");
  });
  it("a template sent to other customers too, shortly after the customer wrote → automatic", () => {
    expect(classifyOwnerMessage({ ...base, text: "היי! קיבלנו את ההודעה", sentAtMs: T0 + 30_000, lastInboundAtMs: T0, seenInOtherChats: true })).toEqual({ kind: "auto", reason: "template" });
    // the same template much later is the owner using a quick reply → the owner
    expect(classifyOwnerMessage({ ...base, text: "היי! קיבלנו את ההודעה", sentAtMs: T0 + 10 * 60_000, lastInboundAtMs: T0, seenInOtherChats: true }).kind).toBe("person");
  });
  it("without the phone's own time (older bridge) a quick message is not called automatic", () => {
    expect(classifyOwnerMessage({ ...base, text: "היי, כאן שירה", sentAtMs: null, arrivedAtMs: T0 + 2_000, lastInboundAtMs: T0 }).kind).toBe("person");
    expect(classifyOwnerMessage({ ...base, text: "היי! קיבלנו את ההודעה", sentAtMs: null, arrivedAtMs: T0 + 2_000, lastInboundAtMs: T0, seenInOtherChats: true }).kind).toBe("auto");
  });
  it("the owner really typing → the agent steps back", () => {
    expect(classifyOwnerMessage({ ...base, text: "היי דנה, כאן שירה. מחר ב-10 מתאים?", sentAtMs: T0 + 45_000, lastInboundAtMs: T0 })).toEqual({ kind: "person", reason: "owner_typed" });
    // the owner starts a chat himself (no customer message yet)
    expect(classifyOwnerMessage({ ...base, text: "שלום, רציתי לעדכן", sentAtMs: T0, lastInboundAtMs: null }).kind).toBe("person");
  });
  it("normalisation ignores formatting and invisible marks", () => {
    expect(normalizeForCompare("  *Hi*‏   there ")).toBe("hi there");
  });
});

describe("inbox: why the agent stopped", () => {
  it("reason codes in plain categories", () => {
    expect(aiNoteKey("owner_phone")).toBe("owner_phone");
    expect(aiNoteKey("customer_asked")).toBe("customer_asked");
    expect(aiNoteKey("angry_customer")).toBe("angry");
    expect(aiNoteKey("guardrail_price")).toBe("unsure");
    expect(aiNoteKey("critical:legal_or_threat")).toBe("critical");
    expect(aiNoteKey("ai.plan_limit")).toBe("credits");
    expect(aiNoteKey("ai_busy")).toBe("busy");
    expect(aiNoteKey(null)).toBe("agent");
  });
  it("when the agent comes back after the owner wrote", () => {
    const at = new Date(T0).toISOString();
    expect(resumeAt(at, 30)!.toISOString()).toBe(new Date(T0 + 30 * 60_000).toISOString());
    expect(resumeAt(at, 0)).toBeNull();
    expect(resumeInMinutes(at, 30, T0 + 10 * 60_000)).toBe(20);
    expect(resumeInMinutes(at, 30, T0 + 31 * 60_000)).toBe(0);
    expect(resumeInMinutes(null, 30, T0)).toBeNull();
  });
});
