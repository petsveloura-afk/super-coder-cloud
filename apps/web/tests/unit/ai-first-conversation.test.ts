import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_AI_PAUSES, advanceFlow, isGreetingOnly, pickFlow, type Flow, type FlowState } from "@/lib/ai/flows-core";
import { angerNeedsPerson, humanRequest } from "@/lib/ai/handoff-intent-core";
import { waitingAssist, unattendedResume } from "@/lib/ai/autopilot-heal";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

const flow: Flow = {
  id: "f1",
  name: "intake",
  enabled: true,
  trigger_keywords: ["הצעת מחיר"],
  on_first_message: true,
  nodes: [
    { id: "n1", type: "buttons", text: "במה נוכל לעזור?", buttons: [{ label: "אתר", next: "n2" }, { label: "חנות", next: "n2" }] },
    { id: "n2", type: "collect", text: "איך קוראים לך?", field: "name", next: "n3" },
    { id: "n3", type: "handoff", text: "תודה!" },
  ],
};

describe("AI first: a scripted flow starts only on a bare greeting or the business's own keyword", () => {
  it("recognises bare greetings in Hebrew / English / Arabic, and nothing with content", () => {
    for (const g of ["שלום", "היי", "היי מה נשמע", "בוקר טוב", "ערב טוב!", "hello", "Hi there", "good morning", "how are you", "مرحبا", "السلام عليكم", "صباح الخير", "👋"]) expect(isGreetingOnly(g), g).toBe(true);
    for (const t of ["שלום כמה עולה אתר", "אני צריך אתר לעסק", "היי אני מחפש דף נחיתה", "מה", "כמה עולה", "hi I need a website", "0507376961", "?", "מה נשמע ומה המחיר?", ""]) expect(isGreetingOnly(t), t).toBe(false);
  });

  it("first message: greeting → the flow; a request, a statement or a question → the AI", () => {
    expect(pickFlow([flow], "שלום", true)?.id).toBe("f1");
    for (const t of ["אני צריך אתר לעסק שלי", "שלום, אני מחפש אתר", "כמה עולה אתר?", "מתי אתם פתוחים"]) expect(pickFlow([flow], t, true), t).toBeNull();
    expect(pickFlow([flow], "שלום", false)).toBeNull();
  });

  it("the business's own keyword still starts its flow, at any point", () => {
    expect(pickFlow([flow], "אפשר הצעת מחיר", false)?.id).toBe("f1");
    expect(pickFlow([flow], "אני רוצה הצעת מחיר לאתר", true)?.id).toBe("f1");
  });
});

describe("a customer who keeps talking about something else is released from the script", () => {
  const at = (id: string, data: Record<string, string> = {}): FlowState => ({ flow_id: "f1", node_id: id, data });

  it("each off-step message is answered by the AI and the step is kept; after a few, the AI takes the whole conversation", () => {
    let st: FlowState | null = at("n2");
    for (let i = 1; i < MAX_AI_PAUSES; i++) {
      const r = advanceFlow(flow, st, "כמה זמן לוקח לבנות אתר?");
      expect(r.toAI).toBe(true);
      expect(r.finished).toBe(false);
      expect(r.messages).toHaveLength(0);
      expect(r.state?.node_id).toBe("n2");
      st = r.state;
    }
    const last = advanceFlow(flow, st, "ומה לגבי תחזוקה?");
    expect(last.toAI).toBe(true);
    expect(last.finished).toBe(true);
    expect(last.state).toBeNull();
    expect(last.handoff).toBe(false);
  });

  it("a real answer moves on and resets the counter; internal keys never leak", () => {
    const first = advanceFlow(flow, at("n2"), "כמה עולה?");
    const ok = advanceFlow(flow, first.state, "דנה");
    expect(ok.handoff).toBe(true);
    expect(ok.collected.name).toBe("דנה");
    expect(Object.keys(ok.collected).some((k) => k.startsWith("_"))).toBe(false);
  });

  it("a message that is not one of the buttons goes to the AI instead of repeating the buttons", () => {
    const r = advanceFlow(flow, at("n1"), "יש לכם גם קמפיינים?");
    expect(r.toAI).toBe(true);
    expect(r.messages).toHaveLength(0);
    expect(r.state?.node_id).toBe("n1");
  });
});

