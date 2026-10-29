import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE, PRESET_DEFS, elevenBody, hasPersona, normalizeVoice, openaiBody, presetSettings, stabilityFor, sttPrompt, validVoiceId } from "@/lib/ai/voice-persona-core";
import { FUNNEL_PATH, SALES_STATES, funnelRank, funnelRows, isSalesState, nextSalesState, salesStateBrief } from "@/lib/ai/sales-state-core";
import { israeliHolidays, mergeClosedDates } from "@/lib/ai/holidays-core";
import { PAID_PROVIDERS, ROUTE_PROVIDERS, buildCandidates, cloudflareKeys, laneOrder, providerKeys } from "@/lib/ai/router-core";

const KEY = "k".repeat(30);

describe("wave 55 — voice persona", () => {
  it("normalizes and clamps, presets fill their voice", () => {
    const v = normalizeVoice({ preset: "soft_female", stability: 7, speed: 0.1, openai_voice: "robot", glossary: "Super Coder, CRM, <x>, CRM", junk: 1 });
    expect(v.voice_id).toBe(PRESET_DEFS.soft_female.voice_id);
    expect(v.stability).toBe(1);
    expect(v.speed).toBe(0.7);
    expect(v.openai_voice).toBe("shimmer");
    expect(v.glossary).toEqual(["Super Coder", "CRM"]);
    expect(normalizeVoice(null)).toEqual(DEFAULT_VOICE);
    expect(normalizeVoice({ preset: "nope" }).preset).toBe("default");
  });

  it("custom needs a real voice id; default means no persona", () => {
    expect(hasPersona(normalizeVoice({ preset: "custom" }))).toBe(false);
    expect(hasPersona(normalizeVoice({ preset: "custom", voice_id: "21m00Tcm4TlvDq8ikWAM" }))).toBe(true);
    expect(hasPersona(normalizeVoice({ preset: "default" }))).toBe(false);
    expect(validVoiceId("bad id!")).toBe(false);
    expect(presetSettings("authoritative_male", { glossary: ["x1"] })).toMatchObject({ preset: "authoritative_male", openai_voice: "onyx", glossary: ["x1"] });
  });

  it("builds the ElevenLabs and OpenAI requests with the persona", () => {
    const v = normalizeVoice({ preset: "energetic_sales" });
    const e = elevenBody("hi", v, "eleven_v3", "he") as { voice_settings: Record<string, unknown>; language_code: string };
    expect(e.language_code).toBe("he");
    expect(e.voice_settings).toMatchObject({ stability: 0.5, use_speaker_boost: true, style: 0.6 });
    expect(stabilityFor("eleven_multilingual_v2", 0.33)).toBe(0.33);
    expect(stabilityFor("eleven_v3", 0.9)).toBe(1);
    const o = openaiBody("hi", v, "gpt-4o-mini-tts", "opus", "he") as { voice: string; instructions?: string };
    expect(o.voice).toBe("ash");
    expect(o.instructions).toMatch(/energetic/i);
    expect((openaiBody("hi", v, "tts-1", "mp3", "en") as { instructions?: string }).instructions).toBeUndefined();
  });

  it("speech-to-text prompt carries the business words, bounded", () => {
    const p = sttPrompt({ orgName: "Super Coder", glossary: ["CRM", "וואטסאפ"], locale: "he" });
    expect(p).toContain("Super Coder");
    expect(p).toContain("וואטסאפ");
    expect(sttPrompt({ glossary: Array.from({ length: 200 }, (_, i) => `word${i}`), locale: "en" }).length).toBeLessThanOrEqual(600);
  });
});

describe("wave 55 — sales state machine", () => {
  const h = (...msgs: string[]) => msgs.map((content, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content }));

  it("moves forward with the conversation", () => {
    expect(nextSalesState({ current: null, text: "היי", history: h("היי") }).next).toBe("QUALIFYING_NEEDS");
    const offer = nextSalesState({ current: "QUALIFYING_NEEDS", text: "ומה כלול?", history: h("היי", "החבילה עולה 990 ₪", "ומה כלול?") });
    expect(offer.next).toBe("DEMO_OR_OFFER");
    expect(nextSalesState({ current: "DEMO_OR_OFFER", text: "יאללה סגור", history: h("יאללה סגור") }).next).toBe("CLOSING");
  });

  it("objection detour and resume, never backwards", () => {
    const o = nextSalesState({ current: "DEMO_OR_OFFER", text: "זה יקר לי", history: h("זה יקר לי") });
    expect(o.next).toBe("OBJECTION_HANDLING");
    const r = nextSalesState({ current: "OBJECTION_HANDLING", text: "אוקיי", history: h("אוקיי") });
    expect(funnelRank(r.next)).toBeGreaterThanOrEqual(funnelRank("VALUE_PROP"));
    expect(nextSalesState({ current: "CLOSING", text: "שאלה", history: h("שאלה") }).next).toBe("CLOSING");
  });

  it("booking, handoff and terminal states", () => {
    expect(nextSalesState({ current: "CLOSING", text: "ok", history: h("ok"), booked: true }).next).toBe("BOOKED_MEETING");
    expect(nextSalesState({ current: "VALUE_PROP", text: "x", history: h("x"), handoff: true }).next).toBe("HUMAN_HANDOFF");
    expect(nextSalesState({ current: "HUMAN_HANDOFF", text: "יאללה סגור", history: h("יאללה סגור") })).toMatchObject({ next: "HUMAN_HANDOFF", changed: false });
    expect(nextSalesState({ current: "QUALIFYING_NEEDS", text: "x", history: h("x"), bookingRequested: true }).next).toBe("CLOSING");
  });

  it("brief, rows and guards", () => {
    expect(salesStateBrief("CLOSING")).toContain("[CLOSING]");
    expect(salesStateBrief(null)).toContain("NEW_LEAD");
    expect(funnelRows({ CLOSING: 3 }).find((r) => r.state === "CLOSING")?.count).toBe(3);
    expect(funnelRows({})).toHaveLength(SALES_STATES.length);
    expect(FUNNEL_PATH).not.toContain("HUMAN_HANDOFF");
    expect(isSalesState("CLOSING")).toBe(true);
    expect(isSalesState("closing")).toBe(false);
  });
});

