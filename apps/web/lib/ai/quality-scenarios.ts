/**
 * Wave 69 — a fixed set of answer-quality scenarios for the agents (pure, NO AI call). Each one is a real-looking situation
 * (customer message, business facts, the draft reply) and the exact set of issues `qualityIssues` must find. They run as unit
 * tests, so a change to the checks that lets an invented discount / warranty / time through, or flags a good answer, fails CI.
 */
import { combinedCorrectionPrompt, qualityIssues, type QualityInput, type QualityIssue } from "./reply-quality-core";

export type ScenarioGroup = "price" | "warranty" | "eta" | "language" | "empathy" | "robotic" | "length" | "clean" | "combined";
export type ScenarioLang = "he" | "en" | "ar";

export interface QualityScenario {
  id: string;
  group: ScenarioGroup;
  lang: ScenarioLang;
  title: string;
  input: QualityInput;
  expect: QualityIssue[];
}

const HE_FACTS = "תספורת 120 ש״ח. צבע 350 ש״ח. שעות פעילות 9:00-18:00.";
const EN_FACTS = "Haircut 120 NIS. Colour 350 NIS. Opening hours 9:00-18:00.";
const AR_FACTS = "قصة شعر 120 شيكل. صبغة 350 شيكل. ساعات العمل 9:00-18:00.";
const FACTS: Record<ScenarioLang, string> = { he: HE_FACTS, en: EN_FACTS, ar: AR_FACTS };

function mk(id: string, group: ScenarioGroup, lang: ScenarioLang, title: string, input: Partial<QualityInput> & { reply: string }, expectIssues: QualityIssue[] = []): QualityScenario {
  return { id, group, lang, title, input: { customerText: "", facts: FACTS[lang], mood: "neutral", customerLang: lang, ...input }, expect: expectIssues };
}

const WORDS_95 = Array.from({ length: 95 }, () => "תספורת").join(" ");
const WORDS_20 = Array.from({ length: 20 }, () => "תספורת").join(" ");
const WORDS_120 = Array.from({ length: 120 }, () => "תספורת").join(" ");

