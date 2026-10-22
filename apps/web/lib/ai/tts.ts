import "server-only";

/**
 * Wave 16 — the agent answers a voice note with a voice note (optional, per agent).
 * ElevenLabs (ELEVENLABS_API_KEY, natural Hebrew/Arabic/English voices) or OpenAI TTS.
 * MP3 output: Telegram sendVoice and WhatsApp Cloud accept it. Bases are overridable for
 * tests (ELEVENLABS_API_BASE, AI_OPENAI_BASE_URL).
 */
export function ttsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ELEVENLABS_API_KEY || env.OPENAI_API_KEY);
}

export async function synthesizeSpeech(text: string, locale: string): Promise<Buffer | null> {
  const clean = text.replace(/\*\*?|__|`|\[\[[^\]]*\]\]|https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 900);
  if (!clean) return null;
  const env = process.env;
  if (env.ELEVENLABS_API_KEY) {
    try {
      const base = (env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
      const voice = env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: clean, model_id: env.ELEVENLABS_MODEL || "eleven_multilingual_v2", language_code: locale === "en" ? "en" : locale === "ar" ? "ar" : "he" }),
        signal: AbortSignal.timeout(40_000),
        cache: "no-store",
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      console.error("elevenlabs tts failed", res.status);
    } catch (e) {
      console.error("elevenlabs tts failed", (e as Error).message);
    }
  }
  if (env.OPENAI_API_KEY) {
    try {
      const base = (env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.AI_OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: env.AI_OPENAI_TTS_VOICE || "alloy", input: clean, response_format: "mp3" }),
        signal: AbortSignal.timeout(40_000),
        cache: "no-store",
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      console.error("openai tts failed", res.status);
    } catch (e) {
      console.error("openai tts failed", (e as Error).message);
    }
  }
  return null;
}

/** Sends an MP3 voice note into a Telegram (bot) or WhatsApp Cloud conversation. */
export async function sendVoiceNote(orgId: string, channel: string, externalId: string, mp3: Buffer): Promise<boolean> {
  const { loadAccount } = await import("@/lib/channels/accounts");
  if (channel === "telegram" && !externalId.startsWith("biz:")) {
    const acc = await loadAccount(orgId, "telegram");
    if (!acc?.secrets.bot_token) return false;
    const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
    const form = new FormData();
    form.append("chat_id", externalId);
    form.append("voice", new Blob([new Uint8Array(mp3)], { type: "audio/mpeg" }), "reply.mp3");
    const res = await fetch(`${base}/bot${acc.secrets.bot_token}/sendVoice`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    return res.ok;
  }
  if (channel === "whatsapp") {
    const acc = await loadAccount(orgId, "whatsapp");
    if (!acc) return false;
    const base = (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "audio/mpeg");
    form.append("file", new Blob([new Uint8Array(mp3)], { type: "audio/mpeg" }), "reply.mp3");
    const up = await fetch(`${base}/${encodeURIComponent(acc.config.phone_number_id ?? "")}/media`, { method: "POST", headers: { Authorization: `Bearer ${acc.secrets.access_token ?? ""}` }, body: form, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    const j = (await up.json().catch(() => ({}))) as { id?: string };
    if (!up.ok || !j.id) return false;
    const res = await fetch(`${base}/${encodeURIComponent(acc.config.phone_number_id ?? "")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.secrets.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: externalId.replace(/^\+/, ""), type: "audio", audio: { id: j.id } }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    return res.ok;
  }
  return false;
}
