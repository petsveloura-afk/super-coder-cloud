/**
 * Wave 55 — voice persona per AI agent (pure parts, unit-tested).
 *
 * Every agent can speak with its own voice: a ready persona (soft & warm female, deep authoritative
 * male, high-energy sales) or a custom ElevenLabs voice, with the full ElevenLabs voice settings
 * (stability, similarity_boost, style exaggeration, speaker boost, speed) and a matching OpenAI
 * fallback voice + speaking instructions. The same settings also carry the business glossary that
 * makes speech-to-text understand the business' names, products, slang and abbreviations.
 */

export const VOICE_PRESETS = ["default", "soft_female", "authoritative_male", "energetic_sales", "custom"] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];

export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;
export type OpenAIVoice = (typeof OPENAI_VOICES)[number];

export interface VoiceSettings {
  preset: VoicePreset;
  /** ElevenLabs voice id (custom persona, or an override of the persona's voice) */
  voice_id: string;
  stability: number; // 0..1
  similarity_boost: number; // 0..1
  style: number; // 0..1 (style exaggeration)
  speaker_boost: boolean;
  speed: number; // 0.7..1.2
  openai_voice: OpenAIVoice;
  /** words speech-to-text must recognise: business name, products, people, slang, abbreviations */
  glossary: string[];
}

interface PresetDef {
  voice_id: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speaker_boost: boolean;
  speed: number;
  openai_voice: OpenAIVoice;
  /** how the OpenAI fallback voice should sound (gpt-4o-mini-tts "instructions") */
  tone: string;
}

/** Premade ElevenLabs voices available on every account (multilingual, work with Eleven v3). */
export const PRESET_DEFS: Record<Exclude<VoicePreset, "default" | "custom">, PresetDef> = {
  soft_female: {
    voice_id: "EXAVITQu4vr4xnSDxMaL",
    stability: 0.55,
    similarity_boost: 0.8,
    style: 0.25,
    speaker_boost: true,
    speed: 0.95,
    openai_voice: "shimmer",
    tone: "Speak in a soft, warm, gentle and inviting female voice. Calm, unhurried pace, a friendly smile in the voice, caring and reassuring.",
  },
  authoritative_male: {
    voice_id: "nPczCjzI2devNBz1zQrb",
    stability: 0.7,
    similarity_boost: 0.85,
    style: 0.15,
    speaker_boost: true,
    speed: 0.95,
    openai_voice: "onyx",
    tone: "Speak in a deep, confident, authoritative and professional male voice. Steady measured pace, clear diction, calm certainty, trustworthy.",
  },
  energetic_sales: {
    voice_id: "TX3LPaxmHKxFdv7VOQHJ",
    stability: 0.35,
    similarity_boost: 0.75,
    style: 0.6,
    speaker_boost: true,
    speed: 1.08,
    openai_voice: "ash",
    tone: "Speak in an upbeat, enthusiastic, young and energetic sales voice. Lively pace, positive and persuasive but natural and never pushy.",
  },
};

export const DEFAULT_VOICE: VoiceSettings = {
  preset: "default",
  voice_id: "",
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  speaker_boost: true,
  speed: 1,
  openai_voice: "alloy",
  glossary: [],
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n)) * 100) / 100 : fallback;
};

/** ElevenLabs voice ids are 20 alphanumeric characters (allow a little slack for custom/cloned voices). */
export function validVoiceId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9]{16,40}$/.test(v.trim());
}

