import { describe, expect, it } from "vitest";
import { analyzeMessage, extractState, situationBrief } from "@/lib/ai/intelligence";
import { businessOwnerMessage, businessVerdict } from "@/lib/channels/telegram-business-core";

describe("wave 15 · agent brain: username, words, opening hours", () => {
  const base = { analysis: analyzeMessage("כמה עולה?"), state: extractState([{ role: "user", content: "כמה עולה?" }]) };
  it("remembers a Telegram @username and does not ask again", () => {
    const s = extractState([{ role: "user", content: "אפשר לדבר איתי בטלגרם @david_cohen1" }]);
    expect(s.username).toBe("david_cohen1");
    expect(extractState([{ role: "user", content: "https://t.me/david_cohen1" }]).username).toBe("david_cohen1");
    expect(extractState([{ role: "user", content: "המייל שלי a@b.com" }]).username).toBeUndefined();
    expect(situationBrief({ ...base, state: s, channel: "web" })).not.toContain("Telegram @username (one short ask");
  });
  it("asks for the @username outside Telegram when the customer wants to buy / book / price", () => {
    expect(situationBrief({ ...base, channel: "web" })).toContain("Telegram @username");
    expect(situationBrief({ ...base, channel: "telegram" })).not.toContain("also ask for the customer's Telegram");
  });
  it("always tells the agent to tell similar words apart", () => {
    expect(situationBrief(base)).toContain("Understand words precisely");
  });
  it("closed: not active for deliveries, and follows the business setting", () => {
    const book = situationBrief({ ...base, hours: { open: false, afterHours: "book_next", nextOpen: "tomorrow at 09:00" } });
    expect(book).toContain("not active at the moment for deliveries");
    expect(book).toContain("reserve a spot");
    expect(book).toContain("tomorrow at 09:00");
    const msg = situationBrief({ ...base, hours: { open: false, afterHours: "closed_message" } });
    expect(msg).toContain("Do not schedule anything");
    expect(situationBrief({ ...base, hours: { open: false, afterHours: "answer_normally" } })).toContain("do not confirm deliveries");
    expect(situationBrief({ ...base, hours: { open: true } })).toContain("OPEN now");
  });
});

describe("wave 15 · Telegram Business connection health", () => {
  const ok = { is_enabled: true, can_reply: true };
  it("detects a lost connection only when Telegram says so", () => {
    expect(businessVerdict(ok, { reachable: false, error: "Bad Request: BUSINESS_CONNECTION_INVALID" })).toBe("lost");
    expect(businessVerdict(ok, { reachable: true, is_enabled: false })).toBe("lost");
    expect(businessVerdict(ok, { reachable: false, error: "network down" })).toBe("unknown");
    expect(businessVerdict(ok, { reachable: false, error: "Too Many Requests" })).toBe("unknown");
  });
  it("notices a missing reply right and a restored connection, never repeats itself", () => {
    expect(businessVerdict(ok, { reachable: true, is_enabled: true, can_reply: false })).toBe("no_reply_right");
    expect(businessVerdict({ is_enabled: false, can_reply: true }, { reachable: true, is_enabled: true, can_reply: true })).toBe("restored");
    expect(businessVerdict({ is_enabled: false, can_reply: true }, { reachable: true, is_enabled: false })).toBe("ok");
    expect(businessVerdict(ok, { reachable: true, is_enabled: true, can_reply: true })).toBe("ok");
  });
  it("owner message gives the exact steps", () => {
    expect(businessOwnerMessage("lost")).toContain("Telegram Business");
    expect(businessOwnerMessage("lost")).toContain("Premium");
    expect(businessOwnerMessage("ok")).toBeNull();
    expect(businessOwnerMessage("unknown")).toBeNull();
  });
});