export const QUALITY_SCENARIOS: QualityScenario[] = [
  // ---- no invented price / discount (9)
  mk("p-he-invented", "price", "he", "Hebrew: a 20% discount nobody gave", { reply: "יש לנו 20% הנחה היום", customerText: "כמה עולה תספורת" }, ["invented_discount"]),
  mk("p-he-real-price", "price", "he", "Hebrew: the real price is fine", { reply: "תספורת עולה 120 ש״ח", customerText: "כמה עולה תספורת" }),
  mk("p-he-fact-discount", "price", "he", "Hebrew: a discount the business stated is fine", { reply: "יש הנחת סטודנטים של 10%", facts: "הנחת סטודנטים 10%", customerText: "יש הנחה לסטודנטים" }),
  mk("p-he-customer-mentioned", "price", "he", "Hebrew: the customer's own number is not an invention", { reply: "אבדוק מול הצוות לגבי ה-15% ואחזור אליך", customerText: "שמעתי שיש 15% הנחה" }),
  mk("p-he-word-percent", "price", "he", "Hebrew: '10 אחוז הנחה' is a percentage too", { reply: "אפשר לתת לך 10 אחוז הנחה", customerText: "אפשר הנחה" }, ["invented_discount"]),
  mk("p-en-invented", "price", "en", "English: 30% off nobody gave", { reply: "We can give you 30% off your first visit.", customerText: "How much is a haircut?" }, ["invented_discount"]),
  mk("p-en-decimal", "price", "en", "English: a decimal percentage is caught", { reply: "You get 12.5% off today.", customerText: "Any deals?" }, ["invented_discount"]),
  mk("p-ar-invented", "price", "ar", "Arabic: a 25 percent discount nobody gave", { reply: "لدينا خصم 25 بالمئة اليوم", customerText: "كم سعر قصة الشعر" }, ["invented_discount"]),
  mk("p-ar-real-price", "price", "ar", "Arabic: the real price is fine", { reply: "قصة الشعر بـ 120 شيكل", customerText: "كم سعر قصة الشعر" }),

  // ---- no invented warranty (6)
  mk("w-he-invented", "warranty", "he", "Hebrew: a full warranty nobody gave", { reply: "יש לנו אחריות מלאה על הצבע", customerText: "יש אחריות על הצבע?" }, ["warranty_promise"]),
  mk("w-he-fact", "warranty", "he", "Hebrew: a warranty the business stated is fine", { reply: "יש אחריות של 30 יום על הצבע", facts: "אחריות 30 יום על צבע", customerText: "יש אחריות על הצבע?" }),
  mk("w-en-we-guarantee", "warranty", "en", "English: 'we guarantee' without a basis", { reply: "We guarantee the result will be perfect.", customerText: "Will it look good?" }, ["warranty_promise"]),
  mk("w-en-i-guarantee", "warranty", "en", "English: 'I guarantee' without a basis", { reply: "I guarantee you will love it.", customerText: "Is it worth it?" }, ["warranty_promise"]),
  mk("w-ar-invented", "warranty", "ar", "Arabic: 'نضمن لك' without a basis", { reply: "نضمن لك النتيجة", customerText: "هل في ضمان" }, ["warranty_promise"]),
  mk("w-he-checks", "warranty", "he", "Hebrew: 'I will check with the team' is the right answer", { reply: "אבדוק עם הצוות אם יש אחריות ואחזור אליך", customerText: "יש אחריות על הצבע?" }),

  // ---- no invented response time (6)
  mk("e-he-invented", "eta", "he", "Hebrew: 'within two hours' nobody promised", { reply: "נחזור אליך תוך שעתיים", customerText: "מתי תחזרו אליי" }, ["invented_eta"]),
  mk("e-he-fact", "eta", "he", "Hebrew: a time the business stated is fine", { reply: "נחזור אליך תוך שעתיים", facts: "מענה תוך שעתיים בימי חול", customerText: "מתי תחזרו אליי" }),
  mk("e-en-invented", "eta", "en", "English: 'within 2 hours' nobody promised", { reply: "We'll call you within 2 hours.", customerText: "When will you call?" }, ["invented_eta"]),
  mk("e-en-fact", "eta", "en", "English: a stated time is fine", { reply: "We usually reply within 2 hours.", facts: "We reply within 2 hours on weekdays.", customerText: "When will you reply?" }),
  mk("e-ar-invented", "eta", "ar", "Arabic: 'within an hour' nobody promised", { reply: "سنرد عليك خلال ساعة", customerText: "متى ترد" }, ["invented_eta"]),
  mk("e-he-no-time", "eta", "he", "Hebrew: no promised time is fine", { reply: "העברתי את הפנייה לצוות והם יחזרו אליך", customerText: "מתי תחזרו אליי" }),

  // ---- the customer's language (6)
  mk("l-he-gets-en", "language", "he", "A Hebrew customer gets an English answer", { reply: "Hello, we would be happy to schedule a haircut appointment for you.", customerText: "שלום, אני רוצה לקבוע תור לתספורת" }, ["wrong_language"]),
  mk("l-en-gets-he", "language", "en", "An English customer gets a Hebrew answer", { reply: "שלום, נשמח לקבוע לך תור לתספורת בימים הקרובים בשעות הפעילות שלנו", customerText: "Hi I would like to book an appointment" }, ["wrong_language"]),
  mk("l-ar-gets-he", "language", "ar", "An Arabic customer gets a Hebrew answer", { reply: "שלום, נשמח לקבוע לך תור לתספורת בימים הקרובים בשעות הפעילות שלנו", customerText: "مرحبا اريد حجز موعد" }, ["wrong_language"]),
  mk("l-he-ok", "language", "he", "Hebrew to a Hebrew customer is fine", { reply: "שלום, נשמח לקבוע לך תור לתספורת בימים הקרובים בשעות הפעילות שלנו", customerText: "שלום, אני רוצה לקבוע תור לתספורת" }),
  mk("l-short-unclear", "language", "he", "A very short customer message is not enough to judge", { reply: "Hello, we would be happy to schedule a haircut appointment for you.", customerText: "היי" }),
  mk("l-unknown", "language", "he", "No known customer language: nothing to compare", { reply: "Hello, we would be happy to schedule a haircut appointment for you.", customerText: "שלום, אני רוצה לקבוע תור לתספורת", customerLang: null }),

  // ---- empathy with an angry / upset customer (8)
  mk("m-angry-emoji", "empathy", "he", "Emoji to an angry customer", { reply: "מצטערים על אי הנוחות 😊 נטפל בזה", mood: "angry", customerText: "זה פשוט נורא" }, ["emoji_to_upset"]),
  mk("m-angry-selling", "empathy", "he", "A sales push on an angry customer", { reply: "מצטערים. אל תפספס את המבצע שלנו", mood: "angry", customerText: "זה פשוט נורא" }, ["selling_to_upset"]),
  mk("m-angry-good", "empathy", "he", "A calm, helpful answer to an angry customer", { reply: "אני מצטערת שחווית את זה. אבדוק עם הצוות ואחזור אליך.", mood: "angry", customerText: "זה פשוט נורא" }),
  mk("m-neutral-emoji", "empathy", "he", "Emoji to a neutral customer is fine", { reply: "בשמחה, נקבע לך תור 😊", customerText: "אפשר תור" }),
  mk("m-careful-emoji", "empathy", "he", "Emoji in a sensitive moment (careful)", { reply: "נשמח לעזור 😊", careful: true, customerText: "אפשר לדבר על ההזמנה" }, ["emoji_to_upset"]),
  mk("m-negative-limited", "empathy", "en", "'Limited-time' pushed on an unhappy customer", { reply: "Sorry about that. This is a limited-time offer, act now!", mood: "negative", customerText: "I am not happy" }, ["selling_to_upset"]),
  mk("m-positive-selling", "empathy", "en", "A friendly offer to a happy customer is fine", { reply: "Glad you liked it! There is a limited-time offer on colour this week.", mood: "positive", customerText: "I loved it" }),
  mk("m-angry-both", "empathy", "he", "Emoji and a sales push on an angry customer", { reply: "סליחה 😊 אל תפספס את ההזדמנות שלנו", mood: "angry", customerText: "זה פשוט נורא" }, ["emoji_to_upset", "selling_to_upset"]),

  // ---- sounds like a person, not a machine (5)
  mk("r-he-model", "robotic", "he", "Hebrew: 'as a language model'", { reply: "כמודל שפה אני לא יכול לענות על זה", customerText: "כמה זה עולה" }, ["robotic"]),
  mk("r-en-as-ai", "robotic", "en", "English: 'as an AI language model'", { reply: "As an AI language model, I cannot answer that.", customerText: "How much?" }, ["robotic"]),
  mk("r-en-anything-else", "robotic", "en", "English: the canned closing line", { reply: "Your booking is set. Is there anything else I can help you with today?", customerText: "Book me in" }, ["robotic"]),
  mk("r-ar-model", "robotic", "ar", "Arabic: 'as a language model'", { reply: "كنموذج لغوي لا أستطيع الإجابة", customerText: "كم السعر" }, ["robotic"]),
  mk("r-he-warm", "robotic", "he", "Hebrew: a warm, human answer", { reply: "שמחה לעזור! תספורת עולה 120 ש״ח, מתי נוח לך?", customerText: "כמה עולה תספורת" }),

  // ---- length matches the message (3)
  mk("t-short-long", "length", "he", "A 95-word answer to a one-word message", { reply: WORDS_95, customerText: "היי" }, ["too_long"]),
  mk("t-short-short", "length", "he", "A short answer to a one-word message", { reply: WORDS_20, customerText: "היי" }),
  mk("t-long-long", "length", "he", "A long answer to a real question is fine", { reply: WORDS_120, customerText: "שלום אני רוצה לדעת מה המחירים של התספורות אצלכם בבקשה" }),

  // ---- clean and combined (4)
  mk("c-empty", "clean", "he", "An empty draft has no issues", { reply: "   " }),
  mk("c-plain-he", "clean", "he", "A plain correct Hebrew answer", { reply: "שלום! אנחנו פתוחים בין 9:00 ל-18:00. איך אפשר לעזור?", customerText: "מה שעות הפעילות" }),
  mk("c-plain-en", "clean", "en", "A plain correct English answer", { reply: "Hi! We are open from 9:00 to 18:00. How can I help?", customerText: "What are your opening hours?" }),
  mk("x-everything", "combined", "he", "Wrong language, invented discount, warranty and emoji to an angry customer", { reply: "We are so sorry! Enjoy 20% off your next visit 😊 and we guarantee a fast fix.", mood: "angry", customerText: "השירות היה נורא ואני מאוד כועס עליכם" }, ["invented_discount", "warranty_promise", "wrong_language", "emoji_to_upset"]),
];

export interface ScenarioResult { id: string; group: ScenarioGroup; lang: ScenarioLang; title: string; pass: boolean; got: QualityIssue[]; expect: QualityIssue[] }

/** Runs every scenario through the real checks. */
export function runQualityScenarios(list: QualityScenario[] = QUALITY_SCENARIOS): ScenarioResult[] {
  return list.map((s) => {
    const got = [...qualityIssues(s.input)].sort();
    const want = [...s.expect].sort();
    return { id: s.id, group: s.group, lang: s.lang, title: s.title, pass: JSON.stringify(got) === JSON.stringify(want), got, expect: want };
  });
}

/** The correction prompt for a scenario's issues (used to check the correction text never drops a base line). */
export function scenarioCorrection(s: QualityScenario, base: string): string {
  return combinedCorrectionPrompt(base, qualityIssues(s.input), s.input.customerLang);
}
