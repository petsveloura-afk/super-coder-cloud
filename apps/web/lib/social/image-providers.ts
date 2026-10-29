import "server-only";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { imageSize, type StudioPlatform } from "./studio-core";
import { Cooldowns, cloudflareAccounts, isLimitError, keyList, paletteFor, stockQuery, type FreeProvider } from "./image-providers-core";

/**
 * Wave 49 — free image providers for the post studio (see image-providers-core.ts for the list and env vars).
 * Each provider returns raw bytes; the picture is stored in the same public "site-assets" bucket as before.
 * Providers that hit a free-tier limit rest for 15 minutes (per key), so a click never waits on a dead provider.
 */

export interface RawImage {
  buf: Buffer;
  mime: string;
  model: string;
}

const cool = new Cooldowns();
const UA = "SuperCoderCloud/1.0 (+https://super-coder-cloud.vercel.app)";

function checkImage(buf: Buffer, mime: string): void {
  if (!mime.startsWith("image/")) throw new Error("not_image");
  if (buf.length < 2_000 || buf.length > 8 * 1024 * 1024) throw new Error("bad_size");
}

async function download(url: string, timeoutMs = 25_000): Promise<{ buf: Buffer; mime: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`download_${res.status}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  checkImage(buf, mime);
  return { buf, mime };
}

/* ---------------------------------------------------------------- AI generators */

async function cloudflare(prompt: string): Promise<RawImage> {
  let last = "cloudflare_unavailable";
  for (const acc of cloudflareAccounts(process.env)) {
    const id = `cf:${acc.accountId.slice(-6)}`;
    if (!cool.available(id)) continue;
    const model = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acc.accountId)}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 6 }),
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as unknown as Response);
    const ct = res.headers?.get?.("content-type") ?? "";
    if (res.ok && ct.startsWith("image/")) {
      const buf = Buffer.from(await res.arrayBuffer());
      checkImage(buf, ct.split(";")[0]!);
      return { buf, mime: ct.split(";")[0]!, model: "cf-flux-schnell" };
    }
    const raw = await res.text().catch(() => "");
    if (res.ok) {
      try {
        const j = JSON.parse(raw) as { result?: { image?: string }; success?: boolean };
        if (j.result?.image) {
          const buf = Buffer.from(j.result.image, "base64");
          checkImage(buf, "image/jpeg");
          return { buf, mime: "image/jpeg", model: "cf-flux-schnell" };
        }
      } catch {
        /* fall through */
      }
    }
    last = `cloudflare_${res.status}:${raw.slice(0, 160)}`;
    if (isLimitError(last) || res.status === 401) cool.rest(id);
  }
  throw new Error(last);
}

async function huggingface(prompt: string, platform: StudioPlatform): Promise<RawImage> {
  const { width, height } = imageSize(platform);
  const model = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  let last = "huggingface_unavailable";
  for (const token of keyList(process.env, "HF_TOKEN")) {
    const id = `hf:${token.slice(-6)}`;
    if (!cool.available(id)) continue;
    const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "image/png" },
      body: JSON.stringify({ inputs: prompt.slice(0, 1500), parameters: { width: Math.min(width, 1024), height: Math.min(height, 1024), num_inference_steps: 4 } }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as unknown as Response);
    const ct = (res.headers?.get?.("content-type") ?? "").split(";")[0]!;
    if (res.ok && ct.startsWith("image/")) {
      const buf = Buffer.from(await res.arrayBuffer());
      checkImage(buf, ct);
      return { buf, mime: ct, model: "hf-flux-schnell" };
    }
    last = `huggingface_${res.status}:${(await res.text().catch(() => "")).slice(0, 160)}`;
    if (isLimitError(last) || res.status === 401) cool.rest(id);
  }
  throw new Error(last);
}

async function together(prompt: string, platform: StudioPlatform): Promise<RawImage> {
  const { width, height } = imageSize(platform);
  const model = process.env.TOGETHER_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell-Free";
  let last = "together_unavailable";
  for (const key of keyList(process.env, "TOGETHER_API_KEY")) {
    const id = `tg:${key.slice(-6)}`;
    if (!cool.available(id)) continue;
    const res = await fetch("https://api.together.xyz/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // FLUX sizes must be multiples of 16
      body: JSON.stringify({ model, prompt: prompt.slice(0, 1500), width: Math.round(Math.min(width, 1440) / 16) * 16, height: Math.round(Math.min(height, 1440) / 16) * 16, steps: 4, n: 1, response_format: "b64_json" }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }) as unknown as Response);
    const j = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
    const d = j.data?.[0];
    if (res.ok && d?.b64_json) {
      const buf = Buffer.from(d.b64_json, "base64");
      checkImage(buf, "image/png");
      return { buf, mime: "image/png", model: "together-flux-schnell" };
    }
    if (res.ok && d?.url) {
      const img = await download(d.url);
      return { ...img, model: "together-flux-schnell" };
    }
    last = `together_${res.status}:${String(j.error?.message ?? "").slice(0, 160)}`;
    if (isLimitError(last) || res.status === 401) cool.rest(id);
  }
  throw new Error(last);
}

/* ---------------------------------------------------------------- real photos */

async function pexels(prompt: string, platform: StudioPlatform): Promise<RawImage> {
  const q = stockQuery(prompt);
  let last = "pexels_unavailable";
  for (const key of keyList(process.env, "PEXELS_API_KEY")) {
    const id = `px:${key.slice(-6)}`;
    if (!cool.available(id)) continue;
    const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: "15", orientation: platform === "instagram" ? "square" : "landscape" })}`;
    const res = await fetch(url, { headers: { Authorization: key, "User-Agent": UA }, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) {
      last = `pexels_${res?.status ?? 0}`;
      if (res && (isLimitError(last) || res.status === 401)) cool.rest(id);
      continue;
    }
    const j = (await res.json().catch(() => ({}))) as { photos?: { src?: { large2x?: string; large?: string; landscape?: string; square?: string } }[] };
    const photos = (j.photos ?? []).filter((p) => p.src?.large2x || p.src?.large);
    if (!photos.length) {
      last = "pexels_no_results";
      continue;
    }
    const pick = photos[Math.floor(Math.random() * Math.min(5, photos.length))]!;
    const img = await download((platform === "instagram" ? pick.src?.large : pick.src?.large2x) ?? pick.src!.large!);
    return { ...img, model: "pexels-photo" };
  }
  throw new Error(last);
}

