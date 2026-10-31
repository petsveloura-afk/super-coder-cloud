/**
 * Wave 61 — the social brain (pure, unit-tested).
 *
 * Everything the daily autopilot decides without touching the network: when the next post is due (in the
 * business's own time zone), which content pillar comes next, what the engagement numbers teach (best hours,
 * best pillars, best media), which holidays are coming, how to avoid repeating itself, and how to merge the
 * business's hashtag bank. The server code (brain.ts) only fetches, asks the AI and stores.
 */

export type AutopilotMedia = "image" | "video" | "mix" | "none";
export type AutopilotMode = "draft" | "auto";

export interface AutopilotSettings {
  enabled: boolean;
  mode: AutopilotMode;
  post_time: string;
  days: number[];
  platforms: ("facebook" | "instagram")[];
  media: AutopilotMedia;
  style: string;
  tone: string;
  pillars: string[];
  hashtags: string[];
  avoid: string | null;
  cta_type: string | null;
  cta_value: string | null;
  holidays: boolean;
  reviews_to_posts: boolean;
  telegram_chat: string | null;
  last_planned_for: string | null;
  last_error?: string | null;
}

export const AUTOPILOT_DEFAULTS: AutopilotSettings = {
  enabled: false,
  mode: "draft",
  post_time: "10:00",
  days: [0, 1, 2, 3, 4, 5],
  platforms: ["facebook", "instagram"],
  media: "image",
  style: "auto",
  tone: "friendly",
  pillars: [],
  hashtags: [],
  avoid: null,
  cta_type: null,
  cta_value: null,
  holidays: true,
  reviews_to_posts: true,
  telegram_chat: null,
  last_planned_for: null,
};

/** Content pillars a business gets when it did not write its own (rotated so the feed never feels repetitive). */
export const DEFAULT_PILLARS: Record<"he" | "en" | "ar", string[]> = {
  he: ["טיפ מקצועי", "מאחורי הקלעים", "סיפור לקוח", "מבצע / הצעה", "שאלה לקהל", "מיתוס מול עובדה", "שאלות נפוצות", "השראה וערכים"],
  en: ["Pro tip", "Behind the scenes", "Customer story", "Offer", "Question for the audience", "Myth vs fact", "FAQ", "Inspiration & values"],
  ar: ["نصيحة مهنية", "خلف الكواليس", "قصة عميل", "عرض خاص", "سؤال للجمهور", "خرافة مقابل حقيقة", "أسئلة شائعة", "إلهام وقيم"],
};

export function pillarsFor(locale: string, own: string[] | null | undefined): string[] {
  const clean = (own ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 12);
  if (clean.length) return clean;
  return DEFAULT_PILLARS[locale === "en" || locale === "ar" ? locale : "he"];
}

/** Normalizes the settings form (anything invalid falls back to the default — never throws). */
export function normalizeAutopilot(input: Partial<Record<keyof AutopilotSettings, unknown>>): AutopilotSettings {
  const s = { ...AUTOPILOT_DEFAULTS };
  s.enabled = input.enabled === true;
  s.mode = input.mode === "auto" ? "auto" : "draft";
  s.post_time = typeof input.post_time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.post_time) ? input.post_time : AUTOPILOT_DEFAULTS.post_time;
  const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  s.days = days.length ? days : AUTOPILOT_DEFAULTS.days;
  const plats = Array.isArray(input.platforms) ? input.platforms.filter((p): p is "facebook" | "instagram" => p === "facebook" || p === "instagram") : [];
  s.platforms = plats.length ? [...new Set(plats)] : ["facebook"];
  s.media = input.media === "video" || input.media === "mix" || input.media === "none" ? input.media : "image";
  s.style = ["auto", "photo", "cinematic", "illustration", "3d", "minimal", "flatlay"].includes(String(input.style)) ? String(input.style) : "auto";
  s.tone = ["friendly", "professional", "playful", "premium"].includes(String(input.tone)) ? String(input.tone) : "friendly";
  s.pillars = splitList(input.pillars, 12, 80);
  // hashtags are typed space-separated ("#tips #offers") or one per line
  const tagSrc = Array.isArray(input.hashtags) ? input.hashtags.map(String).join(" ") : typeof input.hashtags === "string" ? input.hashtags : "";
  s.hashtags = [...new Set(tagSrc.split(/[\s,،]+/).map((h) => h.trim().replace(/^#+/, "")).filter(Boolean).map((h) => `#${h.slice(0, 59)}`))].slice(0, 30);
  s.avoid = typeof input.avoid === "string" && input.avoid.trim() ? input.avoid.trim().slice(0, 500) : null;
  s.cta_type = ["message", "whatsapp", "call", "book", "learn_more", "shop", "sign_up", "order"].includes(String(input.cta_type)) ? String(input.cta_type) : null;
  s.cta_value = s.cta_type && typeof input.cta_value === "string" && input.cta_value.trim() ? input.cta_value.trim().slice(0, 500) : null;
  s.holidays = input.holidays !== false;
  s.reviews_to_posts = input.reviews_to_posts !== false;
  const tg = typeof input.telegram_chat === "string" ? input.telegram_chat.trim() : "";
  s.telegram_chat = /^(@[A-Za-z0-9_]{4,64}|-100\d{6,20})$/.test(tg) ? tg : null;
  s.last_planned_for = typeof input.last_planned_for === "string" ? input.last_planned_for : null;
  return s;
}

function splitList(v: unknown, max: number, len: number): string[] {
  const arr = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[\n,،]+/) : [];
  return [...new Set(arr.map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, len)))].slice(0, max);
}

