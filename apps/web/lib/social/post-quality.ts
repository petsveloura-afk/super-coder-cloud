/**
 * Post copy — the pure parts (unit-tested): a quality score with concrete tips (what big schedulers show next to the
 * editor), a safe "tidy up" that never changes the words, and the professional rewrite frameworks for the AI.
 */
export type QualityPlatform = "facebook" | "instagram";
export type QualityCheck = "hook" | "length" | "lines" | "cta" | "hashtags" | "emojis" | "question" | "noCaps" | "noLinksIg" | "value";

export interface PostQuality {
  score: number;
  grade: "great" | "good" | "weak";
  checks: { key: QualityCheck; ok: boolean }[];
  /** the checks that failed, most important first — i18n keys social.quality.tip.<key> */
  tips: QualityCheck[];
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const CTA =
  /(שלח(?:ו)?\s*(?:לנו\s*)?הודעה|כתב(?:ו)?\s*לנו|התקשר(?:ו)?|צלצל(?:ו)?|הזמינ(?:ו)?|קבע(?:ו)?\s*תור|לחצ(?:ו)?|היכנס(?:ו)?|הירשמ(?:ו)?|הגיב(?:ו)?|תגיב(?:ו)?|שתפ(?:ו)?|תייג(?:ו)?|בוא(?:ו)?|קישור\s*ב|לפרטים|להזמנות|דבר(?:ו)?\s*איתנו|וואטסאפ|whatsapp|book|call|order|shop|dm\b|message us|comment|share|tag|click|link in bio|sign up|visit|contact|اتصل|احجز|راسلنا|اطلب|شارك|علّق)/iu;
const VALUE = /(\d+%|\d+\s*(?:₪|ש"ח|שקל|\$|€)|טיפ|סוד|איך|למה|מדריך|חדש|מבצע|הנחה|רק\s*ה|בלעדי|חינם|מתנה|tip|how|why|new|free|guide|secret|offer|save|نصيحة|جديد|مجاني|عرض)/iu;

const lines = (t: string) => t.split(/\n/).map((l) => l.trim());

export function postQuality(text: string, platform: QualityPlatform = "facebook"): PostQuality {
  const t = String(text ?? "").trim();
  const ls = lines(t).filter(Boolean);
  const first = ls[0] ?? "";
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const tags = t.match(HASHTAG) ?? [];
  const emojis = t.match(EMOJI) ?? [];
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  const caps = (t.match(/[A-Z]/g) ?? []).length;
  const len = t.length;
  const checks: { key: QualityCheck; ok: boolean; w: number }[] = [
    // a short first line that makes you stop: a question, a number, a promise, an emoji or a strong opening
    { key: "hook", ok: first.length > 0 && words(first) <= 14 && (/[?!]|\d|\p{Extended_Pictographic}/u.test(first) || words(first) <= 9), w: 22 },
    { key: "length", ok: platform === "instagram" ? len >= 80 && len <= 1500 : len >= 60 && len <= 900, w: 14 },
    { key: "lines", ok: ls.length >= 3 && ls.every((l) => l.length <= 220), w: 12 },
    { key: "cta", ok: CTA.test(t), w: 18 },
    { key: "hashtags", ok: platform === "instagram" ? tags.length >= 3 && tags.length <= 15 : tags.length <= 4, w: 8 },
    { key: "emojis", ok: emojis.length >= 1 && emojis.length <= 6, w: 6 },
    { key: "question", ok: /\?/.test(t), w: 6 },
    { key: "noCaps", ok: latin < 20 || caps / latin < 0.5, w: 4 },
    { key: "noLinksIg", ok: platform !== "instagram" || !/https?:\/\//i.test(t), w: 4 },
    { key: "value", ok: VALUE.test(t), w: 6 },
  ];
  const total = checks.reduce((s, c) => s + c.w, 0);
  const score = len < 10 ? 0 : Math.round((checks.reduce((s, c) => s + (c.ok ? c.w : 0), 0) / total) * 100);
  const tips = checks
    .filter((c) => !c.ok)
    .sort((a, b) => b.w - a.w)
    .map((c) => c.key);
  return { score, grade: score >= 80 ? "great" : score >= 55 ? "good" : "weak", checks: checks.map(({ key, ok }) => ({ key, ok })), tips };
}

/**
 * Tidy-up without touching the words: trailing spaces, more than one empty line, spaces before punctuation,
 * duplicate hashtags, hashtags scattered in the last lines gathered into one line at the end.
 */
export function polishPostCopy(text: string): string {
  let t = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])(?=\s|$)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const ls = t.split("\n");
  // trailing lines that are only hashtags → one line
  const tail: string[] = [];
  while (ls.length && /^(#[\p{L}\p{N}_]+\s*)+$/u.test(ls[ls.length - 1]!.trim())) tail.unshift(ls.pop()!.trim());
  while (ls.length && ls[ls.length - 1]!.trim() === "") ls.pop();
  if (tail.length) {
    const seen = new Set<string>();
    const tags = tail
      .join(" ")
      .split(/\s+/)
      .filter((x) => {
        const k = x.toLowerCase();
        if (!x || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    t = `${ls.join("\n")}${ls.length ? "\n\n" : ""}${tags.join(" ")}`;
  } else t = ls.join("\n");
  return t.trim();
}

/** professional rewrite frameworks (the AI rewrites the person's post with one of them, keeping every fact) */
export const COPY_FRAMEWORKS = ["hook", "aida", "pas", "story", "short", "list"] as const;
export type CopyFramework = (typeof COPY_FRAMEWORKS)[number];

export function frameworkDirection(f: CopyFramework): string {
  switch (f) {
    case "aida":
      return "Rewrite with AIDA: Attention (a bold first line) → Interest (one surprising, relevant point) → Desire (the concrete benefit for the reader) → Action (one clear call to action).";
    case "pas":
      return "Rewrite with PAS: name the reader's Problem in their own words → Agitate it briefly and honestly → present the business's Solution and one clear call to action.";
    case "story":
      return "Rewrite as a short, human micro-story (3-5 short lines: a moment, a turn, the result) that ends with a soft call to action. Real and warm, never invented facts.";
    case "short":
      return "Rewrite much shorter and punchier: max 3 short lines + a call to action. Every word must earn its place.";
    case "list":
      return "Rewrite as a scannable list post: a hook line, then 3-5 short items each starting with a fitting emoji, then a call to action.";
    default:
      return "Rewrite with a much stronger first line (a scroll-stopping hook: a question, a bold promise or a surprising fact, max 12 words), short mobile-friendly lines and one clear call to action.";
  }
}

export const COPY_RULES = [
  "You are a senior social media copywriter for top brands. Native-level, natural, modern language — never robotic, never generic filler, never clichés like 'we are happy to announce'.",
  "Keep EVERY fact from the original (names, prices, dates, phone numbers, addresses, offers) exactly as written. NEVER invent prices, discounts, dates or facts that are not in the original or in the business information.",
  "Write in the SAME language as the original post. Short lines, one idea per line, an empty line between blocks, 2-4 fitting emojis at most.",
  "Hashtags on the last line only (Instagram 5-10 relevant, Facebook 1-3).",
  "Answer with the post text ONLY — no quotes, no titles, no explanations.",
].join("\n");
