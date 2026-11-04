/**
 * Wave 63 — social intelligence for customer conversations (pure, unit-tested).
 * Added next to `intelligence.ts` / `brain-pro.ts`; nothing there changed. It adds what a top human
 * employee notices without being told:
 *
 *   • the TREND of the customer's mood across the whole conversation, not only the last message;
 *   • "I already told you" / "you did not understand" — the customer feels unheard;
 *   • sensitive moments (loss, illness, money trouble): empathy first, no selling, no emoji;
 *   • time awareness: Shabbat, Israeli holidays, night hours, the right greeting;
 *   • knowledge gaps: a question the business data cannot answer is never guessed;
 *   • what the customer already objected to / prefers, so the agent does not repeat itself.
 *
 * The brief contains only OUR guidance, never customer text (no prompt-injection surface).
 */
import { analyzeMessage, type Lang, type Mood } from "./intelligence";
import { conversationSignals, detectSignals, type HistoryMsg, type Objection } from "./brain-pro";
import { israeliHolidays } from "./holidays-core";

/* ------------------------------------------------------------------ mood trend */

export type MoodTrend = "worsening" | "improving" | "stable" | "volatile" | "unknown";

const MOOD_SCORE: Record<Mood, number> = { positive: 1, neutral: 0, negative: -1, angry: -2 };

export interface MoodTrendResult {
  trend: MoodTrend;
  /** moods of the customer's messages, oldest first (last 6) */
  moods: Mood[];
  /** how many of the latest customer messages in a row were negative or angry */
  negativeStreak: number;
}

/** Mood across the customer's recent messages (cheap, no AI call). */
export function moodTrend(history: HistoryMsg[]): MoodTrendResult {
  const moods = history
    .filter((m) => m.role === "user")
    .slice(-6)
    .map((m) => analyzeMessage(m.content).mood);
  let negativeStreak = 0;
  for (let i = moods.length - 1; i >= 0; i--) {
    if (moods[i] === "negative" || moods[i] === "angry") negativeStreak++;
    else break;
  }
  if (moods.length < 2) return { trend: "unknown", moods, negativeStreak };
  const scores = moods.map((m) => MOOD_SCORE[m]);
  const half = Math.ceil(scores.length / 2);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const early = avg(scores.slice(0, half));
  const late = avg(scores.slice(half));
  let flips = 0;
  for (let i = 1; i < scores.length; i++) if (Math.sign(scores[i]!) !== Math.sign(scores[i - 1]!) && scores[i] !== 0 && scores[i - 1] !== 0) flips++;
  let trend: MoodTrend = "stable";
  if (flips >= 2) trend = "volatile";
  else if (late - early <= -0.75 || (negativeStreak >= 2 && late < early)) trend = "worsening";
  else if (late - early >= 0.75) trend = "improving";
  else if (negativeStreak >= 2) trend = "worsening";
  return { trend, moods, negativeStreak };
}

/* ------------------------------------------------------------------ feeling unheard */