/* ------------------------------------------------------------------ time (in the business's time zone) */

/** The wall-clock parts of `d` in `tz` (Intl, no library). */
export function zonedParts(d: Date, tz: string): { y: number; m: number; day: number; hh: number; mm: number; dow: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: Number(parts.year), m: Number(parts.month), day: Number(parts.day), hh: Number(parts.hour) % 24, mm: Number(parts.minute), dow: dows.indexOf(String(parts.weekday)) };
}

/** The UTC instant of wall-clock `date` + `time` in `tz`. */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // two passes cover DST edges
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(t), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.day, p.hh, p.mm);
    t += guess - asUtc;
  }
  return new Date(t);
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The next posting slot that should be prepared now: the first allowed day whose slot is at least
 * `leadMin` minutes away and at most `horizonH` hours away, and that was not planned yet.
 * Returns null when nothing is due (the cron simply tries again in 5 minutes).
 */
export function nextSlot(input: { now: Date; tz: string; postTime: string; days: number[]; lastPlannedFor: string | null; leadMin?: number; horizonH?: number }): { date: string; at: Date } | null {
  const lead = (input.leadMin ?? 20) * 60_000;
  const horizon = (input.horizonH ?? 30) * 3_600_000;
  const today = zonedParts(input.now, input.tz);
  for (let i = 0; i < 3; i++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.day + i, 12));
    const date = iso(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
    if (!input.days.includes(base.getUTCDay())) continue;
    if (input.lastPlannedFor && input.lastPlannedFor >= date) continue;
    const at = zonedInstant(date, input.postTime, input.tz);
    const diff = at.getTime() - input.now.getTime();
    if (diff < lead) continue;
    if (diff > horizon) return null;
    return { date, at };
  }
  return null;
}

/** Image / video for the day (mix alternates by date so it is stable across retries). */
export function mediaForDate(media: AutopilotMedia, date: string): "image" | "video" | "none" {
  if (media === "mix") return Number(date.slice(-2)) % 2 === 0 ? "video" : "image";
  return media;
}

/* ------------------------------------------------------------------ learning */

export interface PostMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reach?: number;
  views?: number;
}

/** One number per post: reactions + 2×comments + 3×shares + 2×saves (+ a little reach/views). */
export function engagementScore(m: PostMetrics | null | undefined): number {
  if (!m) return 0;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return Math.round(n(m.likes) + 2 * n(m.comments) + 3 * n(m.shares) + 2 * n(m.saves) + n(m.reach) / 100 + n(m.views) / 200);
}

/** Merges the metrics of each platform of one post. */
export function sumMetrics(list: (PostMetrics | null | undefined)[]): PostMetrics {
  const out: Required<PostMetrics> = { likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, views: 0 };
  for (const m of list) {
    if (!m) continue;
    for (const k of Object.keys(out) as (keyof PostMetrics)[]) {
      const v = m[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] += v;
    }
  }
  return out;
}

