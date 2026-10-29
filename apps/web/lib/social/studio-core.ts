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

/* ---------------------------------------------------------------- stage B — text → image bridge & full post (additive) */

/** Visual styles the person can pick for a generated image. "auto" keeps the original stage-A prompt. */
export const STUDIO_STYLES = ["auto", "photo", "cinematic", "illustration", "3d", "minimal", "flatlay"] as const;
export type StudioStyle = (typeof STUDIO_STYLES)[number];

/** Post goals for the full-post generator — each steers the angle and the call to action. */
export const STUDIO_GOALS = ["engage", "sell", "inform", "brand", "event"] as const;
export type StudioGoal = (typeof STUDIO_GOALS)[number];

const STYLE_DIRECTION: Record<Exclude<StudioStyle, "auto">, string> = {
  photo: "Editorial commercial photography, shot on a full-frame camera with a 50mm lens, shallow depth of field, soft natural window light, true-to-life colors, crisp focus on the subject",
  cinematic: "Cinematic still, dramatic directional lighting, rich contrast, subtle film grain, anamorphic depth, color graded teal and warm highlights",
  illustration: "Modern premium vector-style illustration, clean shapes, harmonious limited palette, soft gradients, friendly and polished, editorial magazine quality",
  "3d": "High-end 3D render, soft studio lighting, smooth materials, gentle global illumination, playful yet premium, octane-like quality",
  minimal: "Minimalist composition, generous negative space, one clear subject, soft pastel background, calm and elegant, premium brand aesthetic",
  flatlay: "Top-down flat lay, neatly arranged objects on a textured surface, soft even daylight, styled like a premium lifestyle brand shoot",
};

/** Human-readable art direction for a style (empty for "auto"). */
export function styleDirection(style: StudioStyle | null | undefined): string {
  if (!style || style === "auto") return "";
  return STYLE_DIRECTION[style] ?? "";
}

/**
 * Advanced image prompt built from a concrete visual scene (already in English).
 * Same safety rule as stage A: never text, prices or logos inside the picture.
 */
export function buildSceneImagePrompt(input: { scene: string; platform: StudioPlatform; style?: StudioStyle | null; brandVoice?: string | null; business?: string | null }): string {
  const scene = input.scene.replace(/\s+/g, " ").trim().slice(0, 500);
  const shape = input.platform === "instagram" ? "square 1:1 composition, subject centered with breathing room for a feed crop" : "landscape 1.91:1 composition, subject on the rule-of-thirds, works as a Facebook link/feed image";
  const brand = input.brandVoice?.replace(/\s+/g, " ").trim().slice(0, 200);
  const biz = input.business?.replace(/\s+/g, " ").trim().slice(0, 100);
  const dir = styleDirection(input.style) || "Professional, high quality, natural light, scroll-stopping, magazine-grade aesthetic";
  return [
    `Social media visual for ${biz ? `the business "${biz}"` : "a small business"}: ${scene}.`,
    `${dir}.`,
    `${shape}.`,
    "Strong focal point, clean uncluttered background, balanced colors, high detail, sharp, no distortions.",
    brand ? `Visual mood: ${brand}.` : "",
    NO_TEXT,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Turns a finished post into a short seed for the image box: drops hashtags, links, mentions, emojis
 * and the call-to-action tail, keeps the first meaningful sentences (bounded to 400 chars, the topic limit).
 */
export function postToSceneSeed(text: string): string {
  const cleaned = (text ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\p{L}\p{N}_]+/gu, " ")
    .replace(/[\p{Extended_Pictographic}‍️]/gu, " ")
    .replace(/[➡️➜→⬅️👉👈]/gu, " ");
  const lines = cleaned
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => (l.match(WORD) ?? []).length >= 2);
  const out = (lines.slice(0, 2).join(". ") || cleaned.replace(/\s+/g, " ").trim()).slice(0, 400).trim();
  return out;
}

export interface FullPostParts {
  post: string;
  scene: string | null;
  headline: string | null;
  firstComment: string | null;
  alt: string | null;
}

const clip = (v: unknown, n: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, n);
  return s || null;
};

/**
 * Parses the full-post AI answer. Expected JSON: {"post","scene","headline","firstComment","alt"}.
 * Tolerates code fences and prose around the JSON. When no JSON is found the whole answer is the post.
 */
export function parseFullPost(raw: string, maxLen = 5000): FullPostParts | null {
  const txt = (raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!txt) return null;
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(txt.slice(start, end + 1)) as Record<string, unknown>;
      const post = clip(j.post ?? j.text ?? j.caption, maxLen);
      if (post) {
        return {
          post: post.replace(/\\n/g, "\n"),
          scene: clip(j.scene ?? j.image ?? j.imagePrompt, 500),
          headline: clip(j.headline, 120),
          firstComment: clip(j.firstComment ?? j.first_comment, 600),
          alt: clip(j.alt ?? j.altText, 300),
        };
      }
    } catch {
      /* fall through to plain text */
    }
  }
  const post = txt.replace(/^["“«]+|["”»]+$/g, "").trim().slice(0, maxLen);
  return post ? { post, scene: null, headline: null, firstComment: null, alt: null } : null;
}

/** Writing rules per goal, used in the full-post system prompt. */
export function goalDirection(goal: StudioGoal | null | undefined): string {
  switch (goal) {
    case "sell":
      return "Goal: drive a sale or inquiry. Lead with the customer's desire or pain, show the benefit (not features), and end with a direct call to action (message us / order / book).";
    case "inform":
      return "Goal: teach something useful. Open with a surprising fact or question, give 2-3 crisp practical points, end by inviting saves/shares.";
    case "brand":
      return "Goal: build brand love. Tell a short human story or behind-the-scenes moment, warm and authentic, end with an invitation to follow.";
    case "event":
      return "Goal: announce something. Make it clear what, for whom and why it matters; if date/place are not given, do NOT invent them — invite people to message for details.";
    default:
      return "Goal: maximum engagement. Open with a scroll-stopping hook, make it relatable, and end with a question or a light call to comment.";
  }
}

/** Rough quality checklist for a finished post (pure, shown to the user as hints). */
export function postChecklist(text: string, platform: StudioPlatform, hasImage: boolean): { hook: boolean; cta: boolean; hashtags: boolean; length: boolean; image: boolean } {
  const t = (text ?? "").trim();
  const first = t.split(/\n/)[0] ?? "";
  const tags = (t.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const len = t.length;
  return {
    hook: first.length > 0 && first.length <= 140,
    cta: /[?？]|הודעה|כתבו|שלחו|התקשרו|הזמינו|לחצו|הגיבו|שתפו|תגובות|קישור|message|comment|book|call|order|share|dm|link|راسلونا|اتصلوا|احجزوا|شاركوا/i.test(t),
    hashtags: platform === "instagram" ? tags >= 3 && tags <= 30 : tags >= 1 && tags <= 5,
    length: platform === "instagram" ? len >= 80 && len <= 2200 : len >= 60 && len <= 1500,
    image: hasImage || platform === "facebook",
  };
}
