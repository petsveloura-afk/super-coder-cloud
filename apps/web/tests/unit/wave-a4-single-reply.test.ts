import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { technicalPause, technicalPauseExtended } from "@/lib/ai/autopilot-heal";

describe("wave A4 — one reply per customer message, no stuck chat after a held reply", () => {
  it("a conversation paused by the outbound guard comes back by itself (the old rules are unchanged)", () => {
    expect(technicalPauseExtended("guardrail_unready")).toBe(true);
    expect(technicalPause("guardrail_unready")).toBe(false);
    expect(technicalPauseExtended("guardrail_price")).toBe(false);
    expect(technicalPauseExtended("customer_asked")).toBe(false);
    expect(technicalPauseExtended("plan_limit:ai_credits")).toBe(false);
  });
  it("the autopilot claims the message before answering and re-checks right before sending", () => {
    const src = readFileSync("lib/ai/autopilot.ts", "utf8");
    expect(src).toContain('"ai_claim_reply"');
    expect(src.indexOf('"ai_claim_reply"')).toBeLessThan(src.indexOf("const text = formatForChannel(tools.text || handoffMessage(locale), ch);"));
    expect(src).toContain("wave A4 — last look before sending");
  });
});