export interface LearnInput {
  body: string;
  scheduled_at: string;
  pillar: string | null;
  media: "image" | "video" | "text";
  engagement: number;
}

export interface Learned {
  posts: number;
  avg: number;
  bestHours: number[];
  pillarScores: Record<string, number>;
  mediaScores: Record<string, number>;
  top: { text: string; score: number }[];
  weak: { text: string; score: number }[];
  bestLength: "short" | "medium" | "long" | null;
  questionsWork: boolean | null;
}

const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** What the business's own numbers teach (needs at least 3 measured posts to say anything). */
export function learnFromPosts(posts: LearnInput[], tz = "Asia/Jerusalem"): Learned {
  const measured = posts.filter((p) => Number.isFinite(p.engagement));
  const out: Learned = { posts: measured.length, avg: 0, bestHours: [], pillarScores: {}, mediaScores: {}, top: [], weak: [], bestLength: null, questionsWork: null };
  if (measured.length < 3) return out;
  out.avg = Math.round(avgOf(measured.map((p) => p.engagement)) * 10) / 10;
  const group = <K extends string>(key: (p: LearnInput) => K | null) => {
    const m = new Map<K, number[]>();
    for (const p of measured) {
      const k = key(p);
      if (k === null) continue;
      m.set(k, [...(m.get(k) ?? []), p.engagement]);
    }
    return m;
  };
  const hours = group((p) => String(zonedParts(new Date(p.scheduled_at), tz).hh));
  out.bestHours = [...hours.entries()]
    .filter(([, v]) => v.length >= 1)
    .sort((a, b) => avgOf(b[1]) - avgOf(a[1]))
    .slice(0, 3)
    .map(([h]) => Number(h));
  for (const [k, v] of group((p) => (p.pillar ? p.pillar : null))) out.pillarScores[k] = Math.round(avgOf(v) * 10) / 10;
  for (const [k, v] of group((p) => p.media)) out.mediaScores[k] = Math.round(avgOf(v) * 10) / 10;
  const sorted = [...measured].sort((a, b) => b.engagement - a.engagement);
  out.top = sorted.slice(0, 3).map((p) => ({ text: p.body.slice(0, 220), score: p.engagement }));
  out.weak = sorted.slice(-2).reverse().filter((p) => p.engagement < out.avg).map((p) => ({ text: p.body.slice(0, 160), score: p.engagement }));
  const len = group((p) => (p.body.length < 220 ? "short" : p.body.length < 600 ? "medium" : "long"));
  const bestLen = [...len.entries()].sort((a, b) => avgOf(b[1]) - avgOf(a[1]))[0];
  out.bestLength = bestLen ? bestLen[0] : null;
  const q = group((p) => (/[?？؟]/.test(p.body) ? "q" : "n"));
  if (q.get("q")?.length && q.get("n")?.length) out.questionsWork = avgOf(q.get("q")!) > avgOf(q.get("n")!);
  return out;
}

/** The learning, as instructions for the writer (empty until there is enough data). */
export function brainBrief(l: Learned | null | undefined): string {
  if (!l || l.posts < 3) return "";
  const lines = [`What we learned from ${l.posts} published posts of this business (average engagement ${l.avg}):`];
  const pillars = Object.entries(l.pillarScores).sort((a, b) => b[1] - a[1]);
  if (pillars.length >= 2) lines.push(`- Best performing topics: ${pillars.slice(0, 3).map(([k]) => k).join(", ")}. Weakest: ${pillars[pillars.length - 1]![0]}.`);
  const media = Object.entries(l.mediaScores).sort((a, b) => b[1] - a[1]);
  if (media.length >= 2) lines.push(`- ${media[0]![0]} posts get the most engagement.`);
  if (l.bestLength) lines.push(`- ${l.bestLength} posts work best here — keep that length.`);
  if (l.questionsWork !== null) lines.push(l.questionsWork ? "- Posts that ask the audience a question get more engagement — end with a question when it fits." : "- Questions did not help here — prefer a clear statement and call to action.");
  if (l.top.length) lines.push(`- Posts the audience loved (learn the style, never copy):\n${l.top.map((t) => `  • ${t.text.replace(/\n+/g, " ")}`).join("\n")}`);
  return lines.join("\n");
}

