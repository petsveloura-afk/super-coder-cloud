import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripStrayMarkers, technicalPause } from "@/lib/ai/autopilot-heal";
import { displayPhone, minutesLeft, minutesUsed, monthStart, monthlyMinutes, needsManualAssign, platformTwilio, validE164 } from "@/lib/voice/platform-phone-core";
import { setupSteps, voiceSetupSteps } from "@/lib/admin/setup-core";
import { WHATS_NEW, WHATS_NEW_CARDS } from "@/lib/guide/whats-new";
import { ROUTE_PROVIDERS } from "@/lib/ai/router-core";
import { NAV_ITEMS } from "@/lib/navigation";

describe("wave 57 — the agent never gets stuck", () => {
  it("technical pauses heal by themselves; people, guardrails and credits do not", () => {
    for (const n of ["empty_answer", "ai_busy", "ai.failed", "ai.busy", "ai.self_check_timeout", "agent_error"]) expect(technicalPause(n)).toBe(true);
    for (const n of [null, "", "owner_phone", "agent", "phone_agent", "guardrail_price", "guardrail_banned", "ai.limitReached", "plan_limit:ai_credits", "demo", "angry"]) expect(technicalPause(n)).toBe(false);
  });

  it("unknown control lines never reach the customer", () => {
    expect(stripStrayMarkers("שלום! [[FOLLOW-UP - 2d]] נדבר")).toBe("שלום! נדבר");
    expect(stripStrayMarkers("מעולה [[TASK - call back")).toBe("מעולה");
    expect(stripStrayMarkers("רק טקסט")).toBe("רק טקסט");
    expect(stripStrayMarkers("[[REMEMBER: x]]")).toBe("");
  });

  it("the original engines keep their places at the front", () => {
    expect(ROUTE_PROVIDERS.slice(0, 5)).toEqual(["groq", "cerebras", "gemini", "openrouter", "mistral"]);
    expect(ROUTE_PROVIDERS.slice(-2)).toEqual(["anthropic", "openai"]);
    expect(ROUTE_PROVIDERS).toEqual(expect.arrayContaining(["cloudflare", "github", "sambanova", "nvidia", "huggingface"]));
  });

  it("the agent asks again (compact prompt) instead of handing off on an empty answer", () => {
    const src = readFileSync(join(__dirname, "../../lib/ai/autopilot.ts"), "utf8");
    expect(src).toContain("technicalPause");
    expect(src).toContain("ai.empty_retry_timeout");
    expect(src).toContain("stripStrayMarkers");
  });
});

describe("wave 57 — zero-setup phone", () => {
  it("platform account, minutes and numbers", () => {
    expect(platformTwilio({})).toBeNull();
    expect(platformTwilio({ TWILIO_PLATFORM_ACCOUNT_SID: `AC${"a".repeat(32)}`, TWILIO_PLATFORM_AUTH_TOKEN: "b".repeat(32), TWILIO_PLATFORM_COUNTRY: "il" })).toMatchObject({ country: "IL" });
    expect(monthlyMinutes({})).toBe(300);
    expect(monthlyMinutes({ VOICE_PLATFORM_MINUTES: "0" })).toBe(0);
    expect(minutesUsed([61, 59, null, 0])).toBe(3);
    expect(minutesLeft(10, 0)).toBeNull();
    expect(minutesLeft(400, 300)).toBe(0);
    expect(monthStart(new Date("2026-10-30T12:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
    expect(validE164("+972501234567")).toBe(true);
    expect(validE164("0501234567")).toBe(false);
    expect(displayPhone("+972501234567")).toBe("050-123-4567");
    expect(displayPhone("+15551234567")).toBe("+1 555-123-4567");
    expect(needsManualAssign("21631: Phone Number Requires an Address")).toBe(true);
    expect(needsManualAssign("timeout")).toBe(false);
  });

  it("the platform owner sets voice + phone once (admin console), existing steps unchanged", () => {
    expect(setupSteps({}, "https://a")).toHaveLength(6);
    const v = voiceSetupSteps({ OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxx" }, "https://app.example.com/");
    expect(v.map((s) => s.key)).toEqual(["voice", "phone_platform"]);
    expect(v[0]!.done).toBe(true);
    expect(v[1]!.done).toBe(false);
    expect(v[1]!.copies[0]!.value).toBe("https://app.example.com/api/voice/platform");
  });

  it("a shortcut in the menu", () => {
    expect(NAV_ITEMS.find((n) => n.key === "phone")).toMatchObject({ section: "growth", permission: "ai.use" });
  });

  it("migration is additive", () => {
    const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261030000002_platform_phone.sql"), "utf8");
    expect(sql).toMatch(/create table if not exists public\.org_phone_numbers/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/add column if not exists via text not null default 'own'/);
    expect(sql).not.toMatch(/drop table|drop column/i);
  });
});

describe("wave 57 — what's new in the guide", () => {
  const he = JSON.parse(readFileSync(join(__dirname, "../../lib/i18n/dictionaries/he.json"), "utf8"));
  it("every card is complete and points at a real screen", () => {
    expect(WHATS_NEW.length).toBeGreaterThanOrEqual(4);
    const ids = new Set<string>();
    for (const c of WHATS_NEW_CARDS) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.title.length).toBeGreaterThan(5);
      expect(c.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.demo.length).toBeGreaterThanOrEqual(2);
      if (c.screen) expect(existsSync(join(__dirname, `../../app/[locale]/(dashboard)/${c.screen}`))).toBe(true);
    }
    for (const id of ["phone-enable", "operator", "memory", "funnel", "voice-persona", "trials", "reliable"]) expect(ids.has(id)).toBe(true);
    expect(he.guide.newTitle).toBeTruthy();
  });
  it("the screenshot guide is unchanged", () => {
    const data = readFileSync(join(__dirname, "../../public/guide/guide-data.js"), "utf8");
    expect((data.match(/"img":/g) ?? []).length).toBe(29);
  });
});
