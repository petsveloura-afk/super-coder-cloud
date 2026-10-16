import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  autopilotInstructions,
  buildHistory,
  extractContactInfo,
  formatForChannel,
  isAutomatedEmail,
  parseAutopilotReply,
  wantsHuman,
  welcomeMessage,
} from "@/lib/ai/autopilot-core";
import { detectMailServers, renderEmailHtml, replySubject, stripQuotedReply, threadHeaders } from "@/lib/channels/email-core";
import { verifyBridgeSignature } from "@/lib/channels/wa-bridge";
import { emailFromIdToken } from "@/lib/channels/oauth-mail";

describe("autopilot core", () => {
  it("finds phone numbers and e-mails customers type", () => {
    expect(extractContactInfo("אפשר לחזור אליי 054-1234567 תודה")).toEqual({ phone: "0541234567" });
    expect(extractContactInfo("my mail is Dana.K@Example.com and +972 52 765 4321")).toEqual({ email: "dana.k@example.com", phone: "+972527654321" });
    expect(extractContactInfo("כמה עולה תספורת?")).toEqual({});
  });

  it("strips the handoff marker and reports the reason", () => {
    expect(parseAutopilotReply("אעביר לנציג 🙏\n[[HANDOFF: refund]]")).toEqual({ text: "אעביר לנציג 🙏", handoff: true, reason: "refund" });
    expect(parseAutopilotReply("Sure! [[handoff]]")).toEqual({ text: "Sure!", handoff: true, reason: null });
    expect(parseAutopilotReply("רגיל")).toEqual({ text: "רגיל", handoff: false, reason: null });
  });

  it("recognises a request for a human in he / en / ar", () => {
    expect(wantsHuman("אני רוצה לדבר עם נציג")).toBe(true);
    expect(wantsHuman("can I talk to a human please")).toBe(true);
    expect(wantsHuman("أريد التحدث مع موظف")).toBe(true);
    expect(wantsHuman("מה שעות הפתיחה?")).toBe(false);
  });

  it("filters newsletters, bounces and auto-replies", () => {
    expect(isAutomatedEmail({ from: "no-reply@shop.com" })).toBe(true);
    expect(isAutomatedEmail({ from: "MAILER-DAEMON@mx.google.com" })).toBe(true);
    expect(isAutomatedEmail({ from: "dana@gmail.com", headers: { "List-Unsubscribe": "<mailto:x>" } })).toBe(true);
    expect(isAutomatedEmail({ from: "dana@gmail.com", headers: { "Auto-Submitted": "auto-replied" } })).toBe(true);
    expect(isAutomatedEmail({ from: "dana@gmail.com", headers: { "Auto-Submitted": "no" } })).toBe(false);
  });

  it("builds an alternating history that starts with the customer", () => {
    const h = buildHistory([
      { direction: "out", body: "campaign message" },
      { direction: "in", body: "היי" },
      { direction: "in", body: "יש תור מחר?" },
      { direction: "out", body: "כן!" },
      { direction: "in", body: "  " },
    ]);
    expect(h).toEqual([
      { role: "user", content: "היי\nיש תור מחר?" },
      { role: "assistant", content: "כן!" },
    ]);
    const long = buildHistory(Array.from({ length: 40 }, (_, i) => ({ direction: (i % 2 ? "out" : "in") as "in" | "out", body: "x".repeat(900) })), 5000);
    expect(long[0]!.role).toBe("user");
    expect(long.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(5900);
  });

  it("writes channel-aware instructions with links, customer facts and handoff rules", () => {
    const sys = autopilotInstructions({
      agentName: "נועה",
      orgName: "פט-ליין",
      businessInstructions: "מספרה לכלבים. תספורת 150 ₪.",
      handoffRules: "הנחות",
      channel: "whatsapp",
      customer: { name: "דנה", phone: "+972500000000" },
      links: { booking: "https://app/he/book/groom" },
    });
    expect(sys).toContain("WhatsApp");
    expect(sys).toContain("תספורת 150");
    expect(sys).toContain("https://app/he/book/groom");
    expect(sys).toContain("name: דנה, phone: known");
    expect(sys).toContain("[[HANDOFF]]");
    expect(sys).toContain("and also: הנחות");
    expect(autopilotInstructions({ agentName: "a", orgName: "b", businessInstructions: "", channel: "email", customer: {}, links: {} })).toContain("complete, polite e-mail body");
  });

  it("formats replies for each channel", () => {
    expect(formatForChannel("**חשוב** מאוד", "whatsapp")).toBe("*חשוב* מאוד");
    expect(formatForChannel("**חשוב** מאוד", "telegram")).toBe("חשוב מאוד");
    expect(formatForChannel("x".repeat(900), "sms")).toHaveLength(640);
    expect(welcomeMessage("he", "פט-ליין")).toContain("לפט-ליין");
    expect(welcomeMessage("en", "")).toMatch(/^Hi and welcome!/);
  });
});

describe("e-mail helpers", () => {
  it("detects mail servers by address", () => {
    expect(detectMailServers("a@gmail.com")).toMatchObject({ provider: "gmail", imap_host: "imap.gmail.com", smtp_port: 465 });
    expect(detectMailServers("a@hotmail.co.il")).toMatchObject({ provider: "outlook", smtp_host: "smtp.office365.com", smtp_port: 587 });
    expect(detectMailServers("info@petline.co.il")).toMatchObject({ provider: "other", imap_host: "imap.petline.co.il", smtp_host: "smtp.petline.co.il" });
  });

  it("keeps only the new part of a reply", () => {
    expect(stripQuotedReply("כן, מתאים לי\n\nOn Mon, 12 Oct 2026 at 10:00 Pet <a@b.com> wrote:\n> old")).toBe("כן, מתאים לי");
    expect(stripQuotedReply("תודה!\nבתאריך יום ב׳, 12 באוק׳ 2026, 10:00, מאת פט כתב:\n> ישן")).toBe("תודה!");
    expect(stripQuotedReply("Hi\nSent from my iPhone")).toBe("Hi");
  });

  it("threads replies under the customer's e-mail", () => {
    expect(replySubject("שאלה על מחיר")).toBe("Re: שאלה על מחיר");
    expect(replySubject("RE: x")).toBe("RE: x");
    expect(threadHeaders({ message_id: "<m2@x>", references: "<m1@x>" })).toEqual({ "In-Reply-To": "<m2@x>", References: "<m1@x> <m2@x>" });
    expect(threadHeaders({})).toEqual({});
  });

  it("renders a safe, professional HTML e-mail", () => {
    const html = renderEmailHtml("שלום דנה,\n\n**התור נקבע** <script>alert(1)</script>\nפרטים: https://app.example.com/t/abc", { brand: "פט-ליין" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("<strong>התור נקבע</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('<a href="https://app.example.com/t/abc"');
    expect(html).toContain("פט-ליין");
  });
});

describe("integrations security", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("accepts only fresh, correctly signed bridge callbacks", () => {
    process.env.WA_BRIDGE_SECRET = "b".repeat(32);
    const body = JSON.stringify({ type: "message", from: "972501234567", text: "hi" });
    const ts = String(Date.now());
    const sig = createHmac("sha256", "b".repeat(32)).update(`${ts}.${body}`).digest("hex");
    expect(verifyBridgeSignature(body, ts, sig)).toBe(true);
    expect(verifyBridgeSignature(body + " ", ts, sig)).toBe(false);
    expect(verifyBridgeSignature(body, String(Date.now() - 10 * 60_000), sig)).toBe(false);
    expect(verifyBridgeSignature(body, ts, null)).toBe(false);
    process.env.WA_BRIDGE_SECRET = "short";
    expect(verifyBridgeSignature(body, ts, sig)).toBe(false);
  });

  it("reads the e-mail claim of an OAuth id_token", () => {
    const tok = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString("base64url")}.y`;
    expect(emailFromIdToken(tok({ email: "Owner@Gmail.com" }))).toBe("owner@gmail.com");
    expect(emailFromIdToken(tok({ preferred_username: "me@outlook.com" }))).toBe("me@outlook.com");
    expect(emailFromIdToken(tok({ email: "not-an-email" }))).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });
});
