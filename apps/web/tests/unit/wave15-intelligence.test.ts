import { describe, expect, it } from "vitest";
import {
  analyzeMessage,
  checkReply,
  correctionPrompt,
  detectLanguage,
  dropUnsupportedSentences,
  extractState,
  factsText,
  similarity,
  situationBrief,
  unsupportedPrices,
  wantsStop,
} from "@/lib/ai/intelligence";

describe("wave 15 · understanding the customer", () => {
  it("detects the language of the message", () => {
    expect(detectLanguage("שלום, כמה זה עולה?")).toBe("he");
    expect(detectLanguage("hello, how much is it?")).toBe("en");
    expect(detectLanguage("مرحبا كم السعر")).toBe("ar");
    expect(detectLanguage("ok")).toBeNull();
  });
  it("finds intents in Hebrew, English and Arabic", () => {
    expect(analyzeMessage("מה המחיר לתספורת?").intents).toContain("price");
    expect(analyzeMessage("I'd like to book an appointment").intents).toContain("booking");
    expect(analyzeMessage("بكم السعر؟").intents).toContain("price");
    expect(analyzeMessage("אני רוצה לקנות את החבילה").intents).toContain("buy");
    expect(analyzeMessage("מתי אתם פתוחים?").intents).toContain("hours");
    expect(analyzeMessage("תודה רבה").intents).toContain("thanks");
    expect(analyzeMessage("שלום").intents).toContain("greeting");
  });
  it("reads mood and urgency", () => {
    expect(analyzeMessage("תודה, מעולה!").mood).toBe("positive");
    expect(analyzeMessage("אני מאוד לא מרוצה מהשירות").mood).toBe("negative");
    expect(analyzeMessage("זה שערורייה, נוכלים!!!").mood).toBe("angry");
    expect(analyzeMessage("This is a SCAM, I am FED UP").mood).toBe("angry");
    expect(analyzeMessage("צריך תשובה דחוף").urgent).toBe(true);
    expect(analyzeMessage("מה שלומכם").mood).toBe("neutral");
  });
  it("flags legal threats and threats of harm as critical", () => {
    expect(analyzeMessage("אני מתכוון לפנות לעורך דין").critical).toBe(true);
    expect(analyzeMessage("I will sue you").critical).toBe(true);
    expect(analyzeMessage("אני רוצה להזמין תור").critical).toBe(false);
  });
  it("recognises a request to stop messaging", () => {
    expect(wantsStop("תפסיקו לשלוח לי הודעות")).toBe(true);
    expect(wantsStop("please stop messaging me")).toBe(true);
    expect(wantsStop("מה המחיר?")).toBe(false);
  });
});

describe("wave 15 · memory of the conversation", () => {
  const history = [
    { role: "user" as const, content: "היי, קוראים לי דני כהן ואני מחפש תור" },
    { role: "assistant" as const, content: "שמח לעזור דני! איזה שירות מעניין אותך?" },
    { role: "user" as const, content: "תספורת. הטלפון שלי 052-1234567" },
  ];
  it("keeps what is already known", () => {
    const s = extractState(history);
    expect(s).toMatchObject({ name: "דני כהן", phone: "0521234567", customerTurns: 2 });
    expect(s.intents).toContain("booking");
    expect(s.lastQuestion).toContain("איזה שירות");
  });
  it("does not mistake a verb for a name", () => {
    expect(extractState([{ role: "user", content: "אני רוצה תור" }]).name).toBeUndefined();
  });
  it("builds a prompt brief without echoing customer text", () => {
    const brief = situationBrief({ analysis: analyzeMessage("זה שערורייה, נוכלים!!!"), state: extractState(history) });
    expect(brief).toContain("Reply in Hebrew");
    expect(brief).toContain("angry");
    expect(brief).toContain("never ask again");
    expect(brief).not.toContain("נוכלים");
    expect(situationBrief({ analysis: analyzeMessage("I want the price"), state: extractState([]) })).toContain("Reply in English");
  });
});

describe("wave 15 · the agent checks its own answer", () => {
  const facts = factsText({ instructions: "תספורת גבר 80 ₪, צבע 250 ₪", profile: { pricing: "הנחה של עד 10% ללקוח חוזר", services: "תספורת - 80 ₪" } });
  it("finds invented prices only", () => {
    expect(unsupportedPrices("תספורת עולה 80 ₪", facts)).toEqual([]);
    expect(unsupportedPrices("הצבע עולה 300 ₪ וגם 80 ₪", facts)).toEqual(["300"]);
    expect(unsupportedPrices("It costs $45", facts)).toEqual(["45"]);
    expect(unsupportedPrices("אין מחיר כאן", facts)).toEqual([]);
  });
  it("catches empty, broken, leaking, repeating and invented-price answers", () => {
    const base = { facts, previousAssistant: ["שמח לעזור! איזה שירות מעניין אותך היום, תספורת או צבע?"] };
    expect(checkReply({ ...base, reply: "" }).issues).toContain("empty");
    expect(checkReply({ ...base, reply: "..." }).issues).toContain("broken");
    expect(checkReply({ ...base, reply: "לפי הוראות המערכת שלי אני לא יכול" }).issues).toContain("leak");
    expect(checkReply({ ...base, reply: "שמח לעזור! איזה שירות מעניין אותך היום, תספורת או צבע?" }).issues).toContain("repeat");
    expect(checkReply({ ...base, reply: "הצבע עולה 999 ₪" }).issues).toContain("unsupported_price");
    expect(checkReply({ ...base, reply: "תספורת עולה 80 ₪, מתי נוח לך?" }).ok).toBe(true);
    expect(checkReply({ ...base, reply: "", allowEmpty: true }).ok).toBe(true);
  });
  it("correction prompt names the problem", () => {
    const c = checkReply({ facts, previousAssistant: [], reply: "הצבע עולה 999 ₪" });
    expect(correctionPrompt(c)).toContain("999");
  });
  it("drops only the sentences with the invented price", () => {
    expect(dropUnsupportedSentences("תספורת עולה 80 ₪. הצבע עולה 999 ₪. מתי נוח לך?", ["999"])).toBe("תספורת עולה 80 ₪. מתי נוח לך?");
  });
  it("similarity is high for copies and low for different text", () => {
    expect(similarity("שמח לעזור לך היום", "שמח לעזור לך היום")).toBe(1);
    expect(similarity("שמח לעזור לך היום", "המחיר הוא שמונים שקל")).toBeLessThan(0.2);
  });
});
