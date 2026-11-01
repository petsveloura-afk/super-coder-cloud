/**
 * The social brain — deeper understanding (pure, unit-tested; additive to brain-core.ts).
 *
 *   • deeperLearning  — which opening hooks, weekdays, emoji use, hashtag counts and calls to action actually work
 *                       for THIS business (from its own measured posts)
 *   • customerSignals — what customers keep asking in the inbox lately → posts that answer real questions
 *   • dayContext      — the day / season the post goes out on (start of week, weekend, summer…) in the business's language
 *   • postQuality     — a self-check of every draft (hook, call to action, hashtags, length, readability); a weak draft
 *                       is rewritten once with concrete feedback before it is saved
 */
import { zonedParts, type LearnInput } from "./brain-core";

export type HookStyle = "question" | "number" | "emoji" | "story" | "statement";

const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_G = /\p{Extended_Pictographic}/gu;

export function firstLine(text: string): string {
  return (text.split("\n").find((l) => l.trim()) ?? "").trim();
}

/** how the post opens */
export function hookStyle(text: string): HookStyle {
  const l = firstLine(text);
  if (!l) return "statement";
  if (/[?？؟]/.test(l)) return "question";
  if (EMOJI.test(l.slice(0, 3))) return "emoji";
  if (/^\D{0,12}\d/.test(l)) return "number";
  if (/^(i |we |my |our |אני|אנחנו|לפני|כש|השבוע|היום|أنا|نحن|اليوم|قبل)/i.test(l)) return "story";
  return "statement";
}

const CTA = /(שלחו|שלח|התקשרו|הזמינו|הזמן|לחצו|כתבו|צרו קשר|קבעו|הירשמו|בואו|היכנסו|לפרטים|בקישור|בפרטי|link|book|call|order|message|dm|contact|sign up|visit|shop|reserve|اتصل|احجز|اطلب|راسلنا|سجّل|زوروا|تواصل)/i;

