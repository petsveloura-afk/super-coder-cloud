/**
 * Wave 63 — a ready summary for the person who takes over a conversation (pure, unit-tested).
 * Built only from what the customer really wrote (no AI call, nothing invented): what they want,
 * mood and its trend, objections, known details, lead temperature and the recommended next step.
 * Written in the language of the team member (he / en / ar).
 */
import { extractState, analyzeMessage, type Intent, type Lang } from "./intelligence";
import { conversationSignals, leadTemperature, type HistoryMsg, type Objection } from "./brain-pro";
import { moodTrend, sensitiveMoment, unheardSignals, type MoodTrend, type Sensitive } from "./social-intel-core";

type L = Record<Lang, string>;

const INTENT_T: Partial<Record<Intent, L>> = {
  price: { he: "מחיר", en: "price", ar: "السعر" },
  booking: { he: "קביעת תור/פגישה", en: "booking", ar: "حجز موعد" },
  buy: { he: "רכישה", en: "purchase", ar: "شراء" },
  complaint: { he: "תלונה", en: "complaint", ar: "شكوى" },
  refund: { he: "החזר כספי", en: "refund", ar: "استرجاع" },
  cancel: { he: "ביטול", en: "cancellation", ar: "إلغاء" },
  human: { he: "מבקש נציג", en: "asked for a person", ar: "طلب موظفاً" },
  hours: { he: "שעות פעילות", en: "opening hours", ar: "ساعات العمل" },
  location: { he: "כתובת", en: "address", ar: "العنوان" },
  legal: { he: "איום משפטי", en: "legal threat", ar: "تهديد قانوني" },
  info: { he: "מידע", en: "information", ar: "معلومات" },
};
const MOOD_T: Record<string, L> = {
  positive: { he: "חיובי", en: "positive", ar: "إيجابي" },
  neutral: { he: "ענייני", en: "neutral", ar: "عادي" },
  negative: { he: "לא מרוצה", en: "unhappy", ar: "غير راضٍ" },
  angry: { he: "כועס", en: "angry", ar: "غاضب" },
};
const TREND_T: Record<MoodTrend, L> = {
  worsening: { he: "ומחמיר", en: "and getting worse", ar: "ويزداد سوءاً" },
  improving: { he: "ומשתפר", en: "and improving", ar: "ويتحسن" },
  volatile: { he: "ומשתנה", en: "and swinging", ar: "ومتقلب" },
  stable: { he: "", en: "", ar: "" },
  unknown: { he: "", en: "", ar: "" },
};
const OBJ_T: Record<Objection, L> = {
  price: { he: "מחיר", en: "price", ar: "السعر" },
  timing: { he: "תזמון", en: "timing", ar: "التوقيت" },
  trust: { he: "אמון", en: "trust", ar: "الثقة" },
  competitor: { he: "מתחרה", en: "competitor", ar: "منافس" },
  authority: { he: "צריך אישור של אחר", en: "needs someone else's approval", ar: "يحتاج موافقة آخر" },
  fit: { he: "התאמה", en: "fit", ar: "الملاءمة" },
};
const TEMP_T: Record<string, L> = {
  hot: { he: "חם 🔥", en: "hot 🔥", ar: "ساخن 🔥" },
  warm: { he: "פושר", en: "warm", ar: "دافئ" },
  cold: { he: "קר", en: "cold", ar: "بارد" },
};
const SENS_T: Record<Sensitive, L> = {
  loss: { he: "אובדן", en: "a loss", ar: "فقدان" },
  illness: { he: "מחלה", en: "illness", ar: "مرض" },
  financial_hardship: { he: "מצוקה כלכלית", en: "financial hardship", ar: "ضائقة مالية" },
  distress: { he: "מצוקה", en: "distress", ar: "ضيق" },
};
const LABEL = {
  want: { he: "מה הלקוח רוצה", en: "What the customer wants", ar: "ما يريده العميل" },
  mood: { he: "מצב רוח", en: "Mood", ar: "المزاج" },
  obj: { he: "התנגדויות", en: "Objections", ar: "الاعتراضات" },
  known: { he: "פרטים ידועים", en: "Known details", ar: "المعلومات المعروفة" },
  lead: { he: "חום הליד", en: "Lead temperature", ar: "حرارة العميل المحتمل" },
  last: { he: "ההודעה האחרונה", en: "Last message", ar: "آخر رسالة" },
  next: { he: "הצעד המומלץ", en: "Recommended next step", ar: "الخطوة المقترحة" },
  care: { he: "שימו לב: רגע רגיש", en: "Careful: sensitive moment", ar: "انتبه: لحظة حساسة" },
  none: { he: "לא נמסר", en: "not given", ar: "غير معروف" },
} satisfies Record<string, L>;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export interface HandoffSummaryInput {
  history: HistoryMsg[];
  lang: Lang;
  /** why the agent handed over (e.g. "angry_customer", "customer_asked") */
  reason?: string | null;
}

export interface HandoffSummary {
  /** plain text, ready for the notification */
  text: string;
  nextStep: string;
  temperature: "hot" | "warm" | "cold";
}

