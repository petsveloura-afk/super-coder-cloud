import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isServiceSender } from "@/lib/inbox/robots-core";
import { notCustomerKind } from "@/lib/ai/spam-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("service senders are not customers (the owner's inbox screenshots)", () => {
  it("exchanges, platforms and '… Alerts' by name", () => {
    for (const n of ["OKX", "Bybit", "Telegram", "Neon Alerts", "Binance", "Google", "Meta for Business", "PayPal", "Vercel", "noreply@x.com", "Stripe Billing"]) expect(isServiceSender(n), n).toBe(true);
  });
  it("machine texts: login codes, IP reports, long opaque tokens", () => {
    expect(isServiceSender("Unknown", "New login. iOS IP: 2a06:c701:95eb:a100:7805:5062:98d7:cd9f (Holon)")).toBe(true);
    expect(isServiceSender("x", "Your code is 48213")).toBe(true);
    expect(isServiceSender("x", "…6AxHTRj1H1lbX4M9_cGqhW-ZKxJdbINPGv4UIiSn6o2mkuW")).toBe(true);
    expect(isServiceSender("x", "קוד האימות שלך הוא 1234")).toBe(true);
  });
  it("people and businesses are never caught", () => {
    for (const n of ["Lotus", "Koop", "Spiher gold", "שרית מזרחי", "Max Cohen", "Neon Hair Studio", "Dana", "Yossi Telegram fan"]) expect(isServiceSender(n, "היי, כמה עולה אתר?"), n).toBe(false);
    expect(isServiceSender("Lotus", "אתה עונה פעם בשעות אין אם מי לדבר")).toBe(false);
    expect(isServiceSender("Koop", "אז כמה זמן https://example.com/very/long/path/with-a-normal-url")).toBe(false);
  });
  it("the agent does not answer a service sender (by name only — never by what a customer wrote)", () => {
    expect(notCustomerKind({ text: "Security alert", channel: "email", subject: "OKX" })).toBe("bulk");
    expect(notCustomerKind({ text: "Your code is 48213", channel: "telegram", subject: "Dana" })).toBe(null);
  });
  it("the inbox marks them, keeps them out of 'waiting', and closes them in one click (server re-checks every id)", () => {
    const page = read("app/[locale]/(dashboard)/inbox/page.tsx");
    expect(page).toContain("isServiceSender(c.title, c.last_message_preview)");
    expect(page).toContain("<CloseRobotsButton");
    const act = read("app/[locale]/(dashboard)/inbox/robots-actions.ts");
    expect(act).toContain('ctx.can("inbox.reply")');
    expect(act).toContain("isServiceSender(c.title, c.last_message_preview)");
    expect(act).toContain('.eq("organization_id", ctx.org.id)');
    expect(act).not.toMatch(/\.delete\(/);
  });
});