/** Next pillar: never the same as the last one; prefers pillars that perform, but keeps rotating. */
export function pickPillar(pillars: string[], recent: (string | null)[], scores: Record<string, number> = {}, seed = 0): string {
  if (!pillars.length) return "";
  const last = recent.find((r) => r) ?? null;
  const recentSet = recent.slice(0, Math.max(1, pillars.length - 1)).filter(Boolean);
  const fresh = pillars.filter((p) => !recentSet.includes(p));
  const pool = (fresh.length ? fresh : pillars.filter((p) => p !== last)).length ? (fresh.length ? fresh : pillars.filter((p) => p !== last)) : pillars;
  const ranked = [...pool].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  // top half by score, picked by seed so two businesses with the same pillars do not post identically
  const top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
  return top[Math.abs(seed) % top.length]!;
}

/* ------------------------------------------------------------------ never repeat yourself */

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !/^(the|and|for|with|you|את|של|על|עם|זה|הוא|היא|לכם|שלכם|כל|גם|من|على|في|مع)$/.test(w)));

/** Word overlap (Jaccard) between two posts, 0..1. */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function isRepeat(text: string, recent: string[], threshold = 0.45): boolean {
  return recent.some((r) => similarity(text, r) >= threshold);
}

/* ------------------------------------------------------------------ hashtags */

