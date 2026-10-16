import { describe, expect, it } from "vitest";
import { buttonsAsText, fallbackMessage, parseAgentTools, parseLeadFields, salesAgentInstructions, telegramHtml } from "@/lib/ai/autopilot-core";

describe("sales agent tools", () => {
  it("extracts lead, buttons, share-phone and handoff, and cleans the customer text", () => {
    const t = parseAgentTools(
      "מעולה, רשמתי! 🙌\n[[LEAD: name=רון לוי; phone=054-111-2233; email=Ron@Mail.com; need=תספורת; budget=150 ₪; score=HOT; summary=רוצה מחר בבוקר]]\n[[BUTTONS: בוקר | צהריים | ערב | לילה]]\n[[ASK_PHONE]]",
    );
    expect(t.text).toBe("מעולה, רשמתי! 🙌");
    expect(t.lead).toEqual({ name: "רון לוי", phone: "0541112233", email: "Ron@Mail.com", need: "תספורת", budget: "150 ₪", score: "hot", summary: "רוצה מחר בבוקר" });
    expect(t.buttons).toEqual(["בוקר", "צהריים", "ערב"]);
    expect(t.askPhone).toBe(true);
    expect(t.handoff).toBe(false);
    const h = parseAgentTools("אעביר לנציג [[HANDOFF: discount]]");
    expect(h).toMatchObject({ text: "אעביר לנציג", handoff: true, reason: "discount", lead: null, buttons: [], askPhone: false });
  });

  it("drops unknown / empty / invalid lead fields", () => {
    expect(parseLeadFields("name=-; phone=abc; email=bad; score=super; foo=bar")).toBeNull();
    expect(parseLeadFields("need=אמבטיה; score=cold")).toEqual({ need: "אמבטיה", score: "cold" });
  });

  it("writes the profile, the goal, the tone and the tools into the prompt", () => {
    const p = salesAgentInstructions({ profile: { business: "מספרה לכלבים", services: "תספורת 150 ₪", hours: "9-19", tone: "luxury" }, goal: "booking", channel: "telegram" });
    expect(p).toContain("מספרה לכלבים");
    expect(p).toContain("תספורת 150 ₪");
    expect(p).toContain("Book an appointment");
    expect(p).toContain("premium");
    expect(p).toContain("[[LEAD:");
    expect(p).toContain("[[BUTTONS:");
    expect(p).toContain("[[ASK_PHONE]]");
    const mail = salesAgentInstructions({ channel: "email", leadKnown: { score: "hot" } });
    expect(mail).not.toContain("[[BUTTONS:");
    expect(mail).not.toContain("[[ASK_PHONE]]");
    expect(mail).toContain("already saved as a hot lead");
  });

  it("renders buttons as text, a fallback reply and safe Telegram HTML", () => {
    expect(buttonsAsText("בחרו:", ["א", "ב"])).toBe("בחרו:\n\n1. א\n2. ב");
    expect(fallbackMessage("he")).toContain("נציג");
    expect(telegramHtml("**חשוב** <script>&")).toBe("<b>חשוב</b> &lt;script&gt;&amp;");
  });
});
