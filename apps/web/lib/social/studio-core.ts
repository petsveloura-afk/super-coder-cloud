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
