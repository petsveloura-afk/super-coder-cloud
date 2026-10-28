import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autopilotInstructions, cleanCustomerName, socialStyleRules } from "@/lib/ai/autopilot-core";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("wave 43 — Facebook / Instagram answers fast and professional (additive)", () => {
  it("placeholder titles are never used as the customer's name", () => {
    for (const n of ["Messenger", "Instagram", "Telegram 12345", "+972501234567", "123456", "", null]) expect(cleanCustomerName(n)).toBeNull();
    expect(cleanCustomerName("דני כהן")).toBe("דני כהן");
    expect(cleanCustomerName("John Smith")).toBe("John Smith");
  });

  it("the social style rules reach Messenger / Instagram prompts only", () => {
    expect(socialStyleRules("web")).toBe("");
    expect(socialStyleRules("whatsapp")).toBe("");
    for (const channel of ["messenger", "instagram"] as const) {
      const p = autopilotInstructions({ agentName: "A", orgName: "B", businessInstructions: "x", channel, customer: {}, links: {} });
      expect(p).toContain("Facebook / Instagram messaging style");
      expect(p).toContain("never use **bold**");
    }
    // the earlier rules are still there
    expect(autopilotInstructions({ agentName: "A", orgName: "B", businessInstructions: "x", channel: "messenger", customer: {}, links: {} })).toContain("Never invent prices");
  });

  it("the Meta webhook shows seen / typing at once and never waits long for the profile name", () => {
    const src = read("../../app/api/channels/meta/pages/route.ts");
    expect(src).toMatch(/"mark_seen"/);
    expect(src).toMatch(/"typing_on"/);
    expect(src).toMatch(/withSoftDeadline\(lookup, 1200, null\)/);
    // the existing behaviour is kept: signature check, echo handling, ingest
    expect(src).toMatch(/verifyMetaSignature/);
    expect(src).toMatch(/ingest_owner_message_meta/);
    expect(src).toMatch(/await ingest\(/);
  });

  it("the autopilot keeps its Meta fallback and uses a shorter self-check on social channels", () => {
    const src = read("../../lib/ai/autopilot.ts");
    expect(src).toMatch(/channel === "messenger" \|\| channel === "instagram"\)/);
    expect(src).toMatch(/Math\.min\(selfCheckBudgetMs\(process\.env\), 4500\)/);
    expect(src).toMatch(/cleanCustomerName/);
  });
});