/** Adds up to `max` hashtags from the bank that the post does not already have (on its own last line). */
export function mergeHashtags(text: string, bank: string[], platform: "facebook" | "instagram", max?: number): string {
  const limit = max ?? (platform === "instagram" ? 8 : 3);
  const have = new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.toLowerCase()));
  if (have.size >= limit) return text;
  const add = bank.filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h) && !have.has(h.toLowerCase())).slice(0, limit - have.size);
  if (!add.length) return text;
  const lines = text.trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (/^(\s*#[\p{L}\p{N}_]+\s*)+$/u.test(last)) lines[lines.length - 1] = `${last.trim()} ${add.join(" ")}`;
  else lines.push("", add.join(" "));
  return lines.join("\n");
}

/** Removes words the business asked never to use (whole-word, case-insensitive) — a last safety net. */
export function containsAvoided(text: string, avoid: string | null | undefined): string[] {
  const list = (avoid ?? "").split(/[\n,،]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
  return list.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
}

/* ------------------------------------------------------------------ holidays and seasons */

export interface Holiday {
  date: string;
  key: string;
  he: string;
  en: string;
  ar: string;
}

/** Israeli / Jewish holidays (first day) + a few global retail moments, 2026-2028. */
export const HOLIDAYS: Holiday[] = [
  { date: "2026-11-27", key: "black_friday", he: "בלאק פריידי", en: "Black Friday", ar: "الجمعة السوداء" },
  { date: "2026-12-05", key: "hanukkah", he: "חנוכה", en: "Hanukkah", ar: "عيد الأنوار (حانوكا)" },
  { date: "2026-12-25", key: "christmas", he: "חג המולד", en: "Christmas", ar: "عيد الميلاد" },
  { date: "2027-01-01", key: "new_year", he: "השנה האזרחית החדשה", en: "New Year", ar: "رأس السنة الميلادية" },
  { date: "2027-01-23", key: "tu_bishvat", he: "ט״ו בשבט", en: "Tu BiShvat", ar: "عيد الشجرة" },
  { date: "2027-02-14", key: "valentine", he: "ולנטיין", en: "Valentine's Day", ar: "عيد الحب" },
  { date: "2027-03-10", key: "eid_fitr", he: "עיד אל-פיטר", en: "Eid al-Fitr", ar: "عيد الفطر" },
  { date: "2027-03-23", key: "purim", he: "פורים", en: "Purim", ar: "عيد المساخر (بوريم)" },
  { date: "2027-04-22", key: "pesach", he: "פסח", en: "Passover", ar: "عيد الفصح اليهودي" },
  { date: "2027-05-12", key: "independence", he: "יום העצמאות", en: "Israel Independence Day", ar: "يوم الاستقلال" },
  { date: "2027-05-16", key: "eid_adha", he: "עיד אל-אדחא", en: "Eid al-Adha", ar: "عيد الأضحى" },
  { date: "2027-05-25", key: "lag_baomer", he: "ל״ג בעומר", en: "Lag BaOmer", ar: "لاغ بعومر" },
  { date: "2027-06-11", key: "shavuot", he: "שבועות", en: "Shavuot", ar: "عيد الأسابيع" },
  { date: "2027-10-02", key: "rosh_hashana", he: "ראש השנה", en: "Rosh Hashanah", ar: "رأس السنة العبرية" },
  { date: "2027-10-11", key: "yom_kippur", he: "יום כיפור", en: "Yom Kippur", ar: "يوم الغفران" },
  { date: "2027-10-16", key: "sukkot", he: "סוכות", en: "Sukkot", ar: "عيد العرش" },
  { date: "2027-11-26", key: "black_friday", he: "בלאק פריידי", en: "Black Friday", ar: "الجمعة السوداء" },
  { date: "2027-12-25", key: "hanukkah", he: "חנוכה", en: "Hanukkah", ar: "عيد الأنوار (حانوكا)" },
  { date: "2028-01-01", key: "new_year", he: "השנה האזרחית החדשה", en: "New Year", ar: "رأس السنة الميلادية" },
  { date: "2028-02-12", key: "tu_bishvat", he: "ט״ו בשבט", en: "Tu BiShvat", ar: "عيد الشجرة" },
  { date: "2028-03-12", key: "purim", he: "פורים", en: "Purim", ar: "عيد المساخر (بوريم)" },
  { date: "2028-04-11", key: "pesach", he: "פסח", en: "Passover", ar: "عيد الفصح اليهودي" },
  { date: "2028-05-31", key: "shavuot", he: "שבועות", en: "Shavuot", ar: "عيد الأسابيع" },
  { date: "2028-09-21", key: "rosh_hashana", he: "ראש השנה", en: "Rosh Hashanah", ar: "رأس السنة العبرية" },
  { date: "2028-11-24", key: "black_friday", he: "בלאק פריידי", en: "Black Friday", ar: "الجمعة السوداء" },
  { date: "2028-12-13", key: "hanukkah", he: "חנוכה", en: "Hanukkah", ar: "عيد الأنوار (حانوكا)" },
];

/** Holidays within the next `days` days of `date` (YYYY-MM-DD), nearest first. */
export function upcomingHolidays(date: string, days = 7, list: Holiday[] = HOLIDAYS): (Holiday & { inDays: number })[] {
  const base = Date.parse(`${date}T00:00:00Z`);
  return list
    .map((h) => ({ ...h, inDays: Math.round((Date.parse(`${h.date}T00:00:00Z`) - base) / 86_400_000) }))
    .filter((h) => h.inDays >= 0 && h.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays);
}

export function holidayLine(h: (Holiday & { inDays: number }) | undefined, locale: string): string {
  if (!h) return "";
  const name = locale === "en" ? h.en : locale === "ar" ? h.ar : h.he;
  return h.inDays === 0
    ? `Today is ${h.en} (${name}). If it fits the business naturally, connect the post to it with a warm greeting — never invent an offer that is not in the business information.`
    : `${h.en} (${name}) is in ${h.inDays} day(s). If it fits naturally, prepare the audience for it (gift ideas, opening hours, a seasonal tip) — never invent discounts.`;
}

/* ------------------------------------------------------------------ the writing brief */

export function autopilotTask(input: { pillar: string; platform: "facebook" | "instagram"; lang: string; tone: string; media: "image" | "video" | "none"; holiday?: string; review?: { author: string | null; text: string; rating: number | null } | null }): string {
  const isIg = input.platform === "instagram";
  return [
    `Write today's ${isIg ? "Instagram" : "Facebook"} post in ${input.lang}. Tone: ${input.tone}. Content pillar for today: "${input.pillar}".`,
    input.review
      ? `Base it on this REAL customer review (${input.review.rating ?? 5}★ by ${input.review.author ?? "a customer"}): "${input.review.text.slice(0, 600)}". Quote a short part of it naturally, thank the customer, never change its meaning.`
      : "",
    input.holiday ?? "",
    "Structure: a scroll-stopping first line (max ~12 words); " + (isIg ? "3-6 short lines" : "2-4 short lines") + " of value, one idea per line; one clear call to action; hashtags on the last line (" + (isIg ? "5-10" : "1-3") + ").",
    input.media === "video"
      ? 'The post goes with a short vertical video: "scene" = 2-5 English keywords describing stock footage that fits (e.g. "barber cutting hair close up").'
      : 'Art-direct the image: "scene" = a concrete English description of a photograph (subject, setting, mood, colors, light; max 45 words; no text, letters, logos, prices or numbers).',
    'Also: "headline" = 3-7 words for an on-image title; "firstComment" = optional extra value or hashtags (may be empty); "alt" = short alt text.',
    'Answer with JSON ONLY: {"post": "...", "scene": "...", "headline": "...", "firstComment": "...", "alt": "..."} — \\n for line breaks.',
  ]
    .filter(Boolean)
    .join("\n");
}

/** A week of slots (one per allowed day) starting tomorrow, at the business's posting time. */
export function weekSlots(input: { now: Date; tz: string; postTime: string; days: number[]; count?: number; taken?: string[] }): { date: string; at: Date }[] {
  const today = zonedParts(input.now, input.tz);
  const out: { date: string; at: Date }[] = [];
  const taken = new Set(input.taken ?? []);
  for (let i = 1; i <= 21 && out.length < (input.count ?? 7); i++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.day + i, 12));
    if (!input.days.includes(base.getUTCDay())) continue;
    const date = iso(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
    if (taken.has(date)) continue;
    out.push({ date, at: zonedInstant(date, input.postTime, input.tz) });
  }
  return out;
}

/** Parses the "plan a week" answer: [{"post","pillar","scene","headline"}]. */
export function parseWeekPlan(raw: string, max = 7): { post: string; pillar: string | null; scene: string | null; headline: string | null }[] {
  const txt = (raw ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const s = txt.indexOf("[");
  const e = txt.lastIndexOf("]");
  if (s < 0 || e <= s) return [];
  try {
    const arr = JSON.parse(txt.slice(s, e + 1)) as unknown[];
    return arr
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({
        post: typeof x.post === "string" ? x.post.replace(/\\n/g, "\n").trim().slice(0, 2200) : typeof x.text === "string" ? x.text.trim().slice(0, 2200) : "",
        pillar: typeof x.pillar === "string" ? x.pillar.trim().slice(0, 80) || null : null,
        scene: typeof x.scene === "string" ? x.scene.trim().slice(0, 400) || null : null,
        headline: typeof x.headline === "string" ? x.headline.trim().slice(0, 120) || null : null,
      }))
      .filter((x) => x.post.length >= 20)
      .slice(0, max);
  } catch {
    return [];
  }
}

/** Telegram channel caption: 1024 chars max with a picture/video; plain text up to 4096. */
export function telegramCaption(text: string, withMedia: boolean): string {
  const max = withMedia ? 1024 : 4096;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Stock-video search words from the AI scene (English, 2-5 words). */
export function videoQuery(scene: string | null | undefined, fallback: string): string {
  const w = (scene ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((x) => x.length > 2 && !["the", "and", "with", "for", "close", "shot", "video", "footage"].includes(x));
  const q = w.slice(0, 4).join(" ");
  return q || fallback;
}

/** Picks the best stock-video file: vertical for Instagram, ≤1080p, ≤ 40 MB, MP4. */
export function pickVideoFile(files: { link: string; width?: number; height?: number; file_type?: string; size?: number }[], platform: "facebook" | "instagram"): string | null {
  const ok = files.filter((f) => /^https:\/\//.test(f.link) && (!f.file_type || f.file_type === "video/mp4") && (f.height ?? 0) > 0 && Math.max(f.width ?? 0, f.height ?? 0) <= 1920 && (!f.size || f.size <= 40 * 1024 * 1024));
  if (!ok.length) return null;
  const want = (f: { width?: number; height?: number }) => (platform === "instagram" ? (f.height ?? 0) >= (f.width ?? 0) : (f.width ?? 0) >= (f.height ?? 0));
  const sorted = [...ok].sort((a, b) => Number(want(b)) - Number(want(a)) || Math.abs(Math.min(a.width ?? 0, a.height ?? 0) - 1080) - Math.abs(Math.min(b.width ?? 0, b.height ?? 0) - 1080));
  return sorted[0]!.link;
}
