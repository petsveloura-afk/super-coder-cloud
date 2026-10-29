/**
 * Wave 45 / stage A — post studio, pure logic (no I/O, safe to unit-test).
 * Credits rule: ONE variation per generation by default; "more options" asks for the extra ones.
 */
export const STUDIO_DEFAULT_VARIATIONS = 1;
/** "More options" adds this many extra variations (so the person sees 3 in total). */
export const STUDIO_MORE_EXTRA = 2;
export const STUDIO_MAX_VARIATIONS = 3;

export type StudioPlatform = "facebook" | "instagram";
export type StudioTone = "friendly" | "professional" | "playful" | "premium";

/** How many variations a request produces: 1 by default, +2 only when `more` is true. */
export function variationCount(more: boolean): number {
  return more ? Math.min(STUDIO_MAX_VARIATIONS, STUDIO_DEFAULT_VARIATIONS + STUDIO_MORE_EXTRA) : STUDIO_DEFAULT_VARIATIONS;
}

/** How many NEW items to generate when the person already has `existing` on screen and clicks "more options". */
export function extraVariations(existing: number): number {
  const have = Math.max(0, Math.floor(existing));
  return Math.max(0, Math.min(STUDIO_MORE_EXTRA, STUDIO_MAX_VARIATIONS - have));
}

const NO_TEXT = "No text, no letters, no logos, no watermark.";

/**
 * Image prompt for a post. The image model must never put invented prices/dates into a picture,
 * so the prompt asks for a text-free image and only carries the topic (never numbers from the post).
 */
export function buildImagePrompt(input: { topic: string; platform: StudioPlatform; brandVoice?: string | null; business?: string | null }): string {
  const topic = input.topic.replace(/\s+/g, " ").trim().slice(0, 400);
  const shape = input.platform === "instagram" ? "square 1:1 composition" : "landscape 1.91:1 composition";
  const brand = input.brandVoice?.replace(/\s+/g, " ").trim().slice(0, 200);
  const biz = input.business?.replace(/\s+/g, " ").trim().slice(0, 100);
  return [
    `Social media photo for ${biz ? `the business "${biz}"` : "a small business"}: ${topic}.`,
    `Professional, high quality, natural light, ${shape}.`,
    brand ? `Visual mood: ${brand}.` : "",
    NO_TEXT,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Splits an AI answer holding several alternative posts separated by a line with `===`. */
export function splitVariants(raw: string, max = STUDIO_MORE_EXTRA, maxLen = 5000): string[] {
  return raw
    .split(/^\s*={3,}\s*$/m)
    .map((s) => s.trim().replace(/^["“«]+|["”»]+$/g, "").trim())
    .filter((s) => s.length > 0)
    .map((s) => s.slice(0, maxLen))
    .slice(0, Math.max(0, max));
}

export interface AssetInput {
  url: string;
  title?: string | null;
  prompt?: string | null;
  tags?: string[];
}

/** https-only, bounded; returns a clean row or null when the input is not acceptable. */
export function normalizeAsset(input: AssetInput): { url: string; title: string | null; prompt: string | null; tags: string[] } | null {
  const url = (input.url ?? "").trim();
  if (!/^https:\/\//.test(url) || url.length > 1000) return null;
  const clean = (v: string | null | undefined, n: number) => {
    const s = (v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
    return s || null;
  };
  const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 10);
  return { url, title: clean(input.title, 200), prompt: clean(input.prompt, 1800), tags };
}

/* ---------------------------------------------------------------- fallback image provider (stage A fix) */

/** True when an image error means the provider quota / billing is exhausted (HTTP 429). */
export function isQuotaError(message: string | null | undefined): boolean {
  return /image_429|RESOURCE_EXHAUSTED|quota/i.test(message ?? "");
}

export function imageSize(platform: StudioPlatform): { width: number; height: number } {
  return platform === "instagram" ? { width: 1024, height: 1024 } : { width: 1200, height: 630 };
}

/**
 * URL of the keyless fallback generator (Pollinations "prompt" endpoint). `base` is overridable
 * with STUDIO_IMAGE_FALLBACK_URL so the business can point at another compatible service.
 */
export function buildFallbackUrl(prompt: string, platform: StudioPlatform, seed: number, base = "https://image.pollinations.ai/prompt"): string {
  const { width, height } = imageSize(platform);
  const q = new URLSearchParams({ width: String(width), height: String(height), nologo: "true", model: "flux", seed: String(Math.abs(Math.floor(seed)) % 1_000_000) });
  return `${base.replace(/\/$/, "")}/${encodeURIComponent(prompt.slice(0, 900))}?${q.toString()}`;
}

/** After a quota error, skip the primary provider for this long (ms) instead of burning ~6 calls per click. */
export const PRIMARY_COOLDOWN_MS = 10 * 60_000;
export function primaryAvailable(coolUntil: number, now: number): boolean {
  return now >= coolUntil;
}

/* ---------------------------------------------------------------- topic translation for image prompts */

/** True when the topic contains Hebrew or Arabic letters (image models handle those poorly). */
export function needsEnglishTopic(topic: string): boolean {
  return /[\u0590-\u05FF\u0600-\u06FF]/.test(topic);
}

/** Cleans a translation answer: one line, no quotes, bounded; falls back to the original topic when empty. */
export function cleanTranslation(raw: string | null | undefined, fallback: string): string {
  const t = (raw ?? "").replace(/\s+/g, " ").replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, "").trim().slice(0, 300);
  return t.length >= 2 ? t : fallback;
}

/* ---------------------------------------------------------------- text options (post copy) */

const WORD = /[\p{L}\p{N}]+/gu;
const words = (s: string) => (s.match(WORD) ?? []).length;
const norm = (s: string) => (s.match(WORD) ?? []).join(" ").toLowerCase();

/** The brief sent as the user message: the topic is a subject to write ABOUT, never text to repeat. */
export function buildTextBrief(input: { topic: string; tone: StudioTone; platform: StudioPlatform; langName: string }): string {
  const topic = input.topic.replace(/\s+/g, " ").trim().slice(0, 400);
  return [
    `Subject of the post: ${topic}`,
    `Platform: ${input.platform === "instagram" ? "Instagram" : "Facebook"}`,
    `Tone: ${input.tone}`,
    `Language: ${input.langName}`,
    "Write complete, ready-to-publish posts about this subject. Do not just repeat the subject.",
  ].join("\n");
}

/**
 * Keeps only real posts: long enough (min 6 words), not an echo of the topic or of the text already on screen,
 * no duplicates. An empty result means the model failed, so the caller reports an error instead of showing junk.
 */
export function validateVariants(variants: string[], topic: string, current?: string | null): string[] {
  const t = norm(topic);
  const c = norm(current ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of variants) {
    const n = norm(v);
    if (words(v) < 6) continue;
    if (n === t || n === c) continue;
    if (t && n.startsWith(t) && words(v) - words(topic) < 5) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(v);
  }
  return out;
}