/** The recommended next step for the person, from what really happened. */
export function nextStepFor(input: { intents: Intent[]; mood: string; trend: MoodTrend; objections: Objection[]; temperature: string; sensitive: Sensitive | null; unheard: boolean; hasContact: boolean; reason?: string | null; lang: Lang }): string {
  const s = (he: string, en: string, ar: string) => ({ he, en, ar })[input.lang];
  if (input.intents.includes("legal")) return s("לענות בעצמך היום, בטון רגוע ובלי להודות באשמה; להעביר להנהלה.", "Reply yourself today, calmly and without admitting fault; inform management.", "ردّ بنفسك اليوم بهدوء ودون الاعتراف بالذنب؛ أبلغ الإدارة.");
  if (input.sensitive) return s("לפנות בחום ובאנושיות, בלי למכור; להציע גמישות.", "Reach out warmly and humanly, no selling; offer flexibility.", "تواصل بدفء وإنسانية دون بيع؛ اعرض المرونة.");
  if (input.mood === "angry" || input.trend === "worsening") return s("להתקשר או לכתוב תוך שעה: להתנצל, לחזור על מה שהלקוח אמר ולהציע פתרון קונקרטי אחד.", "Call or write within the hour: apologise, restate what the customer said and offer one concrete fix.", "اتصل أو اكتب خلال ساعة: اعتذر، أعد ما قاله العميل واعرض حلاً واحداً محدداً.");
  if (input.unheard) return s("לפתוח בסיכום של מה שכבר נאמר, ולא לשאול שוב.", "Open by summarising what was already said; do not ask again.", "ابدأ بتلخيص ما قيل سابقاً ولا تسأل من جديد.");
  if (input.intents.includes("refund") || input.intents.includes("cancel")) return s("לברר את הסיבה, להציע פתרון לפני ביטול, ולאסוף פרטי הזמנה.", "Find the reason, offer a fix before cancelling, collect order details.", "اعرف السبب واعرض حلاً قبل الإلغاء واجمع تفاصيل الطلب.");
  if (input.temperature === "hot") return s("ליצור קשר עכשיו ולסגור: אישור פרטים, מחיר והצעד הבא (תשלום או תור).", "Contact now and close: confirm details, price and the next step (payment or appointment).", "تواصل الآن وأغلق الصفقة: أكّد التفاصيل والسعر والخطوة التالية (دفع أو موعد).");
  if (input.objections.includes("price")) return s("להציג ערך ואפשרויות (חבילה קטנה/תשלומים אם קיימים), בלי להמציא הנחה.", "Show value and options (smaller package / instalments if they exist); do not invent a discount.", "اعرض القيمة والخيارات (باقة أصغر/تقسيط إن وُجد) دون اختلاق خصم.");
  if (!input.hasContact) return s("לבקש טלפון או מייל ולהתחיל מהשאלה האחרונה של הלקוח.", "Ask for a phone or e-mail and start from the customer's last question.", "اطلب هاتفاً أو بريداً وابدأ من آخر سؤال للعميل.");
  return s("לענות על השאלה האחרונה ולהציע צעד אחד ברור.", "Answer the last question and offer one clear step.", "أجب عن آخر سؤال واقترح خطوة واحدة واضحة.");
}

export function buildHandoffSummary(input: HandoffSummaryInput): HandoffSummary {
  const { lang } = input;
  const users = input.history.filter((m) => m.role === "user");
  const lastText = users[users.length - 1]?.content ?? "";
  const state = extractState(input.history);
  const sig = conversationSignals(input.history);
  const temp = leadTemperature(input.history);
  const trend = moodTrend(input.history);
  const mood = analyzeMessage(lastText).mood;
  const sensitive = users.map((m) => sensitiveMoment(m.content)).filter(Boolean).pop() ?? null;
  const unheard = unheardSignals(lastText).unheard;
  const intents = state.intents.filter((i) => INTENT_T[i]);

  const known = [state.name, state.phone, state.email, state.username ? `@${state.username}` : ""].filter(Boolean).join(" · ");
  const next = nextStepFor({ intents: state.intents, mood, trend: trend.trend, objections: sig.objections, temperature: temp.temperature, sensitive, unheard, hasContact: Boolean(state.phone || state.email), reason: input.reason, lang });

  const lines: string[] = [];
  lines.push(`${LABEL.want[lang]}: ${intents.length ? intents.map((i) => INTENT_T[i]![lang]).join(", ") : LABEL.none[lang]}`);
  lines.push(`${LABEL.mood[lang]}: ${MOOD_T[mood]![lang]} ${TREND_T[trend.trend][lang]}`.trim());
  if (sensitive) lines.push(`${LABEL.care[lang]}: ${SENS_T[sensitive][lang]}`);
  if (sig.objections.length) lines.push(`${LABEL.obj[lang]}: ${sig.objections.map((o) => OBJ_T[o][lang]).join(", ")}`);
  lines.push(`${LABEL.known[lang]}: ${known || LABEL.none[lang]}`);
  lines.push(`${LABEL.lead[lang]}: ${TEMP_T[temp.temperature]![lang]}`);
  if (lastText) lines.push(`${LABEL.last[lang]}: ${clip(lastText, 220)}`);
  lines.push(`${LABEL.next[lang]}: ${next}`);
  return { text: lines.join("\n"), nextStep: next, temperature: temp.temperature };
}
