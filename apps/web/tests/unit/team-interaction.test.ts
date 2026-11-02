import { describe, expect, it } from "vitest";
import { classifyObjection, detectEmotion, inferStyle, interactionGuidance, interactionPrompt, ownerPrompt, ownerStyle, shouldEscalateToHuman } from "@/lib/team/interaction-core";

describe("emotion and urgency", () => {
  it("reads an angry, urgent Hebrew message", () => {
    const r = detectEmotion("אני ממש מתוסכל!! צריך תשובה דחוף היום");
    expect(r.emotion).toBe("angry");
    expect(r.urgency).toBeGreaterThanOrEqual(0.5);
  });
  it("reads happy, confused and neutral", () => {
    expect(detectEmotion("תודה רבה, מושלם").emotion).toBe("happy");
    expect(detectEmotion("I don't understand how this works").emotion).toBe("confused");
    expect(detectEmotion("מה שעות הפתיחה?").emotion).toBe("neutral");
  });
});

describe("objections", () => {
  it("classifies the common ones in three languages", () => {
    expect(classifyObjection("זה יקר לי מדי")).toBe("price");
    expect(classifyObjection("I found it cheaper at another company")).toBe("competitor");
    expect(classifyObjection("لازم أسأل زوجي")).toBe("authority");
    expect(classifyObjection("אחזור אליך בעוד כמה שבועות")).toBe("timing");
    expect(classifyObjection("שלום")).toBe("none");
  });
});

describe("style and guidance", () => {
  it("learns a brief, warm or formal style from the customer's own messages", () => {
    expect(inferStyle(["כמה?", "מתי?"]).register).toBe("brief");
    expect(inferStyle(["היי מה קורה, רציתי לשאול משהו על התור שלי 🙂 תודה רבה על העזרה"]).register).toBe("warm");
    expect(inferStyle(["שלום רב, אבקש לקבל הצעת מחיר מסודרת לשירות החודשי. בברכה, דוד"]).register).toBe("business");
  });
  it("always carries the ethical persuasion rule and never suggests pressure", () => {
    const p = interactionPrompt({ message: "זה יקר" });
    expect(p).toMatch(/never pressure/i);
    expect(p).not.toMatch(/limited time|last chance/i);
  });
  it("escalates serious situations to a person and not ordinary ones", () => {
    expect(interactionGuidance({ message: "נמאס לי מהשירות", complaints: 1 }).escalate).toBe("repeat_complaint");
    expect(interactionGuidance({ message: "שירות מחורבן!!! נמאס!!!" }).escalate).toBe("angry_customer");
    expect(shouldEscalateToHuman(detectEmotion("מה המחיר?"), "none")).toBeNull();
    expect(shouldEscalateToHuman(detectEmotion("סבא שלי נפטר"), "none")).toBe("sensitive_situation");
  });
  it("adapts to the owner's style", () => {
    expect(ownerStyle(["כן", "לא, דחה", "אשר"]).prefersShort).toBe(true);
    expect(ownerPrompt(ownerStyle([]))).toMatch(/ONE question/);
  });
});