const UNHEARD_RE =
  /כבר\s*(?:אמרתי|כתבתי|ציינתי|שלחתי|עניתי)|אמרתי\s*(?:לך\s*)?(?:כבר|את\s*זה)|שוב\s*(?:פעם\s*)?(?:אני\s*)?(?:צריך|צריכה)\s*(?:להסביר|לחזור)|לא\s*(?:הבנת|הבנתם|קראת|קראתם)|לא\s*(?:זה\s*)?מה\s*ששאלתי|לא\s*עניתם\s*(?:לי\s*)?על\s*השאלה|\b(?:i (?:already )?(?:told|said|wrote|asked)|as i (?:said|mentioned)|you(?:'re| are)? not (?:listening|understanding)|you didn'?t (?:understand|read|answer)|that'?s not what i asked|read my message)\b|قلت\s*لك\s*(?:من\s*قبل|سابقاً)?|لم\s*تفهم|مش\s*هيك\s*سألت|ليس\s*هذا\s*ما\s*سألت/i;
const CONFUSED_RE = /לא\s*הבנתי|לא\s*ברור\s*לי|מה\s*זאת\s*אומרת|תסביר\s*שוב|תסבירי\s*שוב|\b(?:i (?:don'?t|do not) understand|i'?m confused|what do you mean|can you explain again)\b|ما\s*فهمت|مش\s*فاهم|وضّح\s*أكثر/i;

export interface UnheardSignals {
  unheard: boolean;
  confused: boolean;
}

export function unheardSignals(text: string): UnheardSignals {
  const t = (text ?? "").slice(0, 1500);
  return { unheard: UNHEARD_RE.test(t), confused: CONFUSED_RE.test(t) };
}

/** The customer asked the same thing again (the previous customer message is nearly the same). */
export function repeatedQuestion(history: HistoryMsg[], similarity: (a: string, b: string) => number): boolean {
  const users = history.filter((m) => m.role === "user");
  if (users.length < 2) return false;
  const last = users[users.length - 1]!.content;
  const prev = users[users.length - 2]!.content;
  return last.length > 8 && similarity(last, prev) >= 0.7;
}

/* ------------------------------------------------------------------ sensitive moments */

export type Sensitive = "loss" | "illness" | "financial_hardship" | "distress";

const SENSITIVE: [Sensitive, RegExp][] = [
  ["loss", /נפטר(?:ה)?|פטירה|אבל\s+(?:על|במשפחה)|שבעה|הלוויה|איבדתי\s*(?:את\s*)?(?:אבא|אמא|אח|אחות|בעל|אישה|אשתי|בעלי|ילד|בן|בת)|\b(?:passed away|funeral|bereavement|lost (?:my )?(?:father|mother|husband|wife|son|daughter|brother|sister))\b|توفي|وفاة|جنازة|عزاء/i],
  ["illness", /מחלה\s*(?:קשה|סופנית)|סרטן|אושפז(?:ה|תי)?|בית\s*חולים|ניתוח|כימותרפיה|מצב\s*רפואי|\b(?:cancer|hospitali[sz]ed|surgery|chemo(?:therapy)?|diagnos(?:is|ed)|terminal)\b|سرطان|مستشفى|عملية\s*جراحية|مرض\s*خطير/i],
  ["financial_hardship", /קשה\s*לי\s*כלכלית|מצוקה\s*כלכלית|פוטרתי|איבדתי\s*(?:את\s*)?(?:העבודה|הפרנסה)|אין\s*לי\s*(?:כסף\s*)?לאוכל|חובות\s*כבדים|עיקול|\b(?:lost my job|laid off|can'?t make ends meet|in debt|bankrupt|struggling financially)\b|فقدت\s*عملي|ضائقة\s*مالية|ديون/i],
  ["distress", /אני\s*(?:ממש\s*)?(?:מיואש|מיואשת|שבור|שבורה|בדיכאון|בלחץ\s*נורא|לא\s*מסוגל|לא\s*מסוגלת)|\b(?:i(?:'m| am) (?:desperate|devastated|depressed|overwhelmed|breaking down)|i can'?t cope)\b|أنا\s*(?:محطم|مكتئب|يائس)/i],
];

export function sensitiveMoment(text: string): Sensitive | null {
  const t = (text ?? "").slice(0, 1500);
  for (const [k, re] of SENSITIVE) if (re.test(t)) return k;
  return null;
}

/* ------------------------------------------------------------------ time awareness */

export type DayPart = "morning" | "noon" | "evening" | "night";

export interface TimeContext {
  /** local date, YYYY-MM-DD, in the business's time zone */
  date: string;
  hour: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  dayPart: DayPart;
  /** Friday afternoon until Saturday evening (Israel only) */
  shabbat: boolean;
  /** an Israeli holiday today (Israel only) */
  holiday: boolean;
  /** an Israeli holiday begins tomorrow (Israel only) */
  holidayTomorrow: boolean;
  isIsrael: boolean;
}

function localParts(now: Date, tz: string): { date: string; hour: number; weekday: number } | null {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: days.indexOf(p.weekday ?? "") };
  } catch {
    return null;
  }
}

const ISRAEL_TZ = /^(?:Asia\/Jerusalem|Asia\/Tel_Aviv|Israel)$/i;

export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "noon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** The business's local time facts. Shabbat / holiday rules apply only in the Israeli time zone. */
export function timeContext(now: Date, tz: string | null | undefined): TimeContext | null {
  const zone = tz || "Asia/Jerusalem";
  const p = localParts(now, zone);
  if (!p || p.weekday < 0) return null;
  const isIsrael = ISRAEL_TZ.test(zone);
  let holiday = false;
  let holidayTomorrow = false;
  if (isIsrael) {
    const hs = israeliHolidays(p.date, 3).map((h) => h.date);
    holiday = hs.includes(p.date);
    const tomorrow = new Date(new Date(`${p.date}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    holidayTomorrow = hs.includes(tomorrow);
  }
  const shabbat = isIsrael && ((p.weekday === 5 && p.hour >= 16) || (p.weekday === 6 && p.hour < 19));
  return { date: p.date, hour: p.hour, weekday: p.weekday, dayPart: dayPartOf(p.hour), shabbat, holiday, holidayTomorrow, isIsrael };
}

export function greetingFor(part: DayPart, lang: Lang): string {
  const t = {
    he: { morning: "בוקר טוב", noon: "צהריים טובים", evening: "ערב טוב", night: "ערב טוב" },
    en: { morning: "Good morning", noon: "Good afternoon", evening: "Good evening", night: "Hello" },
    ar: { morning: "صباح الخير", noon: "مساء الخير", evening: "مساء الخير", night: "مرحباً" },
  } as const;
  return t[lang][part];
}

/* ------------------------------------------------------------------ knowledge gaps */

export type GapTopic = "warranty" | "stock" | "shipping" | "discount" | "payment" | "returns" | "delivery_time" | "installation" | "availability_date";

const GAP_QUESTION: [GapTopic, RegExp][] = [
  ["warranty", /אחריות|ערבות|\b(?:warranty|guarantee)\b|ضمان/i],
  ["stock", /(?:יש|נשאר)\s*(?:לכם\s*)?(?:במלאי|מלאי)|\b(?:in stock|do you have .{0,20} in)\b|متوفر|في\s*المخزون/i],
  ["shipping", /משלוח(?:ים)?|שליח|\b(?:shipping|ship to|delivery cost)\b|شحن|توصيل/i],
  ["discount", /הנחה|מבצע|קופון|\b(?:discount|coupon|promo(?:tion)?|sale)\b|خصم|عرض/i],
  ["payment", /תשלומים|לשלם\s*ב|ביט|פייבוקס|\b(?:installments|pay with|payment methods?)\b|تقسيط|الدفع/i],
  ["returns", /החזרה|להחזיר|החלפה|\b(?:return policy|exchange policy|can i return)\b|إرجاع|استبدال/i],
  ["delivery_time", /תוך\s*כמה\s*זמן|כמה\s*זמן\s*(?:לוקח|זה\s*לוקח)|זמן\s*אספקה|\b(?:how long (?:does|will|until)|lead time|delivery time)\b|كم\s*يستغرق/i],
  ["installation", /התקנה|הרכבה|\b(?:installation|assembly|set ?up service)\b|تركيب/i],
  ["availability_date", /מתי\s*(?:יהיה|יגיע|חוזר)\s*(?:במלאי|מלאי)?|\b(?:when will (?:it|you) (?:be|have)|back in stock)\b|متى\s*يتوفر/i],
];

const GAP_FACTS: Record<GapTopic, RegExp> = {
  warranty: /אחריות|ערבות|warranty|guarantee|ضمان/i,
  stock: /במלאי|מלאי|in stock|inventory|متوفر|المخزون/i,
  shipping: /משלוח|שליח|shipping|delivery|توصيل|شحن/i,
  discount: /הנחה|מבצע|קופון|discount|coupon|promo|sale|خصم|عرض/i,
  payment: /תשלומים|ביט|פייבוקס|אשראי|מזומן|paypal|credit card|cash|installments|الدفع|تقسيط|بطاقة/i,
  returns: /החזר|החלפה|return|exchange|refund|إرجاع|استبدال/i,
  delivery_time: /ימי\s*עסקים|תוך\s*\d+|זמן\s*אספקה|business days|within \d+|lead time|يوم\s*عمل|خلال\s*\d+/i,
  installation: /התקנה|הרכבה|installation|assembly|تركيب/i,
  availability_date: /מלאי|בקרוב|coming soon|restock|يتوفر/i,
};

/** Topics the customer asks about that nothing in the business information mentions. */
export function knowledgeGaps(customerText: string, facts: string): GapTopic[] {
  const q = (customerText ?? "").slice(0, 1500);
  if (!q.trim()) return [];
  const out: GapTopic[] = [];
  for (const [topic, re] of GAP_QUESTION) if (re.test(q) && !GAP_FACTS[topic].test(facts ?? "")) out.push(topic);
  return out;
}

const GAP_LABEL: Record<GapTopic, string> = {
  warranty: "warranty / guarantee",
  stock: "stock",
  shipping: "shipping",
  discount: "discounts / promotions",
  payment: "payment methods / installments",
  returns: "returns / exchanges",
  delivery_time: "delivery time",
  installation: "installation / assembly",
  availability_date: "when it will be available",
};

export const gapLabel = (t: GapTopic): string => GAP_LABEL[t];

/* ------------------------------------------------------------------ what the conversation already showed */

export interface ConversationInsight {
  objections: Objection[];
  /** the customer writes short, practical messages (average ≤ 7 words) */
  brief: boolean;
  /** the customer used emoji at least once */
  emoji: boolean;
  /** the customer writes in more than one language */
  mixedLanguages: boolean;
}

export function conversationInsight(history: HistoryMsg[]): ConversationInsight {
  const users = history.filter((m) => m.role === "user");
  const sig = conversationSignals(history);
  const words = users.map((m) => (m.content.match(/[\p{L}\p{N}]+/gu) ?? []).length).filter((n) => n > 0);
  const avg = words.length ? words.reduce((a, b) => a + b, 0) / words.length : 0;
  const langs = new Set(users.map((m) => analyzeMessage(m.content).lang).filter(Boolean));
  return { objections: sig.objections, brief: words.length >= 2 && avg <= 7, emoji: users.some((m) => detectSignals(m.content).emoji), mixedLanguages: langs.size > 1 };
}

/* ------------------------------------------------------------------ the brief for the prompt */

export interface SocialBriefInput {
  history: HistoryMsg[];
  /** the customer's latest message */
  text: string;
  /** facts the business gave the agent (see `factsText`) */
  facts: string;
  now?: Date;
  tz?: string | null;
  lang: Lang;
  similarity?: (a: string, b: string) => number;
  /** optional: the funnel state names (so the brief can say "stop selling") */
  handoffLikely?: boolean;
}

export interface SocialBrief {
  text: string;
  /** the agent must not sell in this reply */
  noSelling: boolean;
  /** the agent must not use emoji in this reply */
  noEmoji: boolean;
  gaps: GapTopic[];
  trend: MoodTrend;
  sensitive: Sensitive | null;
}

export function socialBrief(input: SocialBriefInput): SocialBrief {
  const lines: string[] = [];
  const trend = moodTrend(input.history);
  const unheard = unheardSignals(input.text);
  const sensitive = sensitiveMoment(input.text);
  const gaps = knowledgeGaps(input.text, input.facts);
  const insight = conversationInsight(input.history);
  const time = timeContext(input.now ?? new Date(), input.tz);
  let noSelling = false;
  let noEmoji = false;

  if (sensitive) {
    noSelling = true;
    noEmoji = true;
    lines.push("- A SENSITIVE moment: the customer shared something painful. Open with one short, sincere, human sentence of care (no cliché, no cheerful tone). No selling, no upsell, no emoji. Offer practical help only if they ask, or offer flexibility and let a person from the team follow up gently.");
  }
  if (trend.trend === "worsening" || trend.negativeStreak >= 2) {
    noSelling = true;
    noEmoji = true;
    lines.push("- The customer's mood has been getting worse over the last messages. Stop selling and change your approach: acknowledge what went wrong in plain words, take ownership, give one concrete step, and offer a person from the team. Do not repeat what you already said.");
  } else if (trend.trend === "volatile") {
    lines.push("- The customer's mood swings between messages. Stay calm, steady and brief; do not mirror the emotion.");
  } else if (trend.trend === "improving") {
    lines.push("- The customer's mood is improving: keep the same tone that is working and move gently to the next step.");
  }
  if (unheard.unheard) {
    noSelling = true;
    lines.push("- The customer feels they were not heard (\"I already told you\"). First restate in one line what they said, exactly, to prove you understood; do not ask anything they already answered. Then answer.");
  } else if (unheard.confused) {
    lines.push("- The customer did not understand. Re-explain in simpler words, shorter sentences, one idea at a time, with a concrete example. Do not repeat the same wording.");
  }
  if (input.similarity && repeatedQuestion(input.history, input.similarity)) {
    lines.push("- The customer repeated the same question: your last answer did not land. Answer it directly in the first sentence, differently from before.");
  }
  if (gaps.length) {
    lines.push(
      `- The customer asks about ${gaps.map(gapLabel).join(", ")}. Answer ONLY if the business information (or the help-center section, if present) states it. If it does not, do NOT guess or use \"usually\": say honestly that you will check with the team and come back, ask for the best way to reach them, and record it with [[TASK: …]] so a person answers. Everything you do know, answer now.`,
    );
  }
  if (insight.objections.length) {
    lines.push(`- Objections already raised in this conversation: ${insight.objections.join(", ")}. Do not repeat the same argument; acknowledge it and bring a NEW angle or a concrete proof point.`);
  }
  if (insight.brief) lines.push("- This customer prefers short, practical messages: no intro, no filler, at most two short sentences before the next step.");
  if (insight.mixedLanguages) lines.push("- The customer mixes languages: answer in the language of their last message and keep product names as written.");

  if (time) {
    const bits: string[] = [];
    if (time.shabbat) bits.push("it is Shabbat (Friday evening to Saturday night in Israel): do not promise anything for \"now\", do not push; offer to continue when the business reopens and, if relevant, wish a good Shabbat");
    if (time.holiday) bits.push("today is an Israeli holiday: the business is probably closed — promise nothing for today, wish a good holiday");
    else if (time.holidayTomorrow) bits.push("an Israeli holiday begins tomorrow: mention it if a date or delivery is discussed, so no promise falls on the holiday");
    if (time.dayPart === "night" && !time.shabbat) bits.push("it is night: keep the reply short and calm; do not promise an immediate call back — say when the team will answer");
    if (bits.length) lines.push(`- Time awareness: ${bits.join("; ")}.`);
    if (!input.history.some((m) => m.role === "assistant")) lines.push(`- If you greet, greet for the time of day: \"${greetingFor(time.dayPart, input.lang)}\" (never \"good morning\" at night).`);
  }
  if (!lines.length) return { text: "", noSelling, noEmoji, gaps, trend: trend.trend, sensitive };
  return { text: ["SOCIAL INTELLIGENCE (written by the system, follow it):", ...lines].join("\n"), noSelling, noEmoji, gaps, trend: trend.trend, sensitive };
}
