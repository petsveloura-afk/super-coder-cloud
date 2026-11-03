/**
 * Upgrade 7 / stage D — the understanding decoder (pure, rule-based: fast, free, and testable without a model).
 *
 * Turns a raw message — real Hebrew with slang, missing / wrong spelling and voice-transcript noise, also English and Arabic —
 * into: what was SAID (normalized), what was MEANT (intent), what is MISSING, how URGENT, which EMOTION, and how SURE we are.
 * Then a policy decides, by the COST OF A WRONG GUESS, whether to ask, to assume out loud, or to proceed. Stated confidence is
 * calibrated against how often past readings were actually right.
 */
import { detectEmotion, inferStyle, ownerStyle, type CustomerStyle, type Emotion, type OwnerStyle } from "./interaction-core";

export type Lang = "he" | "en" | "ar";

/* ------------------------------------------------------------------------------------------------ normalization */

const NIQQUD = /[֑-ׇ]/g;
const FILLERS = new Set(["אמ", "אממ", "אמממ", "אה", "אהה", "אההה", "הממ", "המם", "אאא", "נו", "כאילו", "יעני", "ככה", "um", "uh", "umm", "hmm", "erm", "يعني"]);
const ADDRESS = new Set(["אחי", "אחשלי", "גבר", "נשמה", "מותק", "אחלה", "יא", "בבקשה", "בקשה", "בבקשא"]);
const LAUGH = /^(ח{2,}|ה{3,}|ahah+|haha+|lol)$/i;

/** Hebrew final letters → regular (so "מחיר" typed on a phone with a wrong final form still matches) */
const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const unfinal = (w: string) => w.replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c);

/** multi-word slang → a standard phrase (applied before tokenizing) */
const PHRASES: [RegExp, string][] = [
  [/בא לי|בא לנו|מתחשק לי/g, "אני רוצה"],
  [/מה הקטע|מה הסיפור|מה קורה עם/g, "מה המצב של"],
  [/כמה (?:זה )?(?:עולה|עולא|עולות|יוצא|מגיע|לוקחים|עלות)/g, "מחיר"],
  [/מתי (אתם )?פתוחים|עד מתי (אתם )?פתוחים|שעות פעילות|שעות פתיחה/g, "שעות פתיחה"],
  [/לא עונים|אף אחד לא עונה|לא חוזרים אליי|לא חזרו אליי/g, "לא עונים"],
  [/בן אדם אמיתי|מישהו אמיתי|נציג אנושי|לדבר עם בן אדם/g, "נציג"],
  [/ביי ביי/g, "ביי"],
];

