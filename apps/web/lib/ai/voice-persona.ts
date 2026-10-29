import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOggOpus, spokenText } from "./voice-note-core";
import { elevenBody, hasPersona, normalizeVoice, openaiBody, type VoiceSettings } from "./voice-persona-core";

/**
 * Wave 55 — speaks with the agent's own voice persona:
 *   1. ElevenLabs with the persona's voice + voice settings, OGG/Opus first (a real voice message), then MP3;
 *   2. OpenAI TTS with the matching voice + speaking instructions (Opus, then MP3).
 * Returns null when nothing worked, and the caller falls back to the default voice (wave 22).
 * Never throws.
 */
export interface PersonaAudio {
  buf: Buffer;
  mime: string;
  provider: "elevenlabs" | "openai";
}

/** The agent's voice settings (null before the migration ran or when none is set). */
export async function loadVoicePersona(agentId: string | null | undefined): Promise<VoiceSettings | null> {
  if (!agentId) return null;
  try {
    const { data, error } = await createAdminClient().from("ai_agents").select("voice").eq("id", agentId).maybeSingle();
    if (error || !data) return null;
    return normalizeVoice((data as { voice?: unknown }).voice);
  } catch {
    return null;
  }
}

const langOf = (locale: string): "he" | "en" | "ar" => (locale === "en" ? "en" : locale === "ar" ? "ar" : "he");

export async function synthesizePersonaVoice(text: string, locale: string, v: VoiceSettings, opts: { force?: boolean; maxChars?: number } = {}): Promise<PersonaAudio | null> {
  if (!opts.force && !hasPersona(v)) return null;
  const clean = spokenText(text, opts.maxChars ?? 700);
  if (!clean) return null;
  const env = process.env;
  const lang = langOf(locale);
  const voiceId = v.voice_id || env.ELEVENLABS_VOICE_ID || "";
  if (env.ELEVENLABS_API_KEY && voiceId) {
    const base = (env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
    const model = env.ELEVENLABS_MODEL || "eleven_v3";
    for (const format of ["opus_48000_64", "mp3_44100_64"]) {
      try {
        const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${format}`, {
          method: "POST",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: format.startsWith("opus") ? "audio/ogg" : "audio/mpeg" },
          body: JSON.stringify(elevenBody(clean, v, model, lang)),
          signal: AbortSignal.timeout(40_000),
          cache: "no-store",
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (format.startsWith("opus") ? isOggOpus(buf) : buf.length > 100) return { buf, mime: format.startsWith("opus") ? "audio/ogg" : "audio/mpeg", provider: "elevenlabs" };
        } else console.error("elevenlabs persona tts failed", format, res.status, (await res.text().catch(() => "")).slice(0, 200));
      } catch (e) {
        console.error("elevenlabs persona tts failed", format, (e as Error).message);
      }
    }
  }
  if (env.OPENAI_API_KEY) {
    const base = (env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = env.AI_OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    for (const format of ["opus", "mp3"] as const) {
      try {
        const res = await fetch(`${base}/audio/speech`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(openaiBody(clean, v, model, format, lang)),
          signal: AbortSignal.timeout(40_000),
          cache: "no-store",
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (format === "opus" ? isOggOpus(buf) : buf.length > 100) return { buf, mime: format === "opus" ? "audio/ogg" : "audio/mpeg", provider: "openai" };
        } else console.error("openai persona tts failed", format, res.status);
      } catch (e) {
        console.error("openai persona tts failed", format, (e as Error).message);
      }
    }
  }
  return null;
}

/** Business name + glossary for speech-to-text (null before the migration ran). */
export async function loadSttContext(orgId: string): Promise<{ orgName: string | null; glossary: string[] }> {
  try {
    const admin = createAdminClient();
    const [{ data: org }, { data: agents }] = await Promise.all([
      admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      admin.from("ai_agents").select("voice").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(5),
    ]);
    const glossary = [...new Set(((agents ?? []) as { voice?: unknown }[]).flatMap((a) => normalizeVoice(a.voice).glossary))].slice(0, 60);
    return { orgName: (org?.name as string | undefined) ?? null, glossary };
  } catch {
    return { orgName: null, glossary: [] };
  }
}
