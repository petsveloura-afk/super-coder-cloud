import { describe, expect, it } from "vitest";
import { isStopUpdates, newInviteCode, normalizeTarget, notifyEmailHtml, notifySubject, notifyTelegramHtml, notifyText, parseNotifyStart, telegramTarget } from "@/lib/notify/format";

/** Wave 10 — team updates and Telegram Business helpers. */
describe("team update texts", () => {
  const base = { orgName: "מספרת <כלבים>", customer: "דנה", channel: "telegram", link: "https://app.example/he/inbox?c=1" };

  it("conversation update: customer + agent lines, channel and link", () => {
    const t = notifyText("messages", { ...base, customerText: "כמה עולה?", agentText: "150 ₪ 🙂", agentName: "נועה" });
    expect(t.split("\n")).toEqual(["💬 מספרת <כלבים> · Telegram", "👤 דנה: כמה עולה?", "🤖 נועה: 150 ₪ 🙂", "🔗 https://app.example/he/inbox?c=1"]);
  });

  it("lead update: hot marker, contact, need, budget, summary", () => {
    const t = notifyText("leads", { ...base, lead: { name: "דנה כהן", phone: "0501234567", need: "תספורת", budget: "150", score: "hot", summary: "רוצה מחר" } });
    expect(t).toContain("🔥 ליד חם · מספרת <כלבים> · Telegram");
    expect(t).toContain("👤 דנה כהן · 📞 0501234567");
    expect(t).toContain("🎯 תספורת");
    expect(t).toContain("📝 רוצה מחר");
    expect(notifySubject("leads", { ...base, lead: { name: "דנה כהן", score: "hot" } })).toBe("🔥 ליד חם: דנה כהן · מספרת <כלבים>");
  });

  it("handoff update and long texts are clipped (SMS shorter)", () => {
    const long = "א".repeat(2000);
    const t = notifyText("handoff", { ...base, reason: "refund", customerText: long });
    expect(t).toContain("🙋 נדרש נציג");
    expect(t).toContain("refund");
    expect(t.length).toBeLessThan(1100);
    expect(notifyText("handoff", { ...base, customerText: long }, { short: true }).length).toBeLessThan(400);
  });

  it("Telegram HTML and e-mail HTML escape the business name", () => {
    const h = notifyTelegramHtml("messages", { ...base, customerText: "<b>x</b>" });
    expect(h.startsWith("<b>💬 מספרת &lt;כלבים&gt;")).toBe(true);
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    const e = notifyEmailHtml("leads", { ...base, lead: { name: "דנה" } });
    expect(e).toContain('dir="rtl"');
    expect(e).toContain("מספרת &lt;כלבים&gt;");
    expect(e).toContain('href="https://app.example/he/inbox?c=1"');
  });
});

describe("invites, targets and business chats", () => {
  it("invite codes match the database rule and the /start payload", () => {
    const code = newInviteCode();
    expect(code).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(parseNotifyStart(`/start n_${code}`)).toBe(code);
    expect(parseNotifyStart(`/start@MyBot n_${code}`)).toBe(code);
    expect(parseNotifyStart("/start")).toBeNull();
    expect(parseNotifyStart("/start n_bad!")).toBeNull();
    expect(parseNotifyStart("hello n_abcdefgh")).toBeNull();
    expect(isStopUpdates("/stop_updates")).toBe(true);
    expect(isStopUpdates("stop")).toBe(false);
  });

  it("normalises e-mails and Israeli / international phone numbers", () => {
    expect(normalizeTarget("email", " Dan@Example.COM ")).toBe("dan@example.com");
    expect(normalizeTarget("email", "not-an-email")).toBeNull();
    expect(normalizeTarget("whatsapp", "050-123-4567")).toBe("+972501234567");
    expect(normalizeTarget("sms", "+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizeTarget("sms", "12")).toBeNull();
    expect(normalizeTarget("telegram", "anything")).toBeNull();
  });

  it("business chats are kept apart from the bot chat with the same person", () => {
    expect(telegramTarget("biz:123456")).toEqual({ chatId: "123456", business: true });
    expect(telegramTarget("123456")).toEqual({ chatId: "123456", business: false });
  });
});
