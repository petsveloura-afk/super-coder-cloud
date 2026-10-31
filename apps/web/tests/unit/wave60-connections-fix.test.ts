import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { isNotRegistered, needsPin } from "@/lib/channels/wa-register";
import { accountHealth } from "@/lib/channels/health-core";

const dict = (l: string) => JSON.parse(readFileSync(join(__dirname, `../../lib/i18n/dictionaries/${l}.json`), "utf8"));
const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("wave 60 — WhatsApp heals itself (#133010)", () => {
  it("recognizes Meta's not-registered error", () => {
    expect(isNotRegistered("(#133010) Account not registered")).toBe(true);
    expect(isNotRegistered("wa_not_registered: x")).toBe(true);
    expect(isNotRegistered("(#131047) Re-engagement message")).toBe(false);
    expect(isNotRegistered(null)).toBe(false);
  });

  it("knows when the owner's two-step PIN is needed", () => {
    expect(needsPin("(#133005) Two step verification PIN Mismatch")).toBe(true);
    expect(needsPin("(#133006) phone number needs verification")).toBe(true);
    expect(needsPin("(#100) Invalid parameter")).toBe(false);
  });

  it("health center flags an unregistered number as a fixable error", () => {
    const h = accountHealth({ kind: "whatsapp", status: "active", lastError: "(#133010) Account not registered", lastInboundAt: null, createdAt: null, failed24h: 0, sent24h: 0 });
    expect(h).toEqual({ level: "error", reason: "wa_not_registered" });
    // nothing else changed
    expect(accountHealth({ kind: "whatsapp", status: "error", lastError: "boom", lastInboundAt: null, createdAt: null, failed24h: 0, sent24h: 0 }).reason).toBe("status_error");
    expect(accountHealth({ kind: "whatsapp", status: "disabled", lastError: "(#133010)", lastInboundAt: null, createdAt: null, failed24h: 0, sent24h: 0 }).reason).toBe("disabled");
  });

  it("sending retries once after registering", () => {
    const src = read("lib/channels/send-message.ts");
    expect(src).toContain("isNotRegistered");
    expect(src).toContain("ensureRegistered");
    expect(read("lib/notify/forward.ts")).toContain("ensureRegistered");
  });
});

describe("wave 60 — team updates and phone", () => {
  it("transfer numbers are calls, never text updates", () => {
    const src = read("lib/notify/forward.ts");
    expect(src).toContain('.neq("kind", "call")');
    expect(src).toContain('r.kind === "call"');
  });

  it("assigning a number explains trial / auth problems", () => {
    const src = read("lib/voice/platform-phone.ts");
    expect(src).toContain("phone.trialAccount");
    expect(src).toContain("phone.authFailed");
  });

  it("the Pixel ID field is protected from browser autofill", () => {
    const src = read("components/integrations/conversions-card.tsx");
    expect(src).toMatch(/name="pixel_id"[^>]*autoComplete="off"/);
  });

  it("every new key exists in he, en and ar", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = dict(l);
      for (const k of ["notRegistered", "pinLabel", "fixNow", "checkNow", "pinHint", "pinInvalid", "notOfficial", "tokenExpired", "registeredOk", "needPin", "registerFailed"]) expect(d.integrations.wa[k], `${l} integrations.wa.${k}`).toBeTruthy();
      expect(d.health.reason.wa_not_registered).toBeTruthy();
      for (const k of ["smsFallback", "transferLabel", "transferHint"]) expect(d.notify[k], `${l} notify.${k}`).toBeTruthy();
      for (const k of ["authFailed", "trialAccount", "accountSuspended"]) expect(d.phone[k], `${l} phone.${k}`).toBeTruthy();
    }
  });
});
