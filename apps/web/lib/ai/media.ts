import "server-only";
import { geminiKeys } from "./providers";
import { providerKeys } from "./router-core";
import { DOC_MAX_BYTES, documentKind, documentPrompt, maskSecrets, readPlainText } from "./document-core";

/**
 * Wave 16 — the agent understands voice notes and pictures:
 *   transcribeAudio  Groq Whisper (free tier) → OpenAI → Gemini (audio input)
 *   describeImage    Gemini (vision) → OpenAI → Anthropic → Groq (Llama 4 vision)
 * Every engine that has a key is tried once, in this order. Bases are overridable
 * for tests (AI_GROQ_BASE_URL, AI_OPENAI_BASE_URL, AI_GEMINI_BASE_URL, AI_ANTHROPIC_BASE_URL).
 */
export interface MediaResult {
  text: string;
  provider: string;
  model: string;
}

const MAX = 6 * 1024 * 1024;
const groqBase = () => (process.env.AI_GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const openaiBase = () => (process.env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const geminiBase = () => (process.env.AI_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const anthropicBase = () => (process.env.AI_ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");

export function mediaEnginesConfigured(env: Record<string, string | undefined> = process.env): { audio: boolean; vision: boolean; document: boolean } {
  const groq = providerKeys("groq", env).length > 0;
  const gem = geminiKeys(env).length > 0;
  const oa = Boolean(env.OPENAI_API_KEY);
  const an = Boolean(env.ANTHROPIC_API_KEY);
  return { audio: groq || gem || oa, vision: gem || oa || an || groq, document: gem || an };
}

function extFor(mime: string): string {
  if (/ogg|opus/.test(mime)) return "ogg";
  if (/mpeg|mp3/.test(mime)) return "mp3";
  if (/mp4|m4a|aac/.test(mime)) return "m4a";
  if (/wav/.test(mime)) return "wav";
  if (/webm/.test(mime)) return "webm";
  return "ogg";
}

async function whisper(base: string, key: string, model: string, buf: Buffer, mime: string, lang?: string, hint?: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime.split(";")[0] || "audio/ogg" }), `voice.${extFor(mime)}`);
  form.append("model", model);
  form.append("response_format", "json");
  if (lang && /^(he|ar|en)$/.test(lang)) form.append("language", lang);
  // wave 55: business glossary (names, products, slang, abbreviations) as the Whisper prompt
  if (hint && hint.trim()) form.append("prompt", hint.trim().slice(0, 600));
  const res = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(45_000), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(`whisper_${res.status}:${j.error?.message?.slice(0, 200) ?? ""}`);
  return (j.text ?? "").trim();
}

async function geminiParts(key: string, model: string, parts: unknown[], maxTokens = 800): Promise<string> {
  const res = await fetch(`${geminiBase()}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens } }),
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`gemini_${res.status}:${j.error?.message?.slice(0, 200) ?? ""}`);
  return (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
}

export async function transcribeAudio(buf: Buffer, mime: string, lang?: string, hint?: string): Promise<MediaResult | null> {
  if (!buf.length || buf.length > MAX) return null;
  const env = process.env;
  for (const key of providerKeys("groq", env).slice(0, 2)) {
    try {
      const model = env.AI_GROQ_WHISPER_MODEL || "whisper-large-v3-turbo";
      const text = await whisper(groqBase(), key, model, buf, mime, lang, hint);
      if (text) return { text, provider: "groq", model };
    } catch (e) {
      console.error("groq whisper failed", (e as Error).message);
    }
  }
  if (env.OPENAI_API_KEY) {
    try {
      const model = env.AI_OPENAI_TRANSCRIBE_MODEL || "whisper-1";
      const text = await whisper(openaiBase(), env.OPENAI_API_KEY, model, buf, mime, lang, hint);
      if (text) return { text, provider: "openai", model };
    } catch (e) {
      console.error("openai whisper failed", (e as Error).message);
    }
  }
  for (const key of geminiKeys(env).slice(0, 2)) {
    try {
      const model = env.AI_GEMINI_MEDIA_MODEL || "gemini-2.5-flash";
      const text = await geminiParts(key, model, [
        { text: `Transcribe this voice message word for word in its original language. Output only the transcript, nothing else.${hint ? ` Words that may appear (spell them exactly like this): ${hint.slice(0, 600)}` : ""}` },
        { inline_data: { mime_type: mime.split(";")[0] || "audio/ogg", data: buf.toString("base64") } },
      ]);
      if (text) return { text, provider: "gemini", model };
    } catch (e) {
      console.error("gemini transcription failed", (e as Error).message);
    }
  }
  return null;
}

/** Prompt for pictures customers send (product photos, screenshots, receipts, business cards). */
export function visionPrompt(locale: string): string {
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  return [
    `A customer sent this image to a business. In ${lang}, in at most 3 short sentences, describe what it shows and what the customer probably wants.`,
    "If it is a document, receipt, invoice, business card or screenshot with text, list the important details (names, phone, e-mail, amounts, dates, product / model) exactly as written.",
    "Never guess details that are not visible. No preface.",
  ].join(" ");
}

export async function describeImage(buf: Buffer, mime: string, locale: string): Promise<MediaResult | null> {
  if (!buf.length || buf.length > MAX) return null;
  const env = process.env;
  const m = (mime.split(";")[0] || "image/jpeg").replace("image/jpg", "image/jpeg");
  const prompt = visionPrompt(locale);
  const b64 = buf.toString("base64");
  for (const key of geminiKeys(env).slice(0, 2)) {
    try {
      const model = env.AI_GEMINI_MEDIA_MODEL || "gemini-2.5-flash";
      const text = await geminiParts(key, model, [{ text: prompt }, { inline_data: { mime_type: m, data: b64 } }], 500);
      if (text) return { text, provider: "gemini", model };
    } catch (e) {
      console.error("gemini vision failed", (e as Error).message);
    }
  }
  const chat = async (base: string, key: string, model: string, provider: string): Promise<MediaResult | null> => {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 500, temperature: 0.1, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${m};base64,${b64}` } }] }] }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`${provider}_${res.status}:${j.error?.message?.slice(0, 200) ?? ""}`);
    const text = (j.choices?.[0]?.message?.content ?? "").trim();
    return text ? { text, provider, model } : null;
  };
  if (env.OPENAI_API_KEY) {
    try {
      const r = await chat(openaiBase(), env.OPENAI_API_KEY, env.AI_OPENAI_VISION_MODEL || "gpt-4o-mini", "openai");
      if (r) return r;
    } catch (e) {
      console.error("openai vision failed", (e as Error).message);
    }
  }
  if (env.ANTHROPIC_API_KEY) {
    try {
      const model = env.AI_ANTHROPIC_VISION_MODEL || "claude-haiku-4-5";
      const res = await fetch(`${anthropicBase()}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: m, data: b64 } }, { type: "text", text: prompt }] }] }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[] };
      const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
      if (res.ok && text) return { text, provider: "anthropic", model };
    } catch (e) {
      console.error("anthropic vision failed", (e as Error).message);
    }
  }
  for (const key of providerKeys("groq", env).slice(0, 1)) {
    try {
      const r = await chat(groqBase(), key, env.AI_GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct", "groq");
      if (r) return r;
    } catch (e) {
      console.error("groq vision failed", (e as Error).message);
    }
  }
  return null;
}

/* ---------------------------------------------------------- documents ---- */
/** Wave 16: read a PDF / text file a customer sent → a short summary for the agent. */
export async function readDocument(buf: Buffer, mime: string, locale: string, name?: string): Promise<MediaResult | null> {
  if (!buf.length || buf.length > DOC_MAX_BYTES) return null;
  const kind = documentKind(buf, mime, name);
  if (!kind) return null;
  if (kind === "text") {
    const text = readPlainText(buf);
    return text ? { text, provider: "local", model: "text" } : null;
  }
  const env = process.env;
  const prompt = documentPrompt(locale, name);
  const b64 = buf.toString("base64");
  for (const key of geminiKeys(env).slice(0, 2)) {
    try {
      const model = env.AI_GEMINI_MEDIA_MODEL || "gemini-2.5-flash";
      const text = await geminiParts(key, model, [{ inline_data: { mime_type: "application/pdf", data: b64 } }, { text: prompt }], 700);
      if (text) return { text: maskSecrets(text), provider: "gemini", model };
    } catch (e) {
      console.error("gemini document failed", (e as Error).message);
    }
  }
  if (env.ANTHROPIC_API_KEY) {
    try {
      const model = env.AI_ANTHROPIC_VISION_MODEL || "claude-haiku-4-5";
      const res = await fetch(`${anthropicBase()}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: prompt }] }] }),
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[] };
      const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
      if (res.ok && text) return { text: maskSecrets(text), provider: "anthropic", model };
    } catch (e) {
      console.error("anthropic document failed", (e as Error).message);
    }
  }
  return null;
}

