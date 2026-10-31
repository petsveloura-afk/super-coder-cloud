/**
 * Wave 59 — smart review requests (pure, unit-tested).
 *
 * Instead of sending the review link to everyone, the customer is first asked how it was (1–5).
 * Happy customers (4–5 / clearly positive) get the review link; unhappy ones (1–3 / clearly negative)
 * get an apology and the owner is alerted at once — so problems are fixed privately, not in public.
 */

type Loc = "he" | "en" | "ar";

/** The customer's answer → a rating 1–5 (digits, stars, words, emoji), or null when it is not an answer. */
export function parseRating(text: string): number | null {
  const t = text.trim();
  if (!t || t.length > 300) return null;
  const stars = (t.match(/⭐|★/g) ?? []).length;
  if (stars >= 1 && stars <= 5) return stars;
  const digit = /(^|[^\d])([1-5])(\s*(\/\s*5|מתוך\s*5|out of 5))?([^\d]|$)/.exec(t);
  if (digit && t.replace(/[^\d]/g, "").length <= 2) return Number(digit[2]);
  const low = t.toLowerCase();
  if (/(גרוע|נורא|לא מרוצה|מאכזב|אכזבה|לא טוב|רע מאוד|terrible|awful|bad|disappoint|not happy|unhappy|سيء|سيئ|غير راض|مخيب)/i.test(low) || /😡|😠|👎|😞|😢/.test(t)) return 2;
  if (/(מעולה|מושלם|מדהים|אחלה|מצוין|מרוצה מאוד|תודה רבה|הכי טוב|excellent|perfect|amazing|great|awesome|loved|ممتاز|رائع|مذهل)/i.test(low) || /😍|🤩|❤️|👍|🙏|😊/.test(t)) return 5;
  if (/(בסדר|סביר|ok|okay|fine|عادي|مقبول)/i.test(low)) return 3;
  return null;
}

export function isPositive(rating: number): boolean {
  return rating >= 4;
}

const L = (locale: string): Loc => (locale === "en" || locale === "ar" ? locale : "he");

/** Step 1: "how was it?" (no link yet). */
export function ratingQuestion(locale: string, input: { name: string | null; org: string }): string {
  const n = input.name?.trim();
  return {
    he: `היי${n ? ` ${n}` : ""} 😊 תודה שבחרת ב${input.org}! איך היה לך? נשמח לדירוג קצר מ-1 עד 5 (5 = מעולה).`,
    en: `Hi${n ? ` ${n}` : ""} 😊 thank you for choosing ${input.org}! How was it? A quick rating from 1 to 5 would mean a lot (5 = excellent).`,
    ar: `مرحباً${n ? ` ${n}` : ""} 😊 شكراً لاختيارك ${input.org}! كيف كانت تجربتك؟ يسعدنا تقييم سريع من 1 إلى 5 (5 = ممتاز).`,
  }[L(locale)];
}

/** Step 2a: happy → the review link. */
export function positiveReply(locale: string, url: string | null): string {
  if (!url) return { he: "איזה כיף לשמוע! 🙏 תודה רבה, נשמח לראות אותך שוב.", en: "So happy to hear that! 🙏 Thank you — see you again soon.", ar: "يسعدنا سماع ذلك! 🙏 شكراً جزيلاً، نتمنى رؤيتك مجدداً." }[L(locale)];
  return {
    he: `איזה כיף לשמוע! 🙏 זה יעזור לנו מאוד אם תשתף/י את זה גם בביקורת קצרה — לוקח דקה:\n${url}`,
    en: `So happy to hear that! 🙏 It would help us a lot if you shared it in a short review — it takes a minute:\n${url}`,
    ar: `يسعدنا سماع ذلك! 🙏 سيساعدنا كثيراً لو شاركت ذلك في تقييم قصير — يستغرق دقيقة:\n${url}`,
  }[L(locale)];
}

/** Step 2b: unhappy → apology, the owner takes it personally. */
export function negativeReply(locale: string): string {
  return {
    he: "מצטערים מאוד לשמוע 😔 חשוב לנו לתקן — בעל העסק יחזור אליך בהקדם באופן אישי. נשמח לשמוע מה לא היה טוב.",
    en: "We're really sorry to hear that 😔 We want to make it right — the owner will get back to you personally soon. We'd love to hear what went wrong.",
    ar: "نأسف جداً لسماع ذلك 😔 يهمنا إصلاح الأمر — سيتواصل معك صاحب العمل شخصياً قريباً. يسعدنا معرفة ما لم يكن جيداً.",
  }[L(locale)];
}

/** An asked gate expires after 3 days (later messages are ordinary conversation again). */
export const GATE_DAYS = 3;