describe("wave 55 — Israeli holidays from the Hebrew calendar", () => {
  it("finds the 5787 holidays", () => {
    const list = israeliHolidays("2026-09-01", 300);
    const dates = Object.fromEntries(list.map((x) => [x.date, x.key]));
    expect(dates["2026-09-12"]).toBe("rosh_hashana");
    expect(dates["2026-09-13"]).toBe("rosh_hashana");
    expect(dates["2026-09-21"]).toBe("yom_kippur");
    expect(dates["2027-04-22"]).toBe("pesach");
    expect(dates["2027-06-11"]).toBe("shavuot");
    expect(list).toHaveLength(8);
  });
  it("merges without losing future dates", () => {
    const old = Array.from({ length: 58 }, (_, i) => `2020-01-${String((i % 28) + 1).padStart(2, "0")}`);
    const merged = mergeClosedDates(old, ["2027-01-01", "2027-02-02", "2027-03-03"]);
    expect(merged.length).toBeLessThanOrEqual(60);
    expect(merged).toContain("2027-03-03");
  });
});

describe("wave 55 — more free AI engines + lanes", () => {
  it("Cloudflare uses the existing account keys and gets its own endpoint", () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: "acc1", CLOUDFLARE_AI_TOKEN: KEY };
    expect(cloudflareKeys(env)).toEqual([`acc1:${KEY}`]);
    const c = buildCandidates({ env, random: () => 0 });
    expect(c[0]).toMatchObject({ provider: "cloudflare", key: KEY, baseUrl: "https://api.cloudflare.com/client/v4/accounts/acc1/ai/v1" });
  });

  it("new engines join even with a custom provider order, paid last", () => {
    const env = { AI_PROVIDER_ORDER: "groq,openai", GROQ_API_KEY: KEY, OPENAI_API_KEY: "sk-1", NVIDIA_API_KEY: KEY, HF_TOKEN: KEY, GITHUB_MODELS_TOKEN: KEY, SAMBANOVA_API_KEY: KEY };
    const order = [...new Set(buildCandidates({ env, random: () => 0 }).map((c) => c.provider))];
    expect(order[0]).toBe("groq");
    expect(order).toEqual(expect.arrayContaining(["nvidia", "huggingface", "github", "sambanova"]));
    // the owner's own order is kept as written; engines it does not mention join after it
    expect(order[1]).toBe("openai");
    for (const p of ROUTE_PROVIDERS) expect(Array.isArray(providerKeys(p, env))).toBe(true);
  });

  it("background lane reverses the free engines and keeps paid ones last", () => {
    const env = { GROQ_API_KEY: KEY, NVIDIA_API_KEY: KEY, OPENAI_API_KEY: "sk-1" };
    const cands = buildCandidates({ env, random: () => 0 });
    const bg = [...new Set(laneOrder(cands, "background").map((c) => c.provider))];
    expect(bg).toEqual(["nvidia", "groq", "openai"]);
    expect(laneOrder(cands, "interactive")).toBe(cands);
    expect(PAID_PROVIDERS).toEqual(["anthropic", "openai"]);
  });
});

describe("wave 55 — migration is additive", () => {
  const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261029000008_voice_sales_state.sql"), "utf8");
  it("adds columns, a logged state table with RLS and a permission-checked RPC", () => {
    expect(sql).toMatch(/add column if not exists voice jsonb/i);
    expect(sql).toMatch(/add column if not exists sales_state text/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/has_permission\(v_org, 'inbox\.reply'\)/);
    expect(sql).not.toMatch(/drop table|drop column/i);
    for (const s of SALES_STATES) expect(sql).toContain(`'${s}'`);
  });
});
