/**
 * AI video for posts — the pure parts (unit-tested): which video engines are configured, what a clip costs in credits,
 * the video director (a professional prompt with motion and camera direction, built on the image director), and the
 * readers of each engine's answer. The I/O lives in video-providers.ts.
 *
 * Engines (each optional; the first configured one in VIDEO_PROVIDERS order is used, the next one on failure):
 *   google     Gemini API (paid tier): Gemini Omni Flash through the Interactions API (AI_GEMINI_VIDEO_MODEL,
 *              default "gemini-omni-1.1-flash"); a "veo-…" model id uses the older predictLongRunning endpoint.
 *              Needs AI_GEMINI_VIDEO=on (so a free key is never tried) and a key of a project with billing:
 *              GEMINI_VIDEO_API_KEY when set, otherwise the regular GEMINI_API_KEY pool.
 *   replicate  REPLICATE_API_TOKEN — open models (default "wan-video/wan-2.2-t2v-fast"; LTX-Video etc. by REPLICATE_VIDEO_MODEL)
 *   fal        FAL_KEY — open models through fal's queue (default "fal-ai/ltx-video"; FAL_VIDEO_MODEL)
 *   selfhost   VIDEO_SELFHOST_URL (+ VIDEO_SELFHOST_TOKEN) — your own server (ComfyUI with Wan 2.2 / LTX / Mochi behind
 *              a tiny wrapper): POST {prompt, negative_prompt, aspect_ratio, seconds} → {id} or {video_url};
 *              GET {url}/{id} → {status: "queued"|"running"|"done"|"failed", video_url?, error?}
 */
import { composeImagePrompt, defaultBrief, detectIndustry, mergeBrief, type ImageBrief } from "./image-director-core";

export type VideoProvider = "google" | "replicate" | "fal" | "selfhost";
export type VideoAspect = "9:16" | "16:9" | "1:1";
export const VIDEO_PROVIDERS: VideoProvider[] = ["google", "replicate", "fal", "selfhost"];
export const VIDEO_ASPECTS: VideoAspect[] = ["9:16", "16:9", "1:1"];
export const VIDEO_STYLES = ["auto", "cinematic", "lifestyle", "product", "luxury", "energetic", "calm", "3d"] as const;
export type VideoStyle = (typeof VIDEO_STYLES)[number];

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => (v ?? "").trim();
const on = (v: string | undefined) => /^(1|on|true|yes)$/i.test(clean(v));

/** is this engine usable with the keys present */
export function videoProviderConfigured(p: VideoProvider, env: Env): boolean {
  switch (p) {
    case "google":
      return on(env.AI_GEMINI_VIDEO) && Boolean(clean(env.GEMINI_VIDEO_API_KEY) || clean(env.GEMINI_API_KEY) || clean(env.GEMINI_API_KEYS) || clean(env.GOOGLE_API_KEY));
    case "replicate":
      return clean(env.REPLICATE_API_TOKEN).length >= 20;
    case "fal":
      return clean(env.FAL_KEY).length >= 20;
    case "selfhost":
      return /^https?:\/\//.test(clean(env.VIDEO_SELFHOST_URL));
  }
}

/** the engines to try, in order (VIDEO_PROVIDERS="replicate,google" changes it; unknown names are ignored) */
export function videoChain(env: Env): VideoProvider[] {
  const asked = clean(env.VIDEO_PROVIDERS)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is VideoProvider => (VIDEO_PROVIDERS as string[]).includes(s));
  const order = asked.length ? asked : ["selfhost", "replicate", "fal", "google"] as VideoProvider[];
  return order.filter((p) => videoProviderConfigured(p, env));
}

export function videoModel(p: VideoProvider, env: Env): string {
  switch (p) {
    case "google":
      return clean(env.AI_GEMINI_VIDEO_MODEL) || "gemini-omni-1.1-flash";
    case "replicate":
      return clean(env.REPLICATE_VIDEO_MODEL) || "wan-video/wan-2.2-t2v-fast";
    case "fal":
      return clean(env.FAL_VIDEO_MODEL) || "fal-ai/ltx-video";
    case "selfhost":
      return clean(env.VIDEO_SELFHOST_MODEL) || "selfhost";
  }
}

