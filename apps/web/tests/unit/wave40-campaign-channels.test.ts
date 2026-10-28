import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import he from "@/lib/i18n/dictionaries/he.json";
import en from "@/lib/i18n/dictionaries/en.json";
import ar from "@/lib/i18n/dictionaries/ar.json";
import { CAMPAIGN_CHANNELS, META_CAMPAIGN_CHANNELS, campaignSchema } from "@scc/shared/engagement";
import { analyzeMessage, suggestSendInstants, suggestSendTimes } from "@/lib/campaigns/brain";
import { AGENT_CHANNELS, buildWriterPrompt, parseAgentPlan } from "@/lib/campaigns/ai-core";

const BODY = "היי {{contact.first_name}}, יש לנו הטבה של 10% עד יום חמישי. להסרה השיבו הסר.";

describe("wave 40 — campaigns on every platform", () => {
  it("offers all six channels, Meta ones included", () => {
    expect([...CAMPAIGN_CHANNELS]).toEqual(["email", "whatsapp", "sms", "telegram", "messenger", "instagram"]);
    expect([...META_CAMPAIGN_CHANNELS]).toEqual(["messenger", "instagram"]);
  });

  it("the save schema accepts Messenger and Instagram campaigns", () => {
    for (const channel of ["messenger", "instagram"] as const) {
      expect(campaignSchema.safeParse({ name: "n", channel, body: BODY, audience: {} }).success).toBe(true);
    }
    expect(campaignSchema.safeParse({ name: "n", channel: "fax", body: BODY, audience: {} }).success).toBe(false);
  });

  it("scores, schedules and prompts for the new channels", () => {
    for (const channel of ["messenger", "instagram"] as const) {
      const a = analyzeMessage({ channel, body: BODY });
      expect(a.score).toBeGreaterThan(0);
      expect(suggestSendTimes(channel, new Date("2026-10-28T08:00:00Z")).length).toBeGreaterThan(0);
      const inst = suggestSendInstants(channel, Date.UTC(2026, 9, 28, 8), -120, 3);
      expect(inst).toHaveLength(3);
      expect(inst.every((s) => s.atMs > Date.UTC(2026, 9, 28, 8))).toBe(true);
      expect(buildWriterPrompt({ channel, goal: "promo", tone: "friendly" })).toMatch(channel === "messenger" ? /Messenger/ : /Instagram/);
    }
  });

  it("the campaign agent never picks a Meta channel on its own", () => {
    expect([...AGENT_CHANNELS]).toEqual(["email", "whatsapp", "sms", "telegram"]);
    const raw = JSON.stringify({ name: "x", channel: "messenger", body: "hi", audience: {} });
    expect(parseAgentPlan(raw, { tags: [] })).toBeNull();
  });

  it("has names and the Meta hint in all three languages", () => {
    for (const d of [he, en, ar] as const) {
      for (const c of CAMPAIGN_CHANNELS) expect((d.campaigns.channels as Record<string, string>)[c]).toBeTruthy();
      expect((d.campaigns as Record<string, unknown>).metaHint).toBeTruthy();
    }
  });

  it("the migration widens the channel + job kind constraints and the audience function", () => {
    const sql = readFileSync(new URL("../../../../supabase/migrations/20261015000044_wave40_campaign_channels.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/campaigns_channel_check[\s\S]*'messenger', 'instagram'/);
    expect(sql).toMatch(/jobs_kind_check[\s\S]*'messenger',\s*'instagram'/);
    expect(sql).toMatch(/when 'messenger' then exists/);
    expect(sql).toMatch(/c\.opted_out_at is null/); // consent / opt-out rules preserved
    expect(sql).toMatch(/c\.marketing_consent/);
  });
});
