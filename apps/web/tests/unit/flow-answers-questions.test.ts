import { describe, expect, it } from "vitest";
import { DEFAULT_RESUME_MINUTES } from "@/lib/ai/resume";
import { advanceFlow, looksLikeQuestion, pickFlow, type Flow } from "@/lib/ai/flows-core";

const flow: Flow = {
  id: "f1",
  name: "intake",
  enabled: true,
  trigger_keywords: [],
  on_first_message: true,
  nodes: [
    { id: "n1", type: "collect", text: "מה מחפשים?", field: "need", next: "n2" },
    { id: "n2", type: "collect", text: "מתי זה רלוונטי?", field: "date", next: "n3" },
    { id: "n3", type: "collect", text: "מה מספר הטלפון לחזרה?", field: "phone", next: "n4" },
    { id: "n4", type: "handoff", text: "תודה! נציג יחזור אליך" },
  ],
};
const at = (id: string) => ({ flow_id: "f1", node_id: id, data: {} as Record<string, string> });

describe("a flow never swallows a customer's question", () => {
  it("recognises questions in Hebrew / English, but not plain answers", () => {
    for (const q of ["כמה עולה אתר ?", "שאלתי כמה עולה אתר קודם מה המחיר", "??", "שאלתי שאלה", "how much is a site", "מה כולל המחיר"]) expect(looksLikeQuestion(q), q).toBe(true);
    for (const a of ["עכשיו", "0507376961", "דף נחיתה לעסק", "דנה לוי", "a@b.co"]) expect(looksLikeQuestion(a), a).toBe(false);
  });

  it("a first message that is a question is answered by the AI, not by the questionnaire", () => {
    expect(pickFlow([flow], "שלום כמה עולה אתר ?", true)).toBeNull();
    expect(pickFlow([flow], "שלום", true)?.id).toBe("f1");
  });

  it("a question on a collect step pauses the flow for the AI and keeps the step", () => {
    for (const [node, text] of [["n1", "כמה עולה אתר ?"], ["n2", "רגע קודם תעני כמה עולה אתר ?"], ["n3", "שאלתי כמה עולה אתר קודם מה המחיר"], ["n3", "??"]] as const) {
      const r = advanceFlow(flow, at(node), text);
      expect(r.toAI, text).toBe(true);
      expect(r.messages, text).toHaveLength(0);
      expect(r.state?.node_id, text).toBe(node);
    }
  });

  it("an incomplete phone gets ONE polite retry; the second miss goes to the AI instead of looping", () => {
    const first = advanceFlow(flow, at("n3"), "05073");
    expect(first.messages[0]?.text).toMatch(/לא מלא/);
    expect(first.toAI).toBe(false);
    const second = advanceFlow(flow, first.state, "05073");
    expect(second.toAI).toBe(true);
    expect(second.messages).toHaveLength(0);
  });

  it("real answers still move the flow forward and retry counters never reach the contact note", () => {
    const a = advanceFlow(flow, at("n1"), "דף נחיתה לעסק");
    expect(a.state?.node_id).toBe("n2");
    const r = advanceFlow(flow, { ...at("n3"), data: { need: "אתר", _retry_n3: "1" } }, "0507376961");
    expect(r.handoff).toBe(true);
    expect(r.collected.phone).toBe("0507376961");
    expect(Object.keys(r.collected).some((k) => k.startsWith("_"))).toBe(false);
  });
});

describe("the agent stays out of a conversation a person took, until \"return to agent\"", () => {
  it("auto-resume is off by default (a business can still choose a time)", () => {
    expect(DEFAULT_RESUME_MINUTES).toBe(0);
  });
});
