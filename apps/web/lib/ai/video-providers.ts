import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { geminiKeys } from "./providers";
import { falInput, readFalResult, readFalStatus, readInteraction, readReplicate, readSelfhost, readVeoOperation, replicateInput, videoModel, type VideoAspect, type VideoPoll, type VideoProvider } from "./video-core";

/**
 * AI video — talking to the engines (start a job, check it, download the finished clip into the business's own media
 * folder). Every engine is asynchronous: start() returns a reference that is stored on the job row, poll() is called
 * again later (by the screen every few seconds and by the social clock every 5 minutes).
 * The rules (which engine, prompts, reading answers) are in video-core.ts.
 */
export type VideoRef = Record<string, string>;
export type VideoStart = { ref: VideoRef } | { done: string; needsKey?: boolean };

const MEDIA_BUCKET = "social-media";
const env = process.env;
const T = (ms: number) => AbortSignal.timeout(ms);

function googleKey(): string {
  const own = (env.GEMINI_VIDEO_API_KEY ?? "").trim();
  if (own) return own;
  const pool = geminiKeys(env);
  if (!pool.length) throw new Error("video_not_configured:google");
  return pool[0]!;
}
const googleBase = () => (env.AI_GEMINI_VIDEO_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");

async function json(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}_${res.status}:${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_bad_json`);
  }
}

/* ------------------------------------------------------------------ start */

export async function startVideo(p: VideoProvider, input: { prompt: string; negative: string; aspect: VideoAspect; seconds: number }): Promise<VideoStart> {
  const model = videoModel(p, env);
  if (p === "google") {
    const key = googleKey();
    if (/^veo-/i.test(model)) {
      const res = await fetch(`${googleBase()}/models/${encodeURIComponent(model)}:predictLongRunning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          instances: [{ prompt: input.prompt }],
          parameters: { aspectRatio: input.aspect === "1:1" ? "16:9" : input.aspect, negativePrompt: input.negative, durationSeconds: input.seconds, resolution: "720p" },
        }),
        signal: T(30_000),
      });
      const j = (await json(res, "veo")) as { name?: string };
      if (!j.name) throw new Error("veo_no_operation");
      return { ref: { kind: "veo", op: j.name } };
    }
    const res = await fetch(`${googleBase()}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key, "Api-Revision": env.AI_GEMINI_VIDEO_REVISION || "2026-05-20" },
      body: JSON.stringify({
        model,
        input: `${input.prompt}\nAvoid: ${input.negative}.`,
        response_format: { type: "video", aspect_ratio: input.aspect === "1:1" ? "16:9" : input.aspect, resolution: "720p", delivery: "uri" },
        background: true,
        store: true,
      }),
      signal: T(30_000),
    });
    const j = await json(res, "omni");
    const now = readInteraction(j);
    if (now.state === "done") return { done: now.url, needsKey: now.needsKey };
    if (now.state === "failed") throw new Error(now.error);
    if (now.state === "inline") return { done: `data:${now.mime};base64,${now.data}` };
    const id = (j as { id?: string; name?: string }).id ?? (j as { name?: string }).name;
    if (!id) throw new Error("omni_no_id");
    return { ref: { kind: "omni", id: String(id) } };
  }
  if (p === "replicate") {
    const token = (env.REPLICATE_API_TOKEN ?? "").trim();
    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: replicateInput(model, input.prompt, input.negative, input.aspect, input.seconds) }),
      signal: T(30_000),
    });
    const j = (await json(res, "replicate")) as { id?: string; urls?: { get?: string } };
    const now = readReplicate(j);
    if (now.state === "done") return { done: now.url };
    if (now.state === "failed") throw new Error(now.error);
    if (!j.id) throw new Error("replicate_no_id");
    return { ref: { kind: "replicate", id: j.id, get: j.urls?.get ?? `https://api.replicate.com/v1/predictions/${j.id}` } };
  }
  if (p === "fal") {
    const res = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${(env.FAL_KEY ?? "").trim()}` },
      body: JSON.stringify(falInput(model, input.prompt, input.negative, input.aspect, input.seconds)),
      signal: T(30_000),
    });
    const j = (await json(res, "fal")) as { request_id?: string; status_url?: string; response_url?: string };
    if (!j.request_id) throw new Error("fal_no_id");
    return { ref: { kind: "fal", id: j.request_id, status: j.status_url ?? `https://queue.fal.run/${model}/requests/${j.request_id}/status`, result: j.response_url ?? `https://queue.fal.run/${model}/requests/${j.request_id}` } };
  }
  // selfhost
  const base = (env.VIDEO_SELFHOST_URL ?? "").replace(/\/$/, "");
  const tok = (env.VIDEO_SELFHOST_TOKEN ?? "").trim();
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify({ prompt: input.prompt, negative_prompt: input.negative, aspect_ratio: input.aspect, seconds: input.seconds, model }),
    signal: T(30_000),
  });
  const j = (await json(res, "selfhost")) as { id?: string };
  const now = readSelfhost(j);
  if (now.state === "done") return { done: now.url };
  if (now.state === "failed") throw new Error(now.error);
  if (!j.id) throw new Error("selfhost_no_id");
  return { ref: { kind: "selfhost", id: String(j.id) } };
}

