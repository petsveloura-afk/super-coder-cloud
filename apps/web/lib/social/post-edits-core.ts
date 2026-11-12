/**
 * Post editor — quick edits (pure). Two kinds:
 *   • AI edits that keep every fact (longer, warmer, more professional, add a call to action, fix spelling, translate,
 *     more / fewer emojis, fit the platform). The direction text is what the copywriter model is told.
 *   • Free local edits that never call the AI (remove emojis / hashtags / links, character and "see more" stats).
 * Additive: the existing rewrite frameworks (post-quality.ts) are untouched.
 */

export const POST_EDITS = ["longer", "warmer", "professional", "cta", "grammar", "emojis_more", "emojis_less", "platform_fit", "translate_he", "translate_en", "translate_ar"] as const;
export type PostEdit = (typeof POST_EDITS)[number];

export function isPostEdit(v: unknown): v is PostEdit {
  return typeof v === "string" && (POST_EDITS as readonly string[]).includes(v);
}

export function editDirection(e: PostEdit, platform: "facebook" | "instagram"): string {
  switch (e) {
    case "longer":
      return "Expand the post by about 40-70%: add one concrete benefit, one vivid detail or a short example that fits the business — using ONLY facts from the post or the business information. Keep the same hook, language and call to action.";
    case "warmer":
      return "Make the post warmer and more personal: speak directly to the reader (you), add empathy and a human touch. Same facts, same language, same length (±20%).";
    case "professional":
      return "Make the post sound more professional and trustworthy: precise words, confident tone, no slang, at most 2 emojis. Same facts, same language, same length (±20%).";
    case "cta":
      return "Keep the post exactly as it is and improve ONLY the ending: one clear, specific call to action (what to do now and how — message us / call / book / click the link), using contact details only if they appear in the post or the business information.";
    case "grammar":
      return "Fix ONLY spelling, grammar, punctuation and spacing. Do not change the wording, the order, the emojis or the hashtags beyond what a correction needs.";
    case "emojis_more":
      return "Keep the text and add 3-5 fitting emojis at natural places (line starts or ends). Do not change any words.";
    case "emojis_less":
      return "Keep the text and leave at most ONE emoji (the most meaningful one). Do not change any words.";
    case "platform_fit":
      return platform === "instagram"
        ? "Fit the post to Instagram: a hook in the first 125 characters, short lines with empty lines between blocks, a call to action that works without clickable links ('link in bio' / 'send us a message'), 5-10 relevant hashtags on the last line. Max 2200 characters. Same facts and language."
        : "Fit the post to Facebook: a hook in the first 125 characters (before 'see more'), short scannable lines, one clear call to action, 1-3 hashtags at most. Same facts and language.";
    case "translate_he":
      return "Translate the post into natural, native Hebrew (not a literal translation) for an Israeli audience. Keep every fact, the structure, the emojis and the call to action; hashtags may be translated when natural.";
    case "translate_en":
      return "Translate the post into natural, native English (not a literal translation). Keep every fact, the structure, the emojis and the call to action; hashtags may be translated when natural.";
    case "translate_ar":
      return "Translate the post into natural, native Arabic (not a literal translation). Keep every fact, the structure, the emojis and the call to action; hashtags may be translated when natural.";
  }
}

/** an edit that changes the language must not be held to the "same language" rule */
export function changesLanguage(e: PostEdit): boolean {
  return e.startsWith("translate_");
}

// ------------------------------------------------------------------ free, local edits

const EMOJI = /(\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*|[\u{1F1E6}-\u{1F1FF}]{2})[ \t]?/gu;

export function stripEmojis(text: string): string {
  return tidySpaces(String(text ?? "").replace(EMOJI, ""));
}

export function stripHashtags(text: string): string {
  return tidySpaces(String(text ?? "").replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1"));
}

export function stripLinks(text: string): string {
  return tidySpaces(String(text ?? "").replace(/https?:\/\/\S+/g, ""));
}

function tidySpaces(t: string): string {
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const PLATFORM_LIMIT: Record<"facebook" | "instagram", number> = { facebook: 63206, instagram: 2200 };
/** both networks cut the caption around here and show "… see more" */
export const SEE_MORE_AT = 125;

export interface PostStats {
  chars: number;
  words: number;
  lines: number;
  emojis: number;
  hashtags: number;
  links: number;
  readSeconds: number;
  /** what the reader sees before "see more" */
  preview: string;
  cut: boolean;
  /** per selected platform: characters left (negative = too long) */
  left: { platform: "facebook" | "instagram"; left: number }[];
}

export function postStats(text: string, platforms: ("facebook" | "instagram")[]): PostStats {
  const t = String(text ?? "");
  const chars = [...t].length;
  const words = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const firstBlock = t.trim().split("\n").filter((l) => l.trim()).slice(0, 2).join(" ");
  const flat = [...firstBlock];
  return {
    chars,
    words,
    lines: t.trim() ? t.trim().split("\n").length : 0,
    emojis: (t.match(EMOJI) ?? []).length,
    hashtags: (t.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length,
    links: (t.match(/https?:\/\/\S+/g) ?? []).length,
    readSeconds: Math.max(words ? 2 : 0, Math.round((words / 200) * 60)),
    preview: flat.length > SEE_MORE_AT ? `${flat.slice(0, SEE_MORE_AT).join("").trimEnd()}…` : firstBlock,
    cut: [...t.trim()].length > SEE_MORE_AT || t.trim().split("\n").filter((l) => l.trim()).length > 2,
    left: platforms.map((p) => ({ platform: p, left: PLATFORM_LIMIT[p] - chars })),
  };
}

/** the session's version history: newest first, no duplicates in a row, at most `max` */
export function pushVersion(list: string[], text: string, max = 12): string[] {
  const v = String(text ?? "");
  if (!v.trim() || list[0] === v) return list;
  return [v, ...list.filter((x) => x !== v)].slice(0, max);
}