async function pixabay(prompt: string, platform: StudioPlatform): Promise<RawImage> {
  const q = stockQuery(prompt);
  let last = "pixabay_unavailable";
  for (const key of keyList(process.env, "PIXABAY_API_KEY")) {
    const id = `pb:${key.slice(-6)}`;
    if (!cool.available(id)) continue;
    const url = `https://pixabay.com/api/?${new URLSearchParams({ key, q, image_type: "photo", orientation: platform === "instagram" ? "all" : "horizontal", safesearch: "true", per_page: "20", order: "popular" })}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) {
      last = `pixabay_${res?.status ?? 0}`;
      if (res && (isLimitError(last) || res.status === 400)) cool.rest(id);
      continue;
    }
    const j = (await res.json().catch(() => ({}))) as { hits?: { largeImageURL?: string; webformatURL?: string }[] };
    const hits = (j.hits ?? []).filter((h) => h.largeImageURL || h.webformatURL);
    if (!hits.length) {
      last = "pixabay_no_results";
      continue;
    }
    const pick = hits[Math.floor(Math.random() * Math.min(5, hits.length))]!;
    const img = await download(pick.largeImageURL ?? pick.webformatURL!);
    return { ...img, model: "pixabay-photo" };
  }
  throw new Error(last);
}

async function openverse(prompt: string): Promise<RawImage> {
  if (!cool.available("openverse")) throw new Error("openverse_cooldown");
  const q = stockQuery(prompt, 4);
  const url = `https://api.openverse.org/v1/images/?${new URLSearchParams({ q, license: "cc0,pdm", page_size: "20", mature: "false", size: "large" })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) {
    if (res && isLimitError(String(res.status))) cool.rest("openverse");
    throw new Error(`openverse_${res?.status ?? 0}`);
  }
  const j = (await res.json().catch(() => ({}))) as { results?: { url?: string; filetype?: string | null }[] };
  const list = (j.results ?? []).filter((r) => r.url && /^https:\/\//.test(r.url) && (!r.filetype || /jpe?g|png|webp/i.test(r.filetype)));
  for (const r of list.slice(0, 4)) {
    try {
      const img = await download(r.url!, 15_000);
      return { ...img, model: "openverse-cc0" };
    } catch {
      /* try the next result */
    }
  }
  throw new Error("openverse_no_results");
}

/* ---------------------------------------------------------------- last resort: branded design */

async function brandArt(prompt: string, platform: StudioPlatform): Promise<RawImage> {
  const { ImageResponse } = await import("next/og");
  const { width, height } = imageSize(platform);
  const [dark, main, light] = paletteFor(prompt);
  const circle = (size: number, x: string, y: string, color: string, opacity: number) =>
    createElement("div", { style: { position: "absolute", width: size, height: size, left: x, top: y, borderRadius: size, background: color, opacity } });
  const root = createElement(
    "div",
    { style: { width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", backgroundImage: `linear-gradient(135deg, ${dark} 0%, ${main} 60%, ${light} 100%)` } },
    circle(Math.round(height * 0.9), "-12%", "-30%", light, 0.25),
    circle(Math.round(height * 0.7), "62%", "40%", dark, 0.35),
    circle(Math.round(height * 0.35), "70%", "-8%", "#ffffff", 0.18),
    circle(Math.round(height * 0.22), "18%", "68%", "#ffffff", 0.12),
    createElement("div", { style: { position: "absolute", left: "8%", right: "8%", bottom: "12%", height: 6, borderRadius: 6, background: "#ffffff", opacity: 0.35 } }),
  );
  const res = new ImageResponse(root, { width, height });
  const buf = Buffer.from(await res.arrayBuffer());
  checkImage(buf, "image/png");
  return { buf, mime: "image/png", model: "brand-art" };
}

/* ---------------------------------------------------------------- runner */

const RUN: Record<Exclude<FreeProvider, "pollinations">, (prompt: string, platform: StudioPlatform) => Promise<RawImage>> = {
  cloudflare: (p) => cloudflare(p),
  huggingface,
  together,
  pexels,
  pixabay,
  openverse: (p) => openverse(p),
  brand: brandArt,
};

export async function storeImage(orgId: string, img: RawImage): Promise<string> {
  const ext = img.mime.includes("jpeg") || img.mime.includes("jpg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
  const path = `${orgId}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage.from("site-assets").upload(path, img.buf, { contentType: img.mime, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`image_store:${error.message}`);
  return admin.storage.from("site-assets").getPublicUrl(path).data.publicUrl;
}

/**
 * Tries the providers in order until one returns a picture; stores it and returns its public URL.
 * `budgetMs` stops before the server timeout (the brand design at the end needs well under a second).
 */
export async function runFreeChain(orgId: string, prompt: string, platform: StudioPlatform, providers: FreeProvider[], budgetMs = 50_000): Promise<{ url: string; model: string; provider: string }> {
  const started = Date.now();
  const errors: string[] = [];
  for (const p of providers) {
    if (p === "pollinations") continue;
    if (p !== "brand" && Date.now() - started > budgetMs) {
      errors.push(`${p}_skipped_budget`);
      continue;
    }
    try {
      const img = await RUN[p](prompt, platform);
      const url = await storeImage(orgId, img);
      return { url, model: img.model, provider: p };
    } catch (e) {
      errors.push((e as Error).message.slice(0, 120));
    }
  }
  throw new Error(`free_chain_failed:${errors.join(" | ").slice(0, 600)}`);
}