/** credits for one clip — a symbolic price set by the platform (VIDEO_CREDITS, default 15), never below 1 */
export function videoCredits(env: Env): number {
  const n = Math.round(Number(env.VIDEO_CREDITS));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : 15;
}

/** how long a clip is: Google takes 4-8 s; the open models make ~5 s; 8 by default */
export function clipSeconds(p: VideoProvider, wanted: number | null | undefined): number {
  const w = Number(wanted);
  const s = Number.isFinite(w) && w > 0 ? Math.round(w) : 8;
  if (p === "google") return Math.max(4, Math.min(8, s));
  if (p === "selfhost") return Math.max(2, Math.min(20, s));
  return Math.max(3, Math.min(10, s));
}

/* ------------------------------------------------------------------ the video director */

const CAMERA: Record<Exclude<VideoStyle, "auto">, string> = {
  cinematic: "slow cinematic dolly-in with a gentle parallax, shallow depth of field, anamorphic feel",
  lifestyle: "handheld-feel smooth tracking shot at eye level, natural candid movement",
  product: "slow 180-degree orbit around the product on a turntable, macro detail at the end",
  luxury: "elegant slow glide with soft focus pulls, refined and unhurried",
  energetic: "dynamic push-in with quick but smooth reframes, upbeat pacing",
  calm: "locked-off tripod shot with a very slow push-in, serene pacing",
  "3d": "smooth orbiting 3D camera around a polished stylized scene",
};

export interface VideoDirectInput {
  request: string;
  aspect: VideoAspect;
  seconds: number;
  style?: VideoStyle | null;
  business?: string | null;
  brandColors?: string[];
  brandVoice?: string | null;
}

/** the art director's instructions for the text model (answer: one JSON object, all values in English) */
export const VIDEO_DIRECTOR_SYSTEM = [
  "You are an award-winning commercial director and prompt engineer for state-of-the-art text-to-video models (Gemini Omni / Veo, Wan, LTX, Kling).",
  "Read the post / request (any language) and design ONE short, scroll-stopping video shot that shows exactly what the post is about — the business's real product or service, never a generic stock scene.",
  "One continuous shot, one clear action, realistic physics, natural people. Never text, letters, numbers, prices, logos or signs on screen.",
  'Answer with ONE JSON object only, all values in English: {"subject": "who / what and the main action, 12-35 words", "setting": "where, 5-20 words", "camera": "camera movement and lens", "lighting": "specific lighting", "mood": "2-6 words", "palette": "3-5 color words", "style": "cinematic|lifestyle|product|luxury|energetic|calm|3d", "details": ["3-5 small visual details that make it real"]}',
].join("\n");

