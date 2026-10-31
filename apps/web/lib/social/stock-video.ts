import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { keyList } from "./image-providers-core";
import { pickVideoFile } from "./brain-core";

/**
 * Wave 61 — a real short video for the post, free: Pexels Videos (PEXELS_API_KEY) or Pixabay Videos
 * (PIXABAY_API_KEY) — the same keys the image chain already uses. The clip is copied into the business's
 * own public folder (social-media bucket) so Meta / Telegram always fetch a stable https file.
 * Never throws: { ok: false } when no key / no result.
 */
const UA = "SuperCoderCloud/1.0 (+social studio)";
const MAX_BYTES = 40 * 1024 * 1024;

async function pexelsVideo(query: string, platform: "facebook" | "instagram"): Promise<string | null> {
  for (const key of keyList(process.env, "PEXELS_API_KEY")) {
    const url = `https://api.pexels.com/videos/search?${new URLSearchParams({ query, per_page: "12", orientation: platform === "instagram" ? "portrait" : "landscape", size: "medium" })}`;
    const res = await fetch(url, { headers: { Authorization: key, "User-Agent": UA }, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
    if (!res?.ok) continue;
    const j = (await res.json().catch(() => ({}))) as { videos?: { duration?: number; video_files?: { link: string; width?: number; height?: number; file_type?: string }[] }[] };
    const vids = (j.videos ?? []).filter((v) => (v.duration ?? 0) >= 4 && (v.duration ?? 0) <= 60);
    for (const v of vids.slice(0, 6).sort(() => Math.random() - 0.5)) {
      const link = pickVideoFile(v.video_files ?? [], platform);
      if (link) return link;
    }
  }
  return null;
}

async function pixabayVideo(query: string, platform: "facebook" | "instagram"): Promise<string | null> {
  for (const key of keyList(process.env, "PIXABAY_API_KEY")) {
    const url = `https://pixabay.com/api/videos/?${new URLSearchParams({ key, q: query.slice(0, 90), safesearch: "true", per_page: "12" })}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
    if (!res?.ok) continue;
    const j = (await res.json().catch(() => ({}))) as { hits?: { duration?: number; videos?: Record<string, { url: string; width?: number; height?: number; size?: number }> }[] };
    for (const h of (j.hits ?? []).filter((x) => (x.duration ?? 0) >= 4 && (x.duration ?? 0) <= 60).slice(0, 6)) {
      const files = Object.values(h.videos ?? {}).map((f) => ({ link: f.url, width: f.width, height: f.height, size: f.size, file_type: "video/mp4" }));
      const link = pickVideoFile(files, platform);
      if (link) return link;
    }
  }
  return null;
}

export function stockVideoConfigured(): boolean {
  return keyList(process.env, "PEXELS_API_KEY").length > 0 || keyList(process.env, "PIXABAY_API_KEY").length > 0;
}

/** Finds, downloads and stores a fitting clip. */
export async function stockVideoForPost(orgId: string, query: string, platform: "facebook" | "instagram"): Promise<{ ok: true; url: string; source: string } | { ok: false; error: string }> {
  if (!stockVideoConfigured()) return { ok: false, error: "video_not_configured" };
  const q = query.trim().slice(0, 80) || "business";
  let link: string | null = null;
  let source = "pexels";
  try {
    link = await pexelsVideo(q, platform);
    if (!link) {
      source = "pixabay";
      link = await pixabayVideo(q, platform);
    }
    // a too-specific query: try its first two words
    if (!link && q.split(" ").length > 2) {
      const short = q.split(" ").slice(0, 2).join(" ");
      link = (await pexelsVideo(short, platform)) ?? (await pixabayVideo(short, platform));
    }
  } catch {
    link = null;
  }
  if (!link) return { ok: false, error: "video_not_found" };
  try {
    const res = await fetch(link, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) return { ok: false, error: `video_download_${res.status}` };
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return { ok: false, error: "video_too_big" };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 50_000 || buf.length > MAX_BYTES) return { ok: false, error: "video_bad_size" };
    const admin = createAdminClient();
    const path = `${orgId}/${randomUUID()}.mp4`;
    const { error } = await admin.storage.from("social-media").upload(path, buf, { contentType: "video/mp4", upsert: false, cacheControl: "31536000" });
    if (error) return { ok: false, error: `video_store:${error.message}`.slice(0, 200) };
    return { ok: true, url: admin.storage.from("social-media").getPublicUrl(path).data.publicUrl, source };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}
