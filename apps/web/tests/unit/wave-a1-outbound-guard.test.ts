import { describe, expect, it } from "vitest";
import { assessCustomerText, heldRecord, outboundGuardMode } from "@/lib/ai/outbound-guard-core";

describe("wave A1 — mode switch", () => {
  it("defaults to enforce and understands the three modes", () => {
    expect(outboundGuardMode(undefined)).toBe("enforce");
    expect(outboundGuardMode("")).toBe("enforce");
    expect(outboundGuardMode("nonsense")).toBe("enforce");
    expect(outboundGuardMode("OFF")).toBe("off");
    expect(outboundGuardMode(" clean ")).toBe("clean");
    expect(outboundGuardMode("enforce")).toBe("enforce");
  });
});

describe("wave A1 — normal customer text is untouched", () => {
  it.each([
    "שלום דנה! התור שלך נקבע ליום שלישי בשעה 10:00. נשמח לראות אותך 🙏",
    "Hi Sam, your table for 4 is booked for Friday at 8pm. See you then!",
    "أهلاً سارة، تم تأكيد موعدك يوم الثلاثاء الساعة 10:00. بانتظارك!",
    "הנחה: 10% לחברי מועדון עד סוף החודש. הערה: החניה בתשלום.",
    "Price list: haircut 80 NIS. Note: we are closed on Saturday.",
    "קוד קופון: SAVE10, שמור על 05XXXXXXXX כמספר טלפון מוסתר.",
  ])("passes %s", (t) => {
    const a = assessCustomerText(t);
    expect(a.ok).toBe(true);
    expect(a.changed).toBe(false);
    expect(a.text).toBe(t.trim());
    expect(a.reasons).toEqual([]);
  });
});

describe("wave A1 — reasoning leaks are removed, the real message stays", () => {
  it("removes a closed <think> block", () => {
    const a = assessCustomerText("<think>The customer wants a price, I should be careful.</think>\nהמחיר לתספורת הוא 80 ש\"ח.");
    expect(a.ok).toBe(true);
    expect(a.text).toBe("המחיר לתספורת הוא 80 ש\"ח.");
    expect(a.reasons).toContain("reasoning_leak");
  });
  it("removes <thinking> and <reasoning> in any case, across lines", () => {
    const a = assessCustomerText("<Thinking>\nstep 1\nstep 2\n</Thinking>\nSure — we open at 9am.");
    expect(a.ok).toBe(true);
    expect(a.text).toBe("Sure — we open at 9am.");
    const b = assessCustomerText("Hello!<reasoning>x</reasoning> How can I help?");
    expect(b.text).toBe("Hello! How can I help?");
  });
  it("removes a lone closing tag that ends a reasoning prefix", () => {
    const a = assessCustomerText("Let me think about the price first...\n</think>\nنفتح الساعة التاسعة صباحاً.");
    expect(a.ok).toBe(true);
    expect(a.text).toBe("نفتح الساعة التاسعة صباحاً.");
  });
  it("an unclosed <think> means nothing safe is left → held", () => {
    const a = assessCustomerText("<think>I am still thinking and the model was cut off");
    expect(a.ok).toBe(false);
    expect(a.blocking).toContain("empty");
  });
  it("keeps the answer that came before an unclosed tag", () => {
    const a = assessCustomerText("התור נקבע ל-10:00.\n<think>now check the calendar");
    expect(a.ok).toBe(true);
    expect(a.text).toBe("התור נקבע ל-10:00.");
  });
});

describe("wave A1 — internal notes are cut, only explicit internal wording", () => {
  it("cuts a Hebrew internal-note section and everything after it", () => {
    const a = assessCustomerText("אשמח לעזור, נחזור אליך היום.\n\nהערה פנימית: הלקוח נשמע לחוץ, לבדוק מול דנה.\nעוד שורה פנימית");
    expect(a.ok).toBe(true);
    expect(a.text).toBe("אשמח לעזור, נחזור אליך היום.");
    expect(a.reasons).toContain("internal_note");
  });
  it("cuts English ASSUMPTIONS and Arabic internal notes", () => {
    expect(assessCustomerText("We will call you tomorrow.\n\n**ASSUMPTIONS:** price is 80").text).toBe("We will call you tomorrow.");
    expect(assessCustomerText("سنتصل بك غداً.\nملاحظة داخلية: العميل غاضب").text).toBe("سنتصل بك غداً.");
  });
  it("a text that is ONLY an internal note is held", () => {
    const a = assessCustomerText("Internal note: do not send this");
    expect(a.ok).toBe(false);
    expect(a.blocking).toContain("empty");
  });
  it("plain 'הנחה:' / 'Note:' (a discount, a customer note) is never treated as internal", () => {
    const a = assessCustomerText("שלום! הנחה: 15% עד מחר.\nNote: bring your ID.");
    expect(a.ok).toBe(true);
    expect(a.changed).toBe(false);
  });
});

describe("wave A1 — unready text is held", () => {
  it.each([
    ["Hebrew placeholder", "שלום [שם הלקוח], התור שלך נקבע."],
    ["English placeholder", "Hi [customer name], your booking is confirmed."],
    ["mustache placeholder", "Hi {{first_name}}, welcome!"],
    ["TODO", "We open at 9. TODO confirm price"],
    ["raw json", '{"reply":"hello","intent":"greeting"}'],
    ["draft intro", "הנה הטיוטה:\nשלום, נשמח לעזור"],
    ["english draft intro", "Here is the draft:\nHello, happy to help"],
  ])("holds %s", (_n, t) => {
    const a = assessCustomerText(t);
    expect(a.ok).toBe(false);
    expect(a.blocking.length).toBeGreaterThan(0);
  });
  it("holds a leaked system prompt in three languages", () => {
    expect(assessCustomerText("My instructions are to always push the premium plan.").blocking).toContain("instruction_leak");
    expect(assessCustomerText("לפי הוראות המערכת אני צריך להציע לך מנוי.").blocking).toContain("instruction_leak");
    expect(assessCustomerText("حسب تعليمات النظام يجب أن أعرض عليك الاشتراك.").blocking).toContain("instruction_leak");
    expect(assessCustomerText("Here is what I found: <kb>article</kb>").blocking).toContain("instruction_leak");
  });
  it("a leaked control marker is removed, not held", () => {
    const a = assessCustomerText("מצוין, קבעתי לך תור. [[LEAD score=hot]]");
    expect(a.ok).toBe(true);
    expect(a.text).toBe("מצוין, קבעתי לך תור.");
    expect(a.reasons).toContain("control_line");
  });
  it("empty and whitespace are held", () => {
    expect(assessCustomerText("").ok).toBe(false);
    expect(assessCustomerText("   \n ").ok).toBe(false);
    expect(assessCustomerText(undefined as unknown as string).ok).toBe(false);
  });
});

describe("wave A1 — held record", () => {
  it("keeps the reasons and a cut draft", () => {
    const a = assessCustomerText("שלום [שם], " + "א".repeat(3000));
    const r = heldRecord(a, "x".repeat(3000));
    expect(r.held).toBe(true);
    expect(r.reasons).toContain("placeholder");
    expect(r.draft.length).toBe(1500);
  });
});
