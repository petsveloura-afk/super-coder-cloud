import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESET_DEFS, VOICE_PRESETS, defaultVoiceId, hasPersona, normalizeVoice, presetSettings } from "@/lib/ai/voice-persona-core";

describe("wave 58 — Danit and Dorian, by choice", () => {
  it("both native Israeli voices are presets, the old ones stay", () => {
    for (const k of ["default", "soft_female", "authoritative_male", "energetic_sales", "custom", "hebrew_female", "hebrew_male"]) expect(VOICE_PRESETS).toContain(k);
    expect(PRESET_DEFS.hebrew_female.voice_id).toBe("s0T0DT6EAPeX57MQpn3I");
    expect(PRESET_DEFS.hebrew_male.voice_id).toBe("PBHwEnXdzx0yfhIO2UCH");
    expect(PRESET_DEFS.soft_female.voice_id).toBe("EXAVITQu4vr4xnSDxMaL");
  });

  it("picking a Hebrew voice sets its id and counts as a persona", () => {
    const f = normalizeVoice({ preset: "hebrew_female" });
    expect(f.voice_id).toBe("s0T0DT6EAPeX57MQpn3I");
    expect(hasPersona(f)).toBe(true);
    expect(presetSettings("hebrew_male", { glossary: ["x1"] })).toMatchObject({ voice_id: "PBHwEnXdzx0yfhIO2UCH", glossary: ["x1"] });
  });

  it("never robotic for lack of a voice id: Danit by default in Hebrew, the env still wins", () => {
    expect(defaultVoiceId("he", {})).toBe("s0T0DT6EAPeX57MQpn3I");
    expect(defaultVoiceId("he", { ELEVENLABS_VOICE_PRESET: "hebrew_male" })).toBe("PBHwEnXdzx0yfhIO2UCH");
    expect(defaultVoiceId("en", {})).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(defaultVoiceId("he", { ELEVENLABS_VOICE_ID: "21m00Tcm4TlvDq8ikWAM" })).toBe("21m00Tcm4TlvDq8ikWAM");
  });

  it("every language names both voices", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(readFileSync(join(__dirname, `../../lib/i18n/dictionaries/${l}.json`), "utf8"));
      expect(d.voicePersona.preset.hebrew_female.name).toBeTruthy();
      expect(d.voicePersona.preset.hebrew_male.body).toBeTruthy();
    }
  });
});

describe("wave 58 — the platform setup wizard keeps its six steps", () => {
  it("voice + phone steps render in their own list (data-voice-step), never as extra data-step rows", () => {
    const page = readFileSync(join(__dirname, "../../app/[locale]/(dashboard)/admin/page.tsx"), "utf8");
    expect(page).toContain("extra={voiceSetupSteps(");
    expect(page).not.toMatch(/\.\.\.voiceSetupSteps\(/);
    const ui = readFileSync(join(__dirname, "../../components/admin/platform-setup.tsx"), "utf8");
    expect(ui).toContain('row(s, i, "data-step", 0)');
    expect(ui).toContain('"data-voice-step"');
    expect(ui).toContain('data-testid="platform-setup-voice"');
  });
});

describe("wave 58 — the agent keeps a natural voice on the free ElevenLabs plan", () => {
  it("library voices fall back to a premade voice of the same gender; premade voices need no fallback", async () => {
    const { elevenVoiceChain, elevenFailReason } = await import("@/lib/ai/voice-persona-core");
    expect(elevenVoiceChain("s0T0DT6EAPeX57MQpn3I", { preset: "hebrew_female" })).toEqual(["s0T0DT6EAPeX57MQpn3I", "EXAVITQu4vr4xnSDxMaL"]);
    expect(elevenVoiceChain("PBHwEnXdzx0yfhIO2UCH", { preset: "hebrew_male" })).toEqual(["PBHwEnXdzx0yfhIO2UCH", "nPczCjzI2devNBz1zQrb"]);
    expect(elevenVoiceChain("EXAVITQu4vr4xnSDxMaL", { preset: "soft_female" })).toEqual(["EXAVITQu4vr4xnSDxMaL"]);
    expect(elevenVoiceChain("", null)).toEqual([]);
    expect(elevenFailReason(402, "")).toBe("paid");
    expect(elevenFailReason(400, '{"detail":{"status":"paid_plan_required"}}')).toBe("paid");
    expect(elevenFailReason(401, '{"detail":{"status":"quota_exceeded"}}')).toBe("quota");
    expect(elevenFailReason(401, '{"detail":{"status":"invalid_api_key"}}')).toBe("key");
    expect(elevenFailReason(500, "boom")).toBe("other");
  });

  it("the voice id hint uses real translation keys (no raw key on screen)", () => {
    const ui = readFileSync(join(__dirname, "../../components/ai/voice-persona-card.tsx"), "utf8");
    expect(ui).not.toContain('"voice.hint.voice_id');
    expect(ui).toContain("voicePersona.hint.voice_id");
  });
});