/* ---------------------------------------------------------- downloads ---- */
export async function telegramFile(botToken: string, fileId: string): Promise<{ buf: Buffer; mime: string } | null> {
  const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
  const r = await fetch(`${base}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
  if (!j.ok || !j.result?.file_path || (j.result.file_size ?? 0) > MAX) return null;
  const f = await fetch(`${base}/file/bot${botToken}/${j.result.file_path}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!f.ok) return null;
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.length > MAX) return null;
  const p = j.result.file_path.toLowerCase();
  const mime = p.endsWith(".oga") || p.endsWith(".ogg") ? "audio/ogg" : p.endsWith(".mp3") ? "audio/mpeg" : p.endsWith(".m4a") ? "audio/mp4" : p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : /\.(jpe?g)$/.test(p) ? "image/jpeg" : "application/octet-stream";
  return { buf, mime: f.headers.get("content-type")?.startsWith("audio/") || f.headers.get("content-type")?.startsWith("image/") ? (f.headers.get("content-type") as string) : mime };
}

export async function whatsappMedia(accessToken: string, mediaId: string): Promise<{ buf: Buffer; mime: string } | null> {
  const base = (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
  const r = await fetch(`${base}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
  if (!r.ok || !j.url || (j.file_size ?? 0) > MAX) return null;
  const f = await fetch(j.url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!f.ok) return null;
  const buf = Buffer.from(await f.arrayBuffer());
  return buf.length > MAX ? null : { buf, mime: j.mime_type ?? f.headers.get("content-type") ?? "application/octet-stream" };
}