export function videoDirectorUser(i: VideoDirectInput): string {
  const ind = detectIndustry(`${i.request} ${i.business ?? ""}`);
  return [
    `Post / request: ${i.request.slice(0, 1500)}`,
    i.business ? `Business: ${i.business.slice(0, 120)}` : "",
    ind ? `Industry: ${ind.key}` : "",
    `Clip: ${i.seconds} seconds, ${i.aspect === "9:16" ? "vertical 9:16 (Reels / Stories / TikTok)" : i.aspect === "1:1" ? "square 1:1 (feed)" : "wide 16:9"}`,
    i.style && i.style !== "auto" ? `Requested style: ${i.style}` : "",
    i.brandVoice ? `Brand voice: ${i.brandVoice.slice(0, 160)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const NEG_VIDEO = "text, letters, captions, subtitles, logos, watermarks, signs, distorted faces, extra fingers, warped hands, morphing objects, flicker, jitter, blurry frames, low resolution, oversaturated colors, cartoonish artifacts";

export interface DirectedVideo {
  prompt: string;
  negative: string;
  subject: string;
  style: Exclude<VideoStyle, "auto">;
}

export function composeVideoPrompt(brief: (ImageBrief & { camera?: string }) | null, input: VideoDirectInput): DirectedVideo {
  const base = defaultBrief({ request: input.request, purpose: "post", business: input.business ?? null });
  const b = mergeBrief(brief, base);
  const ind = detectIndustry(`${input.request} ${input.business ?? ""}`);
  const wanted = input.style && input.style !== "auto" ? input.style : null;
  const fromBrief = (["cinematic", "lifestyle", "product", "luxury", "energetic", "calm", "3d"] as const).find((s) => s === (brief as { style?: string } | null)?.style);
  const style: Exclude<VideoStyle, "auto"> = wanted ?? fromBrief ?? (ind && ["restaurant", "bakery", "travel", "fitness"].includes(ind.key) ? "lifestyle" : ind && ["realestate", "fashion", "law"].includes(ind.key) ? "luxury" : "cinematic");
  // the image director writes the still-frame part (subject, setting, light, palette, quality); the video adds motion
  const still = composeImagePrompt(b, { request: input.request, purpose: "post", platform: input.aspect === "1:1" ? "instagram" : null, business: input.business ?? null, brandColors: input.brandColors, brandVoice: input.brandVoice ?? null }).prompt
    .replace(/^[^:]{3,60}:\s*/, "")
    .replace(/Strictly no text[\s\S]*$/, "")
    .replace(/;?\s*(?:wide horizontal|square|vertical) \d+:\d+ frame\./, ".")
    // a still-photo camera line would fight the motion direction below
    .replace(/Camera: .*?\.\s+(?=Lighting:)/, "")
    .replace(/Scroll-stopping social media image/i, "Scroll-stopping social media video")
    .replace(/\bphotography\b/gi, "footage")
    .replace(/\s+/g, " ")
    .trim();
  const camera = (b.camera && b.camera.length > 6 ? b.camera : CAMERA[style]).replace(/\.$/, "");
  const frame = input.aspect === "9:16" ? "vertical 9:16 frame, subject centered for Reels and Stories" : input.aspect === "1:1" ? "square 1:1 frame" : "wide 16:9 frame";
  const prompt = [
    `Video: ${still}`,
    `Motion: one continuous ${input.seconds}-second shot, ${camera}; natural, physically realistic movement; the action starts in the first second.`,
    `${frame}, smooth 24-30 fps, professional color grading, commercial quality, no cuts.`,
    `No on-screen text, captions, logos or watermarks.`,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 1900);
  return { prompt, negative: NEG_VIDEO, subject: b.subject, style };
}

/* ------------------------------------------------------------------ reading each engine's answer */

export type VideoPoll = { state: "running" } | { state: "done"; url: string; needsKey?: boolean } | { state: "failed"; error: string };

const firstUrl = (v: unknown): string | null => {
  if (typeof v === "string") return /^https:\/\//.test(v) ? v : null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = firstUrl(x);
      if (u) return u;
    }
    return null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["video_url", "url", "uri", "video", "output", "mp4"]) {
      const u = firstUrl(o[k]);
      if (u) return u;
    }
  }
  return null;
};

/** Replicate prediction: {status, output, error} */
export function readReplicate(j: unknown): VideoPoll {
  const o = (j ?? {}) as { status?: string; output?: unknown; error?: unknown };
  if (o.status === "succeeded") {
    const url = firstUrl(o.output);
    return url ? { state: "done", url } : { state: "failed", error: "replicate_no_output" };
  }
  if (o.status === "failed" || o.status === "canceled") return { state: "failed", error: `replicate_${o.status}:${String(o.error ?? "").slice(0, 160)}` };
  return { state: "running" };
}

/** fal queue status: {status: IN_QUEUE|IN_PROGRESS|COMPLETED} and the result: {video: {url}} */
export function readFalStatus(j: unknown): "running" | "completed" | "failed" {
  const s = String((j as { status?: string } | null)?.status ?? "").toUpperCase();
  if (s === "COMPLETED" || s === "OK") return "completed";
  if (s === "FAILED" || s === "ERROR" || s === "CANCELLED") return "failed";
  return "running";
}
export function readFalResult(j: unknown): VideoPoll {
  const url = firstUrl((j as { video?: unknown } | null)?.video) ?? firstUrl(j);
  return url ? { state: "done", url } : { state: "failed", error: "fal_no_output" };
}

/** Veo (predictLongRunning) operation: {done, response.generateVideoResponse.generatedSamples[0].video.uri, error} */
export function readVeoOperation(j: unknown): VideoPoll {
  const o = (j ?? {}) as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } } };
  if (o.error) return { state: "failed", error: `veo:${String(o.error.message ?? "").slice(0, 160)}` };
  if (!o.done) return { state: "running" };
  const uri = o.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (uri && /^https:\/\//.test(uri)) return { state: "done", url: uri, needsKey: true };
  const why = o.response?.generateVideoResponse?.raiMediaFilteredReasons?.[0];
  return { state: "failed", error: why ? `veo_filtered:${why.slice(0, 120)}` : "veo_no_output" };
}

/**
 * Interactions API (Gemini Omni Flash): {id, status: in_progress|completed|failed, steps[].content[]: {type, uri | data, mime_type}}
 * (the older "outputs" array is read too). Inline base64 comes back as `data` — the caller stores the bytes.
 */
export function readInteraction(j: unknown): VideoPoll | { state: "inline"; data: string; mime: string } {
  const o = (j ?? {}) as { status?: string; error?: { message?: string }; steps?: { content?: unknown[] }[]; outputs?: unknown[]; output_video?: { data?: string; uri?: string } };
  if (o.error) return { state: "failed", error: `omni:${String(o.error.message ?? "").slice(0, 160)}` };
  const status = String(o.status ?? "").toLowerCase();
  if (status === "failed" || status === "cancelled" || status === "canceled") return { state: "failed", error: `omni_${status}` };
  const parts: unknown[] = [...(o.steps ?? []).flatMap((s) => s.content ?? []), ...(o.outputs ?? []), ...(o.output_video ? [o.output_video] : [])];
  for (const p of parts) {
    const x = (p ?? {}) as { type?: string; uri?: string; data?: string; mime_type?: string; mimeType?: string };
    if (x.type && x.type !== "video") continue;
    if (typeof x.uri === "string" && /^https:\/\//.test(x.uri)) return { state: "done", url: x.uri, needsKey: /googleapis\.com/.test(x.uri) };
    if (typeof x.data === "string" && x.data.length > 1000) return { state: "inline", data: x.data, mime: x.mime_type ?? x.mimeType ?? "video/mp4" };
  }
  if (status === "completed") return { state: "failed", error: "omni_no_video" };
  return { state: "running" };
}

/** self-hosted wrapper: {status, video_url, error} */
export function readSelfhost(j: unknown): VideoPoll {
  const o = (j ?? {}) as { status?: string; video_url?: string; url?: string; error?: string };
  const url = firstUrl(o.video_url ?? o.url);
  if (url) return { state: "done", url };
  const s = String(o.status ?? "").toLowerCase();
  if (s === "failed" || s === "error") return { state: "failed", error: `selfhost:${String(o.error ?? "").slice(0, 160)}` };
  return { state: "running" };
}

/** Replicate's input for the common open video models (unknown fields are ignored by the model) */
export function replicateInput(model: string, prompt: string, negative: string, aspect: VideoAspect, seconds: number): Record<string, unknown> {
  const m = model.toLowerCase();
  if (m.includes("ltx")) return { prompt, negative_prompt: negative, aspect_ratio: aspect, length: Math.round(seconds * 24) + 1 };
  if (m.includes("wan")) return { prompt, negative_prompt: negative, aspect_ratio: aspect === "1:1" ? "16:9" : aspect, num_frames: Math.min(121, Math.max(81, Math.round(seconds * 16) + 1)), resolution: "720p" };
  return { prompt, negative_prompt: negative, aspect_ratio: aspect, duration: seconds };
}

export function falInput(model: string, prompt: string, negative: string, aspect: VideoAspect, seconds: number): Record<string, unknown> {
  return { prompt, negative_prompt: negative, aspect_ratio: aspect, duration: String(Math.max(5, Math.min(10, seconds))), num_frames: Math.round(seconds * 24) + 1, resolution: "720p", enable_safety_checker: true, ...(model.includes("ltx") ? { num_inference_steps: 40 } : {}) };
}

/** a friendly reason for the screen (the raw provider text stays in the job row) */
export function videoErrorKey(error: string | null | undefined): string {
  const e = (error ?? "").toLowerCase();
  if (/plan_limit|credits/.test(e)) return "social.video.err.credits";
  if (/not_configured|no_provider/.test(e)) return "social.video.err.notConfigured";
  if (/filtered|safety|nsfw|policy|rai/.test(e)) return "social.video.err.safety";
  if (/429|rate|quota|busy|overload|503/.test(e)) return "social.video.err.busy";
  if (/timeout|too_long/.test(e)) return "social.video.err.timeout";
  return "social.video.err.failed";
}