/* ------------------------------------------------------------------ check */

export async function pollVideo(ref: VideoRef): Promise<VideoPoll | { state: "inline"; data: string; mime: string }> {
  switch (ref.kind) {
    case "veo": {
      const res = await fetch(`${googleBase()}/${ref.op}`, { headers: { "x-goog-api-key": googleKey() }, signal: T(20_000), cache: "no-store" });
      return readVeoOperation(await json(res, "veo_poll"));
    }
    case "omni": {
      const res = await fetch(`${googleBase()}/interactions/${encodeURIComponent(ref.id!)}`, {
        headers: { "x-goog-api-key": googleKey(), "Api-Revision": env.AI_GEMINI_VIDEO_REVISION || "2026-05-20" },
        signal: T(20_000),
        cache: "no-store",
      });
      return readInteraction(await json(res, "omni_poll"));
    }
    case "replicate": {
      const res = await fetch(ref.get!, { headers: { Authorization: `Bearer ${(env.REPLICATE_API_TOKEN ?? "").trim()}` }, signal: T(20_000), cache: "no-store" });
      return readReplicate(await json(res, "replicate_poll"));
    }
    case "fal": {
      const auth = { Authorization: `Key ${(env.FAL_KEY ?? "").trim()}` };
      const s = await fetch(ref.status!, { headers: auth, signal: T(20_000), cache: "no-store" });
      const st = readFalStatus(await json(s, "fal_poll"));
      if (st === "running") return { state: "running" };
      if (st === "failed") return { state: "failed", error: "fal_failed" };
      const r = await fetch(ref.result!, { headers: auth, signal: T(20_000), cache: "no-store" });
      return readFalResult(await json(r, "fal_result"));
    }
    case "selfhost": {
      const base = (env.VIDEO_SELFHOST_URL ?? "").replace(/\/$/, "");
      const tok = (env.VIDEO_SELFHOST_TOKEN ?? "").trim();
      const res = await fetch(`${base}/${encodeURIComponent(ref.id!)}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : undefined, signal: T(20_000), cache: "no-store" });
      return readSelfhost(await json(res, "selfhost_poll"));
    }
    default:
      return { state: "failed", error: "unknown_ref" };
  }
}

/* ------------------------------------------------------------------ store the finished clip */

async function ensureBucket() {
  const admin = createAdminClient();
  const { data } = await admin.storage.getBucket(MEDIA_BUCKET);
  if (!data) {
    await admin.storage
      .createBucket(MEDIA_BUCKET, { public: true, fileSizeLimit: 52428800, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"] })
      .catch(() => undefined);
  }
  return admin;
}

/**
 * Downloads the finished clip (engine links expire within hours; Google's need the key) and stores it in
 * social-media/<org>/ai-video/<uuid>.mp4 — a stable public link for the post and for Meta's publisher.
 */
export async function storeVideo(orgId: string, source: string, needsKey = false): Promise<string> {
  let buf: Buffer;
  let mime = "video/mp4";
  if (source.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(source);
    if (!m) throw new Error("video_bad_inline");
    mime = m[1]!;
    buf = Buffer.from(m[2]!, "base64");
  } else {
    if (!/^https:\/\//.test(source)) throw new Error("video_bad_url");
    const res = await fetch(source, { headers: needsKey ? { "x-goog-api-key": googleKey() } : undefined, redirect: "follow", signal: T(90_000), cache: "no-store" });
    if (!res.ok) throw new Error(`video_download_${res.status}`);
    const ct = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (ct && ct.startsWith("video/")) mime = ct;
    buf = Buffer.from(await res.arrayBuffer());
  }
  if (buf.length < 10_000) throw new Error("video_too_small");
  if (buf.length > 50 * 1024 * 1024) throw new Error("video_too_large");
  const ext = mime.includes("webm") ? "webm" : mime.includes("quicktime") ? "mov" : "mp4";
  const admin = await ensureBucket();
  const path = `${orgId}/ai-video/${randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, buf, { contentType: mime, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`video_store:${error.message}`);
  return admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}
