/**
 * Wave 63 — extra self-checks for the agent's answer (pure, unit-tested). They run IN ADDITION to
 * `checkReply` (intelligence.ts) — nothing there is weakened. The result only ever adds one more
 * correction attempt; it never blocks a reply by itself.
 */
import { detectLanguage, type Lang, type Mood } from "./intelligence";

export type QualityIssue = "invented_discount" | "warranty_promise" | "invented_eta" | "robotic" | "wrong_language" | "emoji_to_upset" | "too_long" | "selling_to_upset";

const EMOJI = /\p{Extended_Pictographic}/u;

/** every number in the text, digits only (to compare with the business facts) */
function numbers(text: string): Set<string> {
  return new Set([...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(/,/g, "")));
}

const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s*(?:%|אחוז|percent|بالمئة|٪)/gi;
const WARRANTY_PROMISE = /(?:יש\s*(?:לנו|לכם)?\s*)?אחריות\s*(?:מלאה|של|ל|עד)|מובטח\s*ש|אנו\s*מבטיחים|אני\s*מבטיח(?:ה)?|\b(?:fully guaranteed|we guarantee|i guarantee|lifetime warranty|money[- ]back guarantee)\b|نضمن\s*لك|ضمان\s*(?:كامل|مدى)/i;
const WARRANTY_FACT = /אחריות|ערבות|warranty|guarantee|ضمان/i;
const ETA_PROMISE = /(?:תוך|בתוך)\s*(?:\d+|שעה|שעתיים|יום|יומיים|שלושה?\s*ימים|דקות)\s*(?:דקות|שעות|ימים|ימי\s*עסקים|שעה|יום)?|עוד\s*(?:מעט|דקה|רגע)\s*(?:אחזור|נחזור)|\b(?:within \d+\s*(?:minutes?|hours?|days?|business days)|in \d+\s*(?:minutes?|hours?)|within the hour|same[- ]day|by tomorrow)\b|خلال\s*(?:\d+|ساعة|يوم|دقائق)/i;
const ROBOTIC = /כמודל\s*שפה|כבינה\s*מלאכותית|אני\s*כאן\s*כדי\s*לעזור\s*לך\s*בכל\s*שאלה|אשמח\s*לסייע\s*לך\s*בכל\s*נושא|\b(?:as an ai(?: language model)?|i am an ai|i'?m here to help you with any (?:question|inquiry)|is there anything else i can (?:help|assist) you with today)\b|كنموذج\s*لغوي|بصفتي\s*ذكاء/i;
const SELLING = /(?:רק\s*היום|מבצע\s*מוגבל|הזדמנות\s*אחרונה|אל\s*תפספס|נשארו\s*\d+\s*(?:יחידות|מקומות))|\b(?:limited[- ]time|last chance|don'?t miss|act now|only \d+ left)\b|فرصة\s*أخيرة|لا\s*تفوّت/i;

/** Percentages in the reply that appear nowhere in the business facts or in what the customer wrote (as written, e.g. "20%"). */
export function inventedPercents(reply: string, facts: string, customerText = ""): string[] {
  const known = numbers(`${facts}\n${customerText}`);
  const out: string[] = [];
  for (const m of (reply ?? "").matchAll(PERCENT)) if (!known.has((m[1] ?? "").replace(/,/g, ""))) out.push(m[0]);
  return [...new Set(out)];
}

export interface QualityInput {
  reply: string;
  customerText: string;
  facts: string;
  mood: Mood;
  /** the customer's language (from the latest message), if known */
  customerLang: Lang | null;
  /** the mood trend is worsening / a sensitive moment (no selling, no emoji) */
  careful?: boolean;
}

export function qualityIssues(input: QualityInput): QualityIssue[] {
  const reply = (input.reply ?? "").trim();
  if (!reply) return [];
  const issues: QualityIssue[] = [];
  const known = numbers(`${input.facts}\n${input.customerText}`);

  // a percentage / discount the business never gave
  if (inventedPercents(reply, input.facts, input.customerText).length) issues.push("invented_discount");

  if (WARRANTY_PROMISE.test(reply) && !WARRANTY_FACT.test(input.facts)) issues.push("warranty_promise");

  // a response time the business never stated ("within 2 hours")
  const eta = reply.match(ETA_PROMISE)?.[0];
  if (eta) {
    const etaNums = [...(eta.match(/\d+/g) ?? [])];
    const supported = etaNums.length ? etaNums.every((n) => known.has(n)) : /שעה|שעתיים|יום|יומיים|hour|day|ساعة|يوم/i.test(input.facts);
    if (!supported) issues.push("invented_eta");
  }

  if (ROBOTIC.test(reply)) issues.push("robotic");

  // the answer is in another language than the customer wrote (only when both are clear)
  const letters = (reply.match(/\p{L}/gu) ?? []).length;
  const customerLetters = (input.customerText.match(/\p{L}/gu) ?? []).length;
  if (input.customerLang && letters >= 30 && customerLetters >= 8) {
    const replyLang = detectLanguage(reply);
    if (replyLang && replyLang !== input.customerLang) issues.push("wrong_language");
  }

  const upset = input.mood === "angry" || input.mood === "negative" || input.careful;
  if (upset && EMOJI.test(reply)) issues.push("emoji_to_upset");
  if (upset && SELLING.test(reply)) issues.push("selling_to_upset");

  // a very long answer to a very short message (chat, not e-mail)
  const customerWords = (input.customerText.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const replyWords = (reply.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  if (customerWords > 0 && customerWords <= 4 && replyWords > 90) issues.push("too_long");

  return issues;
}

/** One correction message that covers the base check's issues and the new ones together. */
export function qualityCorrectionLines(issues: QualityIssue[], lang: Lang | null): string[] {
  const out: string[] = [];
  if (issues.includes("invented_discount")) out.push("- it mentioned a percentage / discount that is not in the business information. Remove it, or say you will check with the team.");
  if (issues.includes("warranty_promise")) out.push("- it promised a warranty / guarantee the business information does not state. Do not promise it; say you will check.");
  if (issues.includes("invented_eta")) out.push("- it promised a response or delivery time that the business information does not state. Do not give a time you cannot keep; say when the team usually answers only if the information says so.");
  if (issues.includes("robotic")) out.push("- it sounded robotic. Write like a real, warm person from the business; never mention being an AI model.");
  if (issues.includes("wrong_language")) out.push(`- it was not in the customer's language. Write the whole answer in ${lang === "he" ? "Hebrew" : lang === "ar" ? "Arabic" : "English"}.`);
  if (issues.includes("emoji_to_upset")) out.push("- it used emoji with a customer who is upset or in a sensitive moment. Use none.");
  if (issues.includes("selling_to_upset")) out.push("- it pushed a sale on a customer who is upset or in a sensitive moment. Drop the sales language and help first.");
  if (issues.includes("too_long")) out.push("- it was far too long for a very short message. Answer in 1-3 short sentences.");
  return out;
}

/** Same shape as `correctionPrompt` (intelligence.ts) but also lists the new issues. */
export function combinedCorrectionPrompt(base: string, issues: QualityIssue[], lang: Lang | null): string {
  const extra = qualityCorrectionLines(issues, lang);
  if (!extra.length) return base;
  // `base` ends with the "Write the corrected reply now…" line; the new bullets go before it
  const lines = base.split("\n");
  const tail = lines.pop() ?? "";
  const hasBullets = lines.some((l) => l.startsWith("- "));
  const head = hasBullets ? lines : ["(system) Your previous draft was not sent because:"];
  return [...head, ...extra, tail].join("\n");
}
