import "server-only";
import { randomUUID } from "node:crypto";
import { geminiKeys } from "./providers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * AI images with Google Gemini image models ("Nano Banana" family) over plain HTTPS.
 * Uses the same key pool as text (GEMINI_API_KEY, _2…_10, GEMINI_API_KEYS) and falls back
 * along AI_GEMINI_IMAGE_MODELS when a model is busy, rate-limited or not available for the key.
 * The PNG/JPEG is stored in the public "site-assets" bucket under <org>/… (server-side only).
 */
const IMAGE_MODELS = () =>
  (process.env.AI_GEMINI_IMAGE_MODELS || "gemini-3.1-flash-image,gemini-2.5-flash-image,gemini-3.1-flash-lite-image")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 4);

export function imagesConfigured(): boolean {
  return geminiKeys().length > 0 && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export interface GeneratedImage {
  mimeType: string;
  data: Buffer;
  model: string;
}

/** Raw generation (no storage). Throws `image_<status>…` when every model/key failed. */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("image_not_configured");
  const base = (process.env.AI_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt.slice(0, 1800) }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  const start = Math.floor(Math.random() * keys.length);
  let last = "image_failed";
  let calls = 0;
  for (const model of IMAGE_MODELS()) {
    for (let k = 0; k < keys.length && calls < 6; k++) {
      const key = keys[(start + k) % keys.length]!;
      calls++;
      const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }) as unknown as Response);
      const json = (await res.json().catch(() => ({}))) as {
        candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[] } }[];
        error?: { status?: string; message?: string };
      };
      if (res.ok) {
        for (const p of json.candidates?.[0]?.content?.parts ?? []) {
          const inline = p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : undefined);
          if (inline?.data) return { mimeType: inline.mimeType || "image/png", data: Buffer.from(inline.data, "base64"), model };
        }
        last = "image_empty";
        break; // this model answered without an image → try the next model
      }
      last = `image_${res.status}${json.error?.status ? `:${json.error.status}` : ""}${json.error?.message ? `:${json.error.message.slice(0, 160)}` : ""}`;
      console.error("gemini image failed", model, last);
      if (res.status === 404 || res.status === 400 || res.status === 403) break; // model not available for this key → next model
    }
    if (calls >= 6) break;
  }
  throw new Error(last);
}

/** Generate + store in the public bucket; returns the public https URL. */
export async function generateAndStoreImage(orgId: string, prompt: string): Promise<{ url: string; model: string }> {
  const img = await generateImage(prompt);
  const ext = img.mimeType.includes("jpeg") ? "jpg" : img.mimeType.includes("webp") ? "webp" : "png";
  const path = `${orgId}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage.from("site-assets").upload(path, img.data, { contentType: img.mimeType, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`image_store:${error.message}`);
  const { data } = admin.storage.from("site-assets").getPublicUrl(path);
  return { url: data.publicUrl, model: img.model };
}