export function hasCta(text: string): boolean {
  return CTA.test(text);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface DeepLearned {
  hookScores: Record<string, number>;
  bestDays: number[];
  emojiWorks: boolean | null;
  ctaWorks: boolean | null;
  hashtagSweetSpot: number | null;
}

/** what the numbers teach beyond topics and hours (needs at least 4 measured posts) */
export function deeperLearning(posts: LearnInput[], tz = "Asia/Jerusalem"): DeepLearned {
  const m = posts.filter((p) => Number.isFinite(p.engagement));
  const out: DeepLearned = { hookScores: {}, bestDays: [], emojiWorks: null, ctaWorks: null, hashtagSweetSpot: null };
  if (m.length < 4) return out;
  const group = (key: (p: LearnInput) => string) => {
    const g = new Map<string, number[]>();
    for (const p of m) g.set(key(p), [...(g.get(key(p)) ?? []), p.engagement]);
    return g;
  };
  for (const [k, v] of group((p) => hookStyle(p.body))) out.hookScores[k] = round1(avg(v));
  const days = group((p) => String(zonedParts(new Date(p.scheduled_at), tz).dow));
  out.bestDays = [...days.entries()].sort((a, b) => avg(b[1]) - avg(a[1])).slice(0, 2).map(([d]) => Number(d));
  const split = (test: (p: LearnInput) => boolean): boolean | null => {
    const yes = m.filter(test).map((p) => p.engagement);
    const no = m.filter((p) => !test(p)).map((p) => p.engagement);
    return yes.length >= 2 && no.length >= 2 ? avg(yes) > avg(no) : null;
  };
  out.emojiWorks = split((p) => (p.body.match(EMOJI_G) ?? []).length >= 2);
  out.ctaWorks = split((p) => hasCta(p.body));
  const tags = group((p) => {
    const n = (p.body.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
    return n === 0 ? "0" : n <= 3 ? "1-3" : n <= 7 ? "4-7" : "8+";
  });
  const bestTags = [...tags.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => avg(b[1]) - avg(a[1]))[0];
  out.hashtagSweetSpot = bestTags ? ({ "0": 0, "1-3": 3, "4-7": 6, "8+": 9 } as Record<string, number>)[bestTags[0]] ?? null : null;
  return out;
}

const HOOK_WORDS: Record<HookStyle, string> = {
  question: "a question to the audience",
  number: "a number / statistic",
  emoji: "an emoji + short punchy line",
  story: "a short personal story",
  statement: "a bold statement",
};

export function deeperBrief(d: DeepLearned | null | undefined, dayNames?: string[]): string {
  if (!d) return "";
  const lines: string[] = [];
  const hooks = Object.entries(d.hookScores).sort((a, b) => b[1] - a[1]);
  if (hooks.length >= 2) lines.push(`- Openings that work best here: ${HOOK_WORDS[hooks[0]![0] as HookStyle]}; weakest: ${HOOK_WORDS[hooks[hooks.length - 1]![0] as HookStyle]}.`);
  if (d.bestDays.length && dayNames) lines.push(`- The audience is most active on ${d.bestDays.map((x) => dayNames[x] ?? "").filter(Boolean).join(" and ")}.`);
  if (d.emojiWorks !== null) lines.push(d.emojiWorks ? "- A few emojis help engagement here (2-4, never more)." : "- Emojis did not help here — use at most one.");
  if (d.ctaWorks !== null) lines.push(d.ctaWorks ? "- Posts with a direct call to action perform better — always end with one." : "- Soft, value-first posts beat hard selling here — keep the call to action gentle.");
  if (d.hashtagSweetSpot !== null) lines.push(`- Best hashtag count here: about ${d.hashtagSweetSpot}.`);
  return lines.length ? `Deeper patterns of this audience:\n${lines.join("\n")}` : "";
}

/* ------------------------------------------------------------------ what customers ask */

const STOPWORDS = new Set(
  "the and for with you your are this that have what when how can will from just היי שלום תודה אני אתה את אתם של על עם זה זאת הוא היא יש אין לי לך גם כל מה איך מתי אפשר רוצה רציתי לדעת בבקשה אבל או אם כן לא שלכם שלך אצלכם ממש עוד היום مرحبا شكرا انا انت هل من على في مع هذا هذه ما كيف متى ممكن اريد".split(" "),
);

export interface CustomerSignals {
  questions: string[];
  topics: string[];
  count: number;
}

/** the questions and words customers repeat in recent inbound messages (no names / numbers / links kept) */
export function customerSignals(messages: string[], max = 5): CustomerSignals {
  const clean = messages
    .map((m) => m.replace(/https?:\/\/\S+/g, " ").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ").replace(/\+?\d[\d\s-]{5,}/g, " ").replace(/\s+/g, " ").trim())
    .filter((m) => m.length >= 6 && m.length <= 400);
  // similar questions (same words, different punctuation / case) count together; the first wording is kept
  const qs = new Map<string, { text: string; n: number }>();
  for (const m of clean) {
    for (const part of m.split(/(?<=[?？؟])/)) {
      const q = part.trim();
      if (!/[?？؟]$/.test(q) || q.length < 8 || q.length > 160) continue;
      const key = q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 50);
      const cur = qs.get(key);
      qs.set(key, { text: cur?.text ?? q, n: (cur?.n ?? 0) + 1 });
    }
  }
  const words = new Map<string, number>();
  for (const m of clean) {
    const seen = new Set<string>();
    for (const w of m.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []) {
      if (STOPWORDS.has(w) || seen.has(w)) continue;
      seen.add(w);
      words.set(w, (words.get(w) ?? 0) + 1);
    }
  }
  const questions = [...qs.values()].sort((a, b) => b.n - a.n).map((q) => q.text).slice(0, max);
  const topics = [...words.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 8);
  return { questions, topics, count: clean.length };
}

export function customerBrief(s: CustomerSignals | null | undefined): string {
  if (!s || s.count < 3 || (!s.questions.length && !s.topics.length)) return "";
  const lines = [`What customers asked about in the last weeks (${s.count} messages) — a post that answers one of these is valuable:`];
  if (s.questions.length) lines.push(...s.questions.map((q) => `  • "${q}"`));
  if (s.topics.length) lines.push(`  Frequent words: ${s.topics.join(", ")}`);
  lines.push("Never quote a customer by name or reveal private details — turn the question into general advice.");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ the day the post goes out */

export function dayContext(date: string, locale: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const dow = d.getUTCDay();
  const month = d.getUTCMonth() + 1;
  const season = month >= 6 && month <= 9 ? "summer" : month >= 12 || month <= 2 ? "winter" : month <= 5 ? "spring" : "autumn";
  const name = d.toLocaleDateString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "long", timeZone: "UTC" });
  const israel = locale !== "en";
  const angle =
    israel && dow === 0
      ? "start of the work week — planning, motivation, getting things done"
      : israel && (dow === 4 || dow === 5)
        ? "weekend is coming — plans, treats, family time, last call before the weekend"
        : israel && dow === 6
          ? "Saturday — relaxed, inspiring, light content"
          : !israel && dow === 1
            ? "start of the week — planning and motivation"
            : !israel && (dow === 5 || dow === 6)
              ? "weekend — plans, treats, relaxed tone"
              : "mid-week — practical value, tips, behind the scenes";
  return `The post goes out on ${name} (${season}). Fitting angle: ${angle}. Mention the day or season only when it is natural.`;
}

/* ------------------------------------------------------------------ self-check of a draft */

export interface PostQuality {
  score: number;
  fixes: string[];
}

export function postQuality(text: string, platform: "facebook" | "instagram"): PostQuality {
  const fixes: string[] = [];
  let score = 100;
  const t = text.trim();
  const first = firstLine(t);
  const lines = t.split("\n").filter((l) => l.trim());
  const tags = (t.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const emojis = (t.match(EMOJI_G) ?? []).length;
  if (first.length > 110) {
    score -= 20;
    fixes.push("The first line is too long — make the opening hook max ~12 words so it shows before 'see more'.");
  }
  if (!hasCta(t)) {
    score -= 20;
    fixes.push("Add one clear call to action near the end (what exactly to do: send a message, book, call, visit).");
  }
  if (platform === "instagram" && tags < 3) {
    score -= 10;
    fixes.push("Add 5-8 relevant hashtags on the last line.");
  }
  if (platform === "facebook" && tags > 5) {
    score -= 10;
    fixes.push("Facebook: keep 1-3 hashtags only.");
  }
  if (t.length < 80) {
    score -= 15;
    fixes.push("Too thin — add one concrete piece of value (a tip, a detail, a benefit).");
  }
  if (t.length > (platform === "instagram" ? 1600 : 1400)) {
    score -= 10;
    fixes.push("Too long — cut to the strongest 4-6 short lines.");
  }
  if (lines.length <= 1 && t.length > 160) {
    score -= 10;
    fixes.push("Break the text into short lines (one idea per line) so it is easy to read on a phone.");
  }
  if (emojis > 8) {
    score -= 10;
    fixes.push("Too many emojis — keep 2-4.");
  }
  if (/[A-Z]{12,}/.test(t)) {
    score -= 5;
    fixes.push("Avoid long ALL-CAPS text.");
  }
  return { score: Math.max(0, score), fixes };
}

export function qualityFeedback(q: PostQuality): string {
  return q.fixes.length ? `Rewrite the post and fix exactly these points (keep the idea and the facts):\n${q.fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")}` : "";
}
