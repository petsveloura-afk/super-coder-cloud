import "server-only";
import { isOggOpus, spokenText, voiceFileName, type VoiceChannel } from "./voice-note-core";

/**
 * Wave 22 — the agent's spoken answer:
 *  1. synthesizeVoiceNote: ElevenLabs (natural Hebrew) or OpenAI TTS, as OGG/Opus so it arrives
 *     as a real voice message; MP3 when Opus is not available.
 *  2. deliverVoiceNote: Telegram bot, Telegram Business (on behalf of the owner), personal
 *     Telegram and WhatsApp by QR (through the bridge), WhatsApp Cloud.
 * Never throws; false / null when it cannot.
 */
export interface VoiceAudio {
  buf: Buffer;
  mime: string;
}

export async function synthesizeVoiceNote(text: string, locale: string, persona?: import("./voice-persona-core").VoiceSettings | null): Promise<VoiceAudio | null> {
  const clean = spokenText(text);
  if (!clean) return null;
  // wave 55: the agent's own voice persona first (ElevenLabs voice settings → OpenAI voice + tone),
  // then the default voice below exactly as before
  if (persona) {
    const { synthesizePersonaVoice } = await import("./voice-persona");
    const own = await synthesizePersonaVoice(text, locale, persona).catch(() => null);
    if (own) return { buf: own.buf, mime: own.mime };
  }
  const env = process.env;
  if (env.ELEVENLABS_API_KEY) {
    // Hebrew needs Eleven v3 (Multilingual v2 has no Hebrew). OGG/Opus first (a real voice message),
    // MP3 from the same voice when Opus is not offered on the account.
    const base = (env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
    const voice = env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    const model = env.ELEVENLABS_MODEL || "eleven_v3";
    const lang = locale === "en" ? "en" : locale === "ar" ? "ar" : "he";
    for (const format of ["opus_48000_64", "mp3_44100_64"]) {
      try {
        const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${format}`, {
          method: "POST",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: format.startsWith("opus") ? "audio/ogg" : "audio/mpeg" },
          body: JSON.stringify({ text: clean, model_id: model, language_code: lang }),
          signal: AbortSignal.timeout(40_000),
          cache: "no-store",
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (format.startsWith("opus") ? isOggOpus(buf) : buf.length > 100) return { buf, mime: format.startsWith("opus") ? "audio/ogg" : "audio/mpeg" };
        } else console.error("elevenlabs tts failed", format, res.status, (await res.text().catch(() => "")).slice(0, 200));
      } catch (e) {
        console.error("elevenlabs tts failed", format, (e as Error).message);
      }
    }
  }
  if (env.OPENAI_API_KEY) {
    try {
      const base = (env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.AI_OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: env.AI_OPENAI_TTS_VOICE || "alloy", input: clean, response_format: "opus" }),
        signal: AbortSignal.timeout(40_000),
        cache: "no-store",
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (isOggOpus(buf)) return { buf, mime: "audio/ogg" };
      } else console.error("openai opus failed", res.status);
    } catch (e) {
      console.error("openai opus failed", (e as Error).message);
    }
  }
  // MP3 (wave 16 path): still a playable audio message everywhere
  const { synthesizeSpeech } = await import("./tts");
  const mp3 = await synthesizeSpeech(clean, locale);
  return mp3 ? { buf: mp3, mime: "audio/mpeg" } : null;
}

async function telegramVoice(botToken: string, fields: Record<string, string>, audio: VoiceAudio): Promise<boolean> {
  const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("voice", new Blob([new Uint8Array(audio.buf)], { type: audio.mime }), voiceFileName(audio.mime));
  try {
    const res = await fetch(`${base}/bot${botToken}/sendVoice`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) console.error("telegram sendVoice failed", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error("telegram sendVoice failed", (e as Error).message);
    return false;
  }
}

export async function deliverVoiceNote(input: { orgId: string; channel: VoiceChannel; externalId: string; conversationId?: string | null; audio: VoiceAudio }): Promise<boolean> {
  const { orgId, channel, externalId, audio } = input;
  try {
    const { loadAccount } = await import("@/lib/channels/accounts");
    if (channel === "telegram") {
      const acc = await loadAccount(orgId, "telegram");
      if (!acc?.secrets.bot_token) return false;
      if (externalId.startsWith("biz:")) {
        // Telegram Business: the voice note goes out from the owner's own account
        const { businessConnectionFor } = await import("@/lib/channels/send-message");
        const connection = await businessConnectionFor(orgId, externalId, input.conversationId ?? null);
        if (!connection) return false;
        return telegramVoice(acc.secrets.bot_token, { business_connection_id: connection, chat_id: externalId.slice(4) }, audio);
      }
      return telegramVoice(acc.secrets.bot_token, { chat_id: externalId }, audio);
    }
    if (channel === "whatsapp_qr" || channel === "telegram_user") {
      const acc = await loadAccount(orgId, channel);
      if (!acc) return false;
      const { bridgeCall } = await import("@/lib/channels/wa-bridge");
      const path = channel === "whatsapp_qr" ? `/sessions/${acc.id}/voice` : `/tg/sessions/${acc.id}/voice`;
      const r = await bridgeCall(path, { method: "POST", body: { to: externalId.replace(/[^\d]/g, ""), audio: audio.buf.toString("base64"), mime: audio.mime } });
      if (!r.ok) console.error("bridge voice failed", r.status, String(r.data.error ?? ""));
      return r.ok;
    }
    if (channel === "whatsapp") {
      // WhatsApp Cloud accepts OGG/Opus and MP3 audio
      const acc = await loadAccount(orgId, "whatsapp");
      if (!acc) return false;
      const base = (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
      const pid = encodeURIComponent(acc.config.phone_number_id ?? "");
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", audio.mime);
      form.append("file", new Blob([new Uint8Array(audio.buf)], { type: audio.mime }), voiceFileName(audio.mime));
      const up = await fetch(`${base}/${pid}/media`, { method: "POST", headers: { Authorization: `Bearer ${acc.secrets.access_token ?? ""}` }, body: form, signal: AbortSignal.timeout(30_000), cache: "no-store" });
      const j = (await up.json().catch(() => ({}))) as { id?: string };
      if (!up.ok || !j.id) return false;
      const res = await fetch(`${base}/${pid}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${acc.secrets.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: externalId.replace(/^\+/, ""), type: "audio", audio: { id: j.id } }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      return res.ok;
    }
  } catch (e) {
    console.error("voice note failed", (e as Error).message);
  }
  return false;
}
