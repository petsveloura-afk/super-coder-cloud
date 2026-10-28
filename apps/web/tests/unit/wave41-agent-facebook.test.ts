import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import he from "@/lib/i18n/dictionaries/he.json";
import en from "@/lib/i18n/dictionaries/en.json";
import ar from "@/lib/i18n/dictionaries/ar.json";
import { AGENT_CHANNELS, buildAgentPrompt, parseAgentPlan } from "@/lib/campaigns/ai-core";

const plan = (channel: string) => JSON.stringify({ name: "x", channel, body: "היי, יש הטבה. להסרה השיבו הסר.", subject: "", audience: {}, send_hint: "evening", rationale: "r" });

describe("wave 41 — Facebook in the campaign agent (additive)", () => {
  it("the default agent still never picks a Meta channel by itself", () => {
    expect([...AGENT_CHANNELS]).toEqual(["email", "whatsapp", "sms", "telegram"]);
    expect(parseAgentPlan(plan("messenger"), { tags: [] })).toBeNull();
  });

  it("when the owner picks Facebook Messenger / Instagram the agent uses exactly that channel", () => {
    for (const force of ["messenger", "instagram"] as const) {
      expect(parseAgentPlan(plan(force), { tags: [], force })?.channel).toBe(force);
      expect(parseAgentPlan(plan("sms"), { tags: [], force })).toBeNull();
      expect(buildAgentPrompt({ goal: "winback", tags: [], connected: [], force })).toContain(`You MUST use exactly this channel`);
    }
  });

  it("the campaigns UI names Facebook in all languages", () => {
    for (const d of [he, en, ar] as const) {
      expect((d.campaigns.channels as unknown as Record<string, string>).messenger).toMatch(/Facebook/);
      const a = d.campaigns.agent as unknown as Record<string, string>;
      expect(a.channelPick && a.channelAuto && a.channelNotConnected).toBeTruthy();
    }
  });

  it("the dispatcher also handles queued messenger / instagram jobs", () => {
    const src = readFileSync(new URL("../../lib/jobs/dispatch.ts", import.meta.url), "utf8");
    expect(src).toMatch(/case "messenger":\s*case "instagram": \{/);
  });
});