describe("phone step (same as the CI flow-engine test)", () => {
  const f: Flow = { id: "f", name: "p", enabled: true, trigger_keywords: [], on_first_message: true, nodes: [{ id: "phone", type: "collect", field: "phone", text: "טלפון?", next: "end" }, { id: "end", type: "end", text: "תודה" }] };
  it("any digits count as an attempt: one retry, then the AI", () => {
    const a = advanceFlow(f, null, "היי");
    const bad = advanceFlow(f, a.state, "12");
    expect(bad.invalid).toBe(true);
    expect(advanceFlow(f, bad.state, "12").toAI).toBe(true);
    expect(advanceFlow(f, a.state, "054-111 2233").finished).toBe(true);
  });
});

describe("while the team has not answered, the agent never leaves the customer in silence", () => {
  const now = Date.now();
  const base = { note: "customer_asked", handoffAt: new Date(now - 60_000).toISOString(), ownerTakeoverAt: null, teamAnsweredSince: false, now };

  it("answers the next message after the agent's own hand-over (nothing configured)", () => {
    for (const note of ["customer_asked", "flow", "agent", "guardrail_price", "stuck_no_answer"]) expect(waitingAssist({ ...base, note }), note).toBe(true);
  });

  it("stays out as soon as a person really wrote, and never for threats / banned / credits / budget / anger", () => {
    expect(waitingAssist({ ...base, teamAnsweredSince: true })).toBe(false);
    expect(waitingAssist({ ...base, ownerTakeoverAt: new Date(now - 1000).toISOString() })).toBe(false);
    for (const note of ["critical:legal_or_threat", "guardrail_banned", "plan_limit:ai_credits", "ai_budget", "angry_customer"]) expect(waitingAssist({ ...base, note }), note).toBe(false);
    expect(waitingAssist({ ...base, handoffAt: null })).toBe(false);
  });

  it("a business that chose its own time (including 0 = never) keeps exactly that choice", () => {
    expect(waitingAssist({ ...base, minutes: 0 })).toBe(false);
    expect(waitingAssist({ ...base, minutes: 30 })).toBe(false);
    expect(unattendedResume({ ...base, minutes: 30, handoffAt: new Date(now - 31 * 60_000).toISOString() })).toBe(true);
  });
});

describe("wiring", () => {
  it("the autopilot uses waitingAssist and hands the flow's hint to the AI", () => {
    const a = read("lib/ai/autopilot.ts");
    expect(a).toContain("waitingAssist({ note: nr.ai_note");
    expect(a).toContain("flowRes.aiHint");
    expect(a).toContain("humanRequest(lastLine)");
    expect(a).toContain("angerNeedsPerson(lastLine)");
    expect(a).toContain("${flowHint ?");
    expect(a).toContain('.or("sent_by.not.is.null,meta->>owner.eq.true")');
  });
});

describe("a customer who wants a person gets one — and a mention is not a request", () => {
  it("clear requests in three languages hand over", () => {
    for (const t of ["אני רוצה לדבר עם נציג", "נציג", "נציג בבקשה", "תעבירו אותי לבן אדם", "אפשר לדבר עם מישהו אמיתי?", "can I talk to a human please", "human", "I want to speak with a representative", "أريد التحدث مع موظف"]) expect(humanRequest(t), t).toBe("yes");
  });

  it("negations, compliments and stories about the past do not hand over", () => {
    for (const t of ["אני לא צריך נציג, תענה לי", "בלי נציג בבקשה, רק תגיד כמה עולה", "הנציג שלכם עזר לי מאוד אתמול", "דיברתי עם נציג והוא אמר שתחזרו אליי", "I don't need a human, just tell me the price", "the representative helped me yesterday", "מה שעות הפתיחה?"]) expect(humanRequest(t), t).not.toBe("yes");
  });

  it("an unclear mention is left to the AI to decide from context", () => {
    expect(humanRequest("שמעתי שיש אצלכם נציג שמטפל בהצעות מחיר למסעדות באזור המרכז")).toBe("maybe");
  });
});

describe("anger detection ignores harmless look-alikes but still catches the real thing", () => {
  it("real anger and threats still hand over", () => {
    for (const t of ["אתם נוכלים, אני הולך לעורך דין", "this is a scam", "אני כועס מאוד, זה בושה וחרפה", "אתבע אתכם"]) expect(angerNeedsPerson(t), t).toBe(true);
  });
  it("a profession, \"we could\" or a denied feeling is not anger", () => {
    for (const t of ["אני עורך דין ואני צריך אתר למשרד", "אם נוכל להגיע מחר זה יעבוד", "אני לא כועס, רק רוצה להבין", "I'm a lawyer and I need a website", "תודה רבה!"]) expect(angerNeedsPerson(t), t).toBe(false);
  });
  it("a lawyer who is also angry is still caught", () => {
    expect(angerNeedsPerson("אני עורך דין ואתם נוכלים")).toBe(true);
  });
});
