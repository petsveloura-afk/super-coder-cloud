import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { spokenText } from "@/lib/ai/voice-note-core";
import { elevenBody, hasPersona, normalizeVoice, openaiBody, type VoiceSettings } from "@/lib/ai/voice-persona-core";
import { Pcm24kToUlaw8k } from "./realtime-core";

/**
 * Wave 56 — the phone speaks with the agent's own voice:
 *   • turn-by-turn calls: an MP3 clip in the agent's voice (ElevenLabs persona → OpenAI) played by Twilio
 *     (<Play>), instead of the standard Google voice — Google stays as the last fallback;
 *   • live calls: the same voice streamed as µ-law 8 kHz to the bridge (first audio in a fraction of a second).
 */

type Lang = "he" | "en" | "ar";
const langOf = (l: string): Lang => (l === "en" || l === "ar" ? l : "he");

/** The voice of the business's phone agent (first enabled agent), or the platform default. */
export async function phoneVoice(orgId: string): Promise<VoiceSettings> {
  try {
    const { data } = await createAdminClient().from("ai_agents").select("voice").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle();
    return normalizeVoice((data as { voice?: unknown } | null)?.voice);
  } catch {
    return normalizeVoice(null);
  }
}

/** ElevenLabs model for the phone: fast where the language allows it (Hebrew needs Eleven v3). */
export function phoneModel(lang: Lang, env: Record<string, string | undefined> = process.env): string {
  if (env.ELEVENLABS_PHONE_MODEL) return env.ELEVENLABS_PHONE_MODEL;
  return lang === "he" ? env.ELEVENLABS_MODEL || "eleven_v3" : "eleven_flash_v2_5";
}

export function phoneTtsReady(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ELEVENLABS_API_KEY || env.OPENAI_API_KEY);
}

/** One MP3 of the text in the agent's voice (null → the caller uses Twilio's <Say>). */
export async function phoneSpeechMp3(orgId: string, text: string, locale: string): Promise<Buffer | null> {
  const clean = spokenText(text, 700);
  if (!clean || !phoneTtsReady()) return null;
  const env = process.env;
  const lang = langOf(locale);
  const v = await phoneVoice(orgId);
  const voiceId = (hasPersona(v) ? v.voice_id : "") || env.ELEVENLABS_VOICE_ID || "";
  if (env.ELEVENLABS_API_KEY && voiceId) {
    try {
      const base = (env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
      const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`, {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(elevenBody(clean, v, phoneModel(lang), lang)),
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 200) return buf;
      } else console.error("elevenlabs phone tts failed", res.status);
    } catch (e) {
      console.error("elevenlabs phone tts failed", (e as Error).message);
    }
  }
  if (env.OPENAI_API_KEY) {
    try {
      const base = (env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(openaiBody(clean, v, env.AI_OPENAI_TTS_MODEL || "gpt-4o-mini-tts", "mp3", lang)),
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 200) return buf;
      } else console.error("openai phone tts failed", res.status);
    } catch (e) {
      console.error("openai phone tts failed", (e as Error).message);
    }
  }
  return null;
}

/** Stores a short clip and returns the URL Twilio plays (unguessable id, served for 30 minutes). */
export async function phoneClipUrl(orgId: string, text: string, locale: string): Promise<string | null> {
  if (process.env.VOICE_PHONE_TTS === "off") return null;
  const mp3 = await phoneSpeechMp3(orgId, text, locale);
  if (!mp3) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("voice_clips").insert({ organization_id: orgId, mime: "audio/mpeg", audio_b64: mp3.toString("base64") }).select("id").single();
    if (error || !data) return null;
    // housekeeping: clips are needed for minutes only
    void admin.from("voice_clips").delete().lt("created_at", new Date(Date.now() - 6 * 3600_000).toISOString()).then(() => undefined, () => undefined);
    return `${publicEnv.appUrl.replace(/\/$/, "")}/api/voice/clip/${data.id as string}`;
  } catch {
    return null;
  }
}

/**
 * Live calls: the agent's voice as a stream of µ-law 8 kHz bytes (ElevenLabs streaming → OpenAI PCM
 * converted on the fly). Returns null when no engine answered.
 */
export async function phoneSpeechStream(orgId: string, text: string, locale: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  const clean = spokenText(text, 700);
  if (!clean) return null;
  const env = process.env;
  const lang = langOf(locale);
  const v = await phoneVoice(orgId);
  const voiceId = (hasPersona(v) ? v.voice_id : "") || env.ELEVENLABS_VOICE_ID || "";
  if (env.ELEVENLABS_API_KEY && voiceId) {
    try {
      const base = (env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
      const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=ulaw_8000&optimize_streaming_latency=3`, {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/basic" },
        body: JSON.stringify(elevenBody(clean, v, phoneModel(lang), lang)),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      if (res.ok && res.body) return res.body;
      console.error("elevenlabs phone stream failed", res.status);
    } catch (e) {
      console.error("elevenlabs phone stream failed", (e as Error).message);
    }
  }
  if (env.OPENAI_API_KEY) {
    try {
      const base = (env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(openaiBody(clean, v, env.AI_OPENAI_TTS_MODEL || "gpt-4o-mini-tts", "pcm", lang)),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      if (res.ok && res.body) {
        const conv = new Pcm24kToUlaw8k();
        return res.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
              const out = conv.push(chunk);
              if (out.length) ctl.enqueue(out);
            },
          }),
        );
      }
      console.error("openai phone stream failed", res.status);
    } catch (e) {
      console.error("openai phone stream failed", (e as Error).message);
    }
  }
  return null;
}