/** Raw JSON from the database / the form → clean settings (unknown keys dropped, values clamped). */
export function normalizeVoice(raw: unknown): VoiceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const preset = (VOICE_PRESETS as readonly string[]).includes(String(r.preset)) ? (r.preset as VoicePreset) : "default";
  const base = preset === "default" || preset === "custom" ? DEFAULT_VOICE : { ...DEFAULT_VOICE, ...PRESET_DEFS[preset] };
  const glossary = (Array.isArray(r.glossary) ? r.glossary : typeof r.glossary === "string" ? r.glossary.split(/[,\n]/) : [])
    .map((x) => String(x).replace(/[<>"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40))
    .filter((x) => x.length >= 2)
    .filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
    .slice(0, 60);
  return {
    preset,
    voice_id: validVoiceId(r.voice_id) ? String(r.voice_id).trim() : preset === "custom" || preset === "default" ? "" : base.voice_id,
    stability: clamp(r.stability, 0, 1, base.stability),
    similarity_boost: clamp(r.similarity_boost, 0, 1, base.similarity_boost),
    style: clamp(r.style, 0, 1, base.style),
    speaker_boost: typeof r.speaker_boost === "boolean" ? r.speaker_boost : base.speaker_boost,
    speed: clamp(r.speed, 0.7, 1.2, base.speed),
    openai_voice: (OPENAI_VOICES as readonly string[]).includes(String(r.openai_voice)) ? (r.openai_voice as OpenAIVoice) : base.openai_voice,
    glossary,
  };
}

/** Settings of a preset, ready to drop into the form when the user picks it. */
export function presetSettings(preset: VoicePreset, keep: Pick<VoiceSettings, "glossary">): VoiceSettings {
  if (preset === "default" || preset === "custom") return { ...DEFAULT_VOICE, preset, glossary: keep.glossary };
  return { ...DEFAULT_VOICE, ...PRESET_DEFS[preset], preset, glossary: keep.glossary };
}

/** Is a persona really set (otherwise the environment's default voice is used, as before)? */
export function hasPersona(v: VoiceSettings | null | undefined): v is VoiceSettings {
  return Boolean(v && v.preset !== "default" && (v.preset !== "custom" || validVoiceId(v.voice_id)));
}

/** Eleven v3 accepts only three stability steps (creative / natural / robust). */
export function stabilityFor(model: string, stability: number): number {
  if (!/v3/i.test(model)) return stability;
  return stability < 0.25 ? 0 : stability < 0.75 ? 0.5 : 1;
}

/** ElevenLabs text-to-speech request body with the persona's voice settings. */
export function elevenBody(text: string, v: VoiceSettings, model: string, lang: "he" | "en" | "ar"): Record<string, unknown> {
  return {
    text,
    model_id: model,
    language_code: lang,
    voice_settings: {
      stability: stabilityFor(model, v.stability),
      similarity_boost: v.similarity_boost,
      style: v.style,
      use_speaker_boost: v.speaker_boost,
      speed: v.speed,
    },
  };
}

/** The OpenAI fallback: same character (voice + speaking instructions), Opus for a real voice bubble. */
export function openaiBody(text: string, v: VoiceSettings, model: string, format: "opus" | "mp3" | "pcm", lang: "he" | "en" | "ar"): Record<string, unknown> {
  const tone = v.preset === "default" || v.preset === "custom" ? "Speak naturally, warmly and clearly, like a friendly professional." : PRESET_DEFS[v.preset].tone;
  const langName = lang === "en" ? "English" : lang === "ar" ? "Arabic" : "Hebrew";
  return {
    model,
    voice: v.openai_voice,
    input: text,
    response_format: format,
    speed: v.speed,
    ...(/gpt-4o/i.test(model) ? { instructions: `${tone} The text is in ${langName}: pronounce it like a native speaker.` } : {}),
  };
}

/**
 * Speech-to-text hint (Whisper "prompt", limited to ~224 tokens): the business name and glossary so
 * names, products, slang and abbreviations are transcribed correctly, plus a short style example in
 * the language so the transcript comes back with punctuation.
 */
export function sttPrompt(input: { orgName?: string | null; glossary?: string[]; locale: string }): string {
  const start = input.locale === "en" ? "Hi, I wanted to ask about" : input.locale === "ar" ? "مرحباً، أردت أن أسأل عن" : "היי, רציתי לשאול לגבי";
  const words = [input.orgName ?? "", ...(input.glossary ?? [])].map((w) => w.trim()).filter(Boolean);
  let out = start;
  for (const w of words) {
    const next = `${out}${out === start ? " " : ", "}${w}`;
    if (next.length > 600) break;
    out = next;
  }
  return out.slice(0, 600);
}