export function normalizeText(raw: string): { text: string; tokens: string[]; noise: number } {
  let t = String(raw ?? "").normalize("NFC").replace(NIQQUD, "").replace(/[‎‏‪-‮]/g, "");
  t = t.replace(/[’‘`´]/g, "'").replace(/[“”„]/g, '"').replace(/[־–—]/g, " ");
  t = t.toLowerCase();
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  const rawWords = t.split(/[^\p{L}\p{N}'":/.+@-]+/u).map((w) => w.replace(/^["':.-]+|["':.-]+$/g, "")).filter(Boolean);
  const kept: string[] = [];
  const words: string[] = [];
  let removed = 0;
  for (const raw0 of rawWords) {
    // laughter is judged BEFORE stretched letters are collapsed ("חחחח" is laughter, not the letter ח)
    // stretched letters ("מההההר", "yesss", "ממממ") → one letter; legit doubles (וו, יי, ee) stay
    const w = LAUGH.test(raw0) ? raw0 : raw0.replace(/(\p{L})\1{2,}/gu, "$1");
    words.push(w);
    if (FILLERS.has(w) || LAUGH.test(w) || ADDRESS.has(w)) {
      removed++;
      continue;
    }
    // adjacent repetition from speech-to-text ("אני אני רוצה")
    if (kept.length && kept[kept.length - 1] === w && !/^\d+$/.test(w)) {
      removed++;
      continue;
    }
    kept.push(w);
  }
  const noise = words.length ? removed / words.length : 0;
  return { text: kept.join(" "), tokens: kept, noise: Math.round(noise * 100) / 100 };
}

/** no-vowel-letters skeleton: "לקבוע" ≈ "לקבע" ≈ "לקבוע" (Hebrew spelling without ו / י matres lectionis) */
export function skeleton(word: string): string {
  const w = unfinal(word);
  if (!/[א-ת]/.test(w)) return w;
  return w[0] + w.slice(1).replace(/[וי]/g, "");
}

export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    let rowMin = prev[0]!;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
      rowMin = Math.min(rowMin, prev[j]!);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length]!;
}

const PREFIXES = ["ו", "ה", "ב", "כ", "ל", "מ", "ש", "וה", "וב", "ול", "שה", "מה", "לה", "וש"];
/** a token (with any Hebrew prefix) matches a keyword exactly, by skeleton, or with ≤ 1 typo for words of 4+ letters */
export function matchesWord(token: string, keyword: string): "exact" | "fuzzy" | null {
  const cand = [token, ...PREFIXES.filter((p) => token.startsWith(p) && token.length - p.length >= 2).map((p) => token.slice(p.length))];
  const ks = skeleton(keyword);
  for (const c of cand) {
    if (c === keyword || unfinal(c) === unfinal(keyword)) return "exact";
    const cs = skeleton(c);
    if (cs === ks) return "fuzzy";
    if (ks.length >= 4 && cs.length >= 4 && editDistance(cs, ks, 1) <= 1) return "fuzzy";
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------ intents */

export type Intent = "booking" | "cancel" | "price" | "hours" | "complaint" | "followup" | "human" | "thanks" | "info" | "unknown";

const KEYWORDS: Record<Exclude<Intent, "info" | "unknown">, { words: string[]; weight: number }> = {
  booking: { words: ["תור", "לקבוע", "פגישה", "לשריין", "שריון", "להזמין", "הזמנה", "פנוי", "פנויים", "book", "appointment", "reserve", "booking", "schedule", "موعد", "حجز", "احجز"], weight: 1 },
  cancel: { words: ["לבטל", "ביטול", "לדחות", "להזיז", "לשנות", "cancel", "reschedule", "postpone", "إلغاء", "الغاء", "تأجيل"], weight: 1.1 },
  price: { words: ["מחיר", "עלות", "עולה", "תעריף", "מחירון", "price", "cost", "rate", "quote", "how much", "سعر", "كم", "تكلفة"], weight: 1 },
  hours: { words: ["פתוחים", "פתוח", "סגור", "סגורים", "שעות", "hours", "open", "closed", "opening", "ساعات", "مفتوح"], weight: 1 },
  complaint: { words: ["תלונה", "גרוע", "נורא", "מאכזב", "מאוכזב", "מחורבן", "בושה", "לא מרוצה", "הרוס", "מזעזע", "complaint", "terrible", "awful", "worst", "unhappy", "disappointed", "شكوى", "سيء", "مخيب"], weight: 1.2 },
  followup: { words: ["עדכון", "סטטוס", "המצב", "עדיין", "חיכיתי", "מחכה", "מחכים", "status", "update", "still waiting", "follow", "تحديث", "ما زلت"], weight: 0.9 },
  human: { words: ["נציג", "מנהל", "אחראי", "תחזרו אליי", "תתקשרו אליי", "manager", "human", "agent", "representative", "call me", "مدير", "موظف"], weight: 1.2 },
  thanks: { words: ["תודה", "תותח", "מעולה", "אש", "thanks", "thank", "great", "perfect", "شكرا", "ممتاز"], weight: 0.7 },
};

export interface IntentRead {
  intent: Intent;
  /** 0..1 how clearly the words point to this intent alone */
  strength: number;
  runnerUp: Intent | null;
}

/** nouns that also appear in "cancel my appointment": they only count for booking when no cancel verb is present */
const BOOKING_NOUNS = new Set(["תור", "פגישה", "הזמנה", "appointment", "booking", "موعد"]);
const REFUND = ["החזר", "זיכוי", "refund", "chargeback", "استرجاع", "חיוב", "חויבתי", "charged"];

export function readIntent(tokens: string[]): IntentRead {
  const scores = new Map<Intent, number>();
  const cancelVerb = tokens.some((tk) => KEYWORDS.cancel.words.some((w) => !w.includes(" ") && matchesWord(tk, w)));
  for (const [intent, spec] of Object.entries(KEYWORDS) as [Exclude<Intent, "info" | "unknown">, { words: string[]; weight: number }][]) {
    let s = 0;
    for (const tk of tokens) {
      for (const w of spec.words) {
        if (intent === "booking" && cancelVerb && BOOKING_NOUNS.has(w)) continue;
        const m = w.includes(" ") ? null : matchesWord(tk, w);
        if (m) {
          s += (m === "exact" ? 1 : 0.7) * spec.weight;
          break;
        }
      }
    }
    // multi-word keywords ("how much", "still waiting")
    const joined = tokens.join(" ");
    for (const w of spec.words.filter((x) => x.includes(" "))) if (joined.includes(w)) s += 1.2 * spec.weight;
    if (s > 0) scores.set(intent, s);
  }
  // "thanks" alone is only an intent when nothing stronger is present
  if (scores.size > 1) scores.delete("thanks");
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { intent: tokens.length >= 3 ? "info" : "unknown", strength: tokens.length >= 3 ? 0.3 : 0.1, runnerUp: null };
  const [top, second] = [ranked[0]!, ranked[1]];
  const gap = second ? (top[1] - second[1]) / top[1] : 1;
  const strength = Math.min(1, 0.45 + 0.3 * Math.min(1, top[1] / 2) + 0.25 * gap);
  return { intent: top[0], strength: Math.round(strength * 100) / 100, runnerUp: second ? second[0] : null };
}

/* ------------------------------------------------------------------------------------------------ entities */

const ONES: Record<string, number> = { אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שני: 2, שתי: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10 };
const TENS: Record<string, number> = { עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, שישים: 60, שבעים: 70, שמונים: 80, תשעים: 90 };

const NUM_WORDS = new Set(["מאה", "מאתיים", "מאות", "אלף", "אלפיים", "אלפים"]);
const isNumWord = (w: string) => ONES[w] !== undefined || TENS[w] !== undefined || NUM_WORDS.has(w);

/** Hebrew spoken numbers → a value: "מאה עשרים" 120, "מאתיים וחמישים" 250, "שלוש מאות" 300, "אלף ומאתיים" 1200 */
export function hebrewNumber(tokens: string[]): number | null {
  let total = 0;
  let cur = 0;
  let seen = false;
  for (const raw of tokens) {
    const w = raw.startsWith("ו") && raw.length > 2 && isNumWord(raw.slice(1)) ? raw.slice(1) : raw;
    if (ONES[w] !== undefined) {
      cur += ONES[w]!;
      seen = true;
    } else if (TENS[w] !== undefined) {
      cur += TENS[w]!;
      seen = true;
    } else if (w === "מאה") {
      cur += 100;
      seen = true;
    } else if (w === "מאתיים") {
      cur += 200;
      seen = true;
    } else if (w === "מאות") {
      cur = (cur || 1) * 100;
      seen = true;
    } else if (w === "אלף") {
      total += (cur || 1) * 1000;
      cur = 0;
      seen = true;
    } else if (w === "אלפיים") {
      total += 2000;
      seen = true;
    } else if (w === "אלפים") {
      total += (cur || 1) * 1000;
      cur = 0;
      seen = true;
    } else if (seen) break;
  }
  return seen ? total + cur : null;
}

export interface Entities {
  amounts: { value: number; currency: "ILS" | null }[];
  times: string[];
  dates: string[];
  phones: string[];
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DATE_WORDS = ["היום", "מחר", "מחרתיים", "אתמול", "today", "tomorrow", "yesterday", "اليوم", "غدا", "غداً"];
const TIME_WORDS = ["בבוקר", "בצהריים", "אחהצ", "בערב", "בלילה", "morning", "noon", "afternoon", "evening", "tonight", "صباحا", "مساء", "ظهرا"];

export function extractEntities(tokens: string[], rawText: string): Entities {
  const out: Entities = { amounts: [], times: [], dates: [], phones: [] };
  const raw = String(rawText ?? "");
  for (const m of raw.matchAll(/(?<!\d)(0[5][0-9][-\s]?\d{3}[-\s]?\d{4}|\+9725\d[-\s]?\d{3}[-\s]?\d{4})(?!\d)/g)) out.phones.push(m[1]!.replace(/[-\s]/g, ""));
  for (const m of raw.matchAll(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g)) out.times.push(`${m[1]!.padStart(2, "0")}:${m[2]}`);
  for (const m of raw.matchAll(/(?<!\d)(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?!\d)/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) out.dates.push(`${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}`);
  }
  // "ב-5" / "בשעה 17" / "at 5pm" / "בחמש"
  for (const m of raw.matchAll(/(?:בשעה|ב-?|at|الساعة)\s?(\d{1,2})(?!\d|[:/.]\d)\s?(pm|am)?/gi)) {
    let h = Number(m[1]);
    if (m[2]?.toLowerCase() === "pm" && h < 12) h += 12;
    if (h >= 0 && h <= 23 && !out.times.includes(`${String(h).padStart(2, "0")}:00`)) out.times.push(`${String(h).padStart(2, "0")}:00`);
  }
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]!;
    const bare = tk.replace(/^[בלמה]/, "");
    if (/^(שעה|בשעה)$/.test(tk) && ONES[tokens[i + 1] ?? ""] !== undefined) out.times.push(`${String(ONES[tokens[i + 1]!]).padStart(2, "0")}:00`);
    else if (tk.startsWith("ב") && ONES[bare] !== undefined && !out.times.length) out.times.push(`${String(ONES[bare]! < 7 ? ONES[bare]! + 12 : ONES[bare]!).padStart(2, "0")}:00~`);
    for (const w of DATE_WORDS) if (tk === w) out.dates.push(w);
    for (const w of WEEKDAYS) if (tk === w || tk === `ב${w}` || tk === `יום${w}` || (w.length > 3 && matchesWord(tk, w) === "exact")) out.dates.push(w);
    if (tk === "יום" && WEEKDAYS.includes(tokens[i + 1] ?? "")) out.dates.push(tokens[i + 1]!);
    if (/^(שבוע|בשבוע)$/.test(tk) && /^(הבא|הקרוב)$/.test(tokens[i + 1] ?? "")) out.dates.push("next_week");
    for (const w of TIME_WORDS) if (tk === w || (w.startsWith("ב") === false && tk === w)) out.times.push(w);
  }
  // money: "120 שקל" / "₪120" / "120 ש״ח" / "מאה עשרים שקל"
  for (const m of raw.matchAll(/(?:₪\s?(\d[\d,.]*)|(\d[\d,.]*)\s?(?:₪|שקל(?:ים)?|ש"ח|שח|ils|nis))/gi)) {
    const v = Number((m[1] ?? m[2])!.replace(/,/g, ""));
    if (Number.isFinite(v)) out.amounts.push({ value: v, currency: "ILS" });
  }
  for (let i = 0; i < tokens.length; i++) {
    if (/^(שקל|שקלים|שח|ש"ח)$/.test(tokens[i]!)) {
      const back: string[] = [];
      for (let k = i - 1; k >= 0 && back.length < 4; k--) {
        const w = tokens[k]!;
        const base = w.startsWith("ו") && w.length > 2 ? w.slice(1) : w;
        if (isNumWord(w) || isNumWord(base)) back.unshift(w);
        else break;
      }
      const v = back.length ? hebrewNumber(back) : null;
      if (v !== null && !out.amounts.some((a) => a.value === v)) out.amounts.push({ value: v, currency: "ILS" });
    }
  }
  out.dates = [...new Set(out.dates)];
  out.times = [...new Set(out.times)];
  return out;
}

/* ------------------------------------------------------------------------------------------------ the reading */

/** what each intent needs before a wrong guess becomes expensive (ordered by importance) */
const REQUIRED: Record<Intent, ("date" | "time" | "service" | "which_appointment" | "contact")[]> = {
  booking: ["service", "date", "time"],
  cancel: ["which_appointment"],
  price: ["service"],
  hours: [],
  complaint: [],
  followup: [],
  human: [],
  thanks: [],
  info: [],
  unknown: [],
};

export interface Understanding {
  said: string;
  intent: Intent;
  runnerUp: Intent | null;
  entities: Entities;
  missing: string[];
  urgency: number;
  emotion: Emotion;
  emotionIntensity: number;
  /** raw, before calibration */
  confidence: number;
  /** how much of the message was speech noise / fillers */
  noise: number;
  signals: string[];
}

export function understand(message: string, ctx: { knownServices?: string[]; hasOpenAppointment?: boolean } = {}): Understanding {
  const norm = normalizeText(message);
  const ir = readIntent(norm.tokens);
  const ent = extractEntities(norm.tokens, message);
  const emo = detectEmotion(message);
  const services = (ctx.knownServices ?? []).map((s) => normalizeText(s).tokens).filter((t) => t.length);
  const serviceNamed = services.some((words) => words.every((w) => norm.tokens.some((tk) => matchesWord(tk, w) !== null)) || words.some((w) => w.length >= 4 && norm.tokens.some((tk) => matchesWord(tk, w) !== null)));
  const have = (slot: string) => (slot === "date" ? ent.dates.length > 0 : slot === "time" ? ent.times.length > 0 : slot === "service" ? serviceNamed : slot === "which_appointment" ? ent.dates.length > 0 || ent.times.length > 0 || ctx.hasOpenAppointment === true : false);
  const missing = REQUIRED[ir.intent].filter((s) => !have(s));
  const signals: string[] = [...emo.signals];
  if (norm.noise >= 0.2) signals.push("speech_noise");
  if (norm.tokens.some((tk) => REFUND.some((w) => matchesWord(tk, w) === "exact"))) signals.push("money_words");
  const urgentWords = norm.tokens.some((tk) => ["דחוף", "מיד", "עכשיו", "בהקדם", "היום", "הערב", "urgent", "asap", "now", "today", "عاجل", "الآن"].some((w) => matchesWord(tk, w) === "exact"));
  const urgency = Math.min(1, Math.max(emo.urgency, urgentWords ? 0.7 : 0) + (ent.dates.includes("היום") || ent.dates.includes("today") ? 0.2 : 0));
  // confidence: how clear the intent is, how complete the details are, minus noise and shortness
  const need = REQUIRED[ir.intent].length;
  const filled = need ? (need - missing.length) / need : 1;
  let conf = 0.15 + 0.5 * ir.strength + 0.25 * filled;
  if (norm.tokens.length < 2) conf -= 0.2;
  if (norm.noise >= 0.2) conf -= 0.08;
  if (ir.runnerUp && ir.strength < 0.6) conf -= 0.08;
  if (ir.intent === "unknown") conf = Math.min(conf, 0.2);
  const confidence = Math.round(Math.min(0.97, Math.max(0.05, conf)) * 100) / 100;
  return { said: norm.text, intent: ir.intent, runnerUp: ir.runnerUp, entities: ent, missing, urgency: Math.round(urgency * 100) / 100, emotion: emo.emotion, emotionIntensity: emo.intensity, confidence, noise: norm.noise, signals };
}

/* ------------------------------------------------------------------------------------------------ ask or assume */

export type Cost = "low" | "medium" | "high";

/** the price of a wrong guess: by the intent, raised by anything involving money, a customer's complaint or something irreversible */
export function errorCost(u: Pick<Understanding, "intent" | "emotion" | "emotionIntensity" | "entities"> & { signals?: string[] }, toolSensitivity: "internal" | "customer" | "money" | "irreversible" = "customer"): Cost {
  if (toolSensitivity === "money" || toolSensitivity === "irreversible") return "high";
  if (u.intent === "complaint" || u.intent === "human" || u.signals?.includes("money_words")) return "high";
  if (u.emotion === "angry" && u.emotionIntensity >= 0.6) return "high";
  if (u.entities.amounts.length) return "medium";
  if (u.intent === "cancel" || u.intent === "booking") return "medium";
  return "low";
}

export interface AskOrAssume {
  mode: "proceed" | "assume" | "ask";
  cost: Cost;
  /** ONE question (the most important missing thing), only when mode = ask */
  question: string | null;
  /** what is assumed out loud, only when mode = assume */
  assumptions: string[];
  reason: string;
}

const Q: Record<Lang, Record<string, string>> = {
  he: { service: "על איזה שירות מדובר?", date: "באיזה יום תרצו?", time: "באיזו שעה נוח לכם?", which_appointment: "על איזה תור מדובר (יום ושעה)?", contact: "איך נוכל לחזור אליכם?", general: "אפשר לפרט קצת יותר מה אתם צריכים?" },
  en: { service: "Which service is it about?", date: "Which day would you like?", time: "What time suits you?", which_appointment: "Which appointment (day and time)?", contact: "How can we reach you?", general: "Could you tell me a bit more about what you need?" },
  ar: { service: "عن أي خدمة تتحدث؟", date: "أي يوم تفضل؟", time: "ما الوقت المناسب لك؟", which_appointment: "عن أي موعد تتحدث (اليوم والساعة)؟", contact: "كيف يمكننا التواصل معك؟", general: "هل يمكنك توضيح ما تحتاجه أكثر؟" },
};
const A: Record<Lang, Record<string, string>> = {
  he: { service: "הכוונה לשירות הנפוץ ביותר", date: "הכוונה להזמן הפנוי הקרוב", time: "השעה גמישה", which_appointment: "הכוונה לתור הקרוב ביותר", contact: "משתמשים בפרטי הקשר שכבר קיימים", general: "הכוונה לשאלה כללית" },
  en: { service: "the most common service is meant", date: "the nearest free day is meant", time: "the time is flexible", which_appointment: "the nearest appointment is meant", contact: "the contact details on file are used", general: "this is a general question" },
  ar: { service: "المقصود الخدمة الأكثر طلبا", date: "المقصود أقرب يوم متاح", time: "الوقت مرن", which_appointment: "المقصود أقرب موعد", contact: "تُستخدم بيانات الاتصال المسجلة", general: "هذا سؤال عام" },
};

/**
 * The policy. Low cost → assume out loud (a wrong guess is cheap to fix); medium → ask ONE question when something critical is
 * missing or the reading is shaky; high → never guess: ask unless everything is present AND the reading is very sure.
 * `confidence` should already be calibrated (calibrate()).
 */
export function askOrAssume(u: Pick<Understanding, "intent" | "missing" | "confidence">, cost: Cost, lang: Lang = "he"): AskOrAssume {
  const q = (slot: string) => Q[lang][slot] ?? Q[lang].general!;
  const first = u.missing[0];
  if (cost === "high") {
    if (u.missing.length) return { mode: "ask", cost, question: q(first!), assumptions: [], reason: "high_cost_missing" };
    if (u.confidence < 0.8) return { mode: "ask", cost, question: q("general"), assumptions: [], reason: "high_cost_unsure" };
    return { mode: "proceed", cost, question: null, assumptions: [], reason: "high_cost_sure" };
  }
  if (cost === "medium") {
    if (first) return { mode: "ask", cost, question: q(first), assumptions: [], reason: "medium_cost_missing" };
    if (u.confidence < 0.55) return { mode: "ask", cost, question: q("general"), assumptions: [], reason: "medium_cost_unsure" };
    return { mode: "proceed", cost, question: null, assumptions: [], reason: "medium_cost_clear" };
  }
  if (u.confidence < 0.25) return { mode: "ask", cost, question: q("general"), assumptions: [], reason: "low_cost_unreadable" };
  if (u.missing.length) return { mode: "assume", cost, question: null, assumptions: u.missing.slice(0, 3).map((m) => A[lang][m] ?? A[lang].general!), reason: "low_cost_assume" };
  return { mode: "proceed", cost, question: null, assumptions: [], reason: "low_cost_clear" };
}

/* ------------------------------------------------------------------------------------------------ the owner and the customer */

export interface OwnerModel extends OwnerStyle {
  /** the language the owner writes in */
  language: Lang | "mixed";
  /** the owner writes in fragments / by voice: do not over-interpret details */
  casual: boolean;
  /** decisions the owner repeats ("always ask me before ...") */
  standingRules: string[];
}

const scriptOf = (t: string): Lang => (/[؀-ۿ]/.test(t) ? "ar" : /[֐-׿]/.test(t) ? "he" : "en");

export function ownerModel(messages: string[]): OwnerModel {
  const base = ownerStyle(messages);
  const msgs = messages.map((m) => String(m ?? "").trim()).filter(Boolean).slice(-10);
  const langs = new Set(msgs.map(scriptOf));
  const casual = msgs.some((m) => normalizeText(m).noise >= 0.15 || /^(יאללה|סבבה|וואלה|אחי)/.test(m.trim()));
  const rules = msgs.filter((m) => /(תמיד|אף פעם|לעולם|בלי אישור|רק אחרי|always|never|only after|دائما|أبدا)/i.test(m)).map((m) => m.replace(/\s+/g, " ").slice(0, 160)).slice(0, 5);
  return { ...base, language: langs.size === 1 ? [...langs][0]! : langs.size === 0 ? "he" : "mixed", casual, standingRules: rules };
}

export interface CustomerModel extends CustomerStyle {
  /** how many of the customer's recent messages were complaints */
  complaints: number;
  /** most frequent intent in the customer's recent messages */
  usualIntent: Intent | null;
  language: Lang;
}

export function customerModel(messages: string[]): CustomerModel {
  const msgs = messages.map((m) => String(m ?? "").trim()).filter(Boolean).slice(-8);
  const style = inferStyle(msgs);
  const intents = msgs.map((m) => understand(m).intent).filter((i) => i !== "unknown" && i !== "thanks");
  const counts = new Map<Intent, number>();
  for (const i of intents) counts.set(i, (counts.get(i) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const langs = msgs.map(scriptOf);
  const language = (["he", "ar", "en"] as Lang[]).sort((a, b) => langs.filter((l) => l === b).length - langs.filter((l) => l === a).length)[0] ?? "he";
  return { ...style, complaints: intents.filter((i) => i === "complaint").length, usualIntent: usual, language };
}

/* ------------------------------------------------------------------------------------------------ calibration */

export interface CalibrationSample {
  confidence: number;
  correct: boolean;
}
export interface CalibrationBin {
  from: number;
  to: number;
  n: number;
  correct: number;
}
const BINS = 5;

export function calibrationTable(samples: CalibrationSample[]): CalibrationBin[] {
  const bins: CalibrationBin[] = Array.from({ length: BINS }, (_, i) => ({ from: i / BINS, to: (i + 1) / BINS, n: 0, correct: 0 }));
  for (const s of samples) {
    if (!Number.isFinite(s.confidence)) continue;
    const i = Math.min(BINS - 1, Math.max(0, Math.floor(s.confidence * BINS)));
    bins[i]!.n++;
    if (s.correct) bins[i]!.correct++;
  }
  return bins;
}

/**
 * The stated confidence, corrected by the past: with few samples in its bin the raw value is kept (a prior worth 5 samples);
 * with many, the real hit rate takes over. Overconfident readings come down, underconfident ones go up.
 */
export function calibrate(raw: number, table: CalibrationBin[], prior = 5): number {
  const r = Math.min(1, Math.max(0, raw));
  const bin = table[Math.min(BINS - 1, Math.floor(r * BINS))];
  if (!bin || bin.n === 0) return Math.round(r * 100) / 100;
  const v = (bin.correct + r * prior) / (bin.n + prior);
  return Math.round(Math.min(0.99, Math.max(0.01, v)) * 100) / 100;
}

/** Brier score (lower is better, 0.25 = a coin flip at 50%) and expected calibration error */
export function calibrationScore(samples: CalibrationSample[]): { brier: number; ece: number; n: number } {
  const clean = samples.filter((s) => Number.isFinite(s.confidence));
  if (!clean.length) return { brier: 0, ece: 0, n: 0 };
  const brier = clean.reduce((a, s) => a + (s.confidence - (s.correct ? 1 : 0)) ** 2, 0) / clean.length;
  const table = calibrationTable(clean);
  const ece = table.reduce((a, b) => (b.n ? a + (b.n / clean.length) * Math.abs(b.correct / b.n - clean.filter((s) => s.confidence >= b.from && (b.to === 1 ? s.confidence <= 1 : s.confidence < b.to)).reduce((x, s) => x + s.confidence, 0) / b.n) : a), 0);
  return { brier: Math.round(brier * 1000) / 1000, ece: Math.round(ece * 1000) / 1000, n: clean.length };
}

/* ------------------------------------------------------------------------------------------------ prompt block */

/** a compact, honest block for the employee's prompt: what was understood, what is missing, and what to do about it */
export function understandingPrompt(u: Understanding, policy: AskOrAssume, calibratedConfidence: number): string {
  const lines = [
    "PRE-READ OF THE MESSAGE (rule-based, may be wrong — you decide):",
    `- understood request: ${u.intent}${u.runnerUp ? ` (could also be: ${u.runnerUp})` : ""}; urgency ${Math.round(u.urgency * 100)}%; emotion ${u.emotion}; confidence ${Math.round(calibratedConfidence * 100)}%`,
    u.missing.length ? `- missing: ${u.missing.join(", ")}` : "",
    u.entities.amounts.length ? `- amounts mentioned: ${u.entities.amounts.map((a) => a.value).join(", ")}` : "",
    policy.mode === "ask" && policy.question ? `- a wrong guess is ${policy.cost}-cost: ask exactly ONE question: "${policy.question}"` : "",
    policy.mode === "assume" ? `- a wrong guess is cheap: continue, and state your assumptions out loud: ${policy.assumptions.join("; ")}` : "",
    policy.mode === "proceed" ? "- the request is clear enough to proceed" : "",
  ];
  return lines.filter(Boolean).join("\n");
}
