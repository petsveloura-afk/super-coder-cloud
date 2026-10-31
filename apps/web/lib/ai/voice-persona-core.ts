/**
 * Wave 55 — voice persona per AI agent (pure parts, unit-tested).
 *
 * Every agent can speak with its own voice: a ready persona (soft & warm female, deep authoritative
 * male, high-energy sales) or a custom ElevenLabs voice, with the full ElevenLabs voice settings
 * (stability, similarity_boost, style exaggeration, speaker boost, speed) and a matching OpenAI
 * fallback voice + speaking instructions. The same settings also carry the business glossary that
 * makes speech-to-text understand the business' names, products, slang and abbreviations.
 */

export const VOICE_PRESETS = ["default", "soft_female", "authoritative_male", "energetic_sales", "custom", "hebrew_female", "hebrew_male"] as const; // wave 58: + native Israeli voices
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
  // wave 58 — native Israeli Hebrew voices from the ElevenLabs voice library
  hebrew_female: {
    voice_id: "s0T0DT6EAPeX57MQpn3I", // Danit — natural Israeli Hebrew, conversational
    stability: 0.5,
    similarity_boost: 0.8,
    style: 0.2,
    speaker_boost: true,
    speed: 1,
    openai_voice: "coral",
    tone: "Speak in a natural, warm, friendly young Israeli female voice. Conversational everyday Hebrew, relaxed and personal, like talking to a friend.",
  },
  hebrew_male: {
    voice_id: "PBHwEnXdzx0yfhIO2UCH", // Dorian — expressive young Israeli man, warm and charismatic
    stability: 0.45,
    similarity_boost: 0.8,
    style: 0.3,
    speaker_boost: true,
    speed: 1,
    openai_voice: "ash",
    tone: "Speak in a warm, expressive, charismatic young Israeli male voice. Natural conversational Hebrew, engaging and sincere, never robotic.",
  },
};

/**
 * Wave 58 — the voice used when neither the agent nor the platform chose one: a native Israeli voice in
 * Hebrew, a premade multilingual voice otherwise, so the agent never falls back to a robotic voice just
 * because ELEVENLABS_VOICE_ID was left empty. ELEVENLABS_VOICE_PRESET=hebrew_male picks the male voice.
 */
export function defaultVoiceId(lang: "he" | "en" | "ar", env: Record<string, string | undefined> = process.env): string {
  if (env.ELEVENLABS_VOICE_ID && validVoiceId(env.ELEVENLABS_VOICE_ID)) return env.ELEVENLABS_VOICE_ID.trim();
  if (lang !== "he") return PRESET_DEFS.soft_female.voice_id;
  return env.ELEVENLABS_VOICE_PRESET === "hebrew_male" ? PRESET_DEFS.hebrew_male.voice_id : PRESET_DEFS.hebrew_female.voice_id;
}

/** ElevenLabs' own premade voices: every account can use them through the API, the free plan too. */
const PREMADE_IDS = new Set([PRESET_DEFS.soft_female.voice_id, PRESET_DEFS.authoritative_male.voice_id, PRESET_DEFS.energetic_sales.voice_id]);

/**
 * Wave 58 — the voices to try, in order: the chosen one, then a premade voice of the same gender. A
 * library voice (Danit, Dorian) or a cloned voice needs a paid ElevenLabs plan through the API; when it is
 * refused the agent still speaks naturally instead of falling back to a robotic voice.
 */
export function elevenVoiceChain(voiceId: string, v?: Pick<VoiceSettings, "preset"> | null): string[] {
  if (!voiceId) return [];
  if (PREMADE_IDS.has(voiceId)) return [voiceId];
  const male = voiceId === PRESET_DEFS.hebrew_male.voice_id || v?.preset === "hebrew_male" || v?.preset === "authoritative_male" || v?.preset === "energetic_sales";
  return [voiceId, male ? PRESET_DEFS.authoritative_male.voice_id : PRESET_DEFS.soft_female.voice_id];
}

/** Why ElevenLabs refused: a wrong key, a voice that needs a paid plan, or no credits left. */
export function elevenFailReason(status: number, body: string): "key" | "paid" | "quota" | "other" {
  const b = body.toLowerCase();
  if (/quota|credits|character_limit|exceeds your/.test(b)) return "quota";
  if (status === 402 || /paid_plan|payment_required|subscription|upgrade|library voices|free users/.test(b)) return "paid";
  if (status === 401 || /invalid_api_key|unauthorized|missing_permissions/.test(b)) return "key";
  return "other";
}

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
