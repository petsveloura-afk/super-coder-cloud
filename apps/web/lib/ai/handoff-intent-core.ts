/**
 * Understanding WHEN a customer really wants a person (pure, unit-tested).
 *
 * A bare keyword is not an intent: "אני לא צריך נציג", "הנציג שלכם עזר לי מאוד" or "I'm a lawyer and I need a website" must
 * not pass a conversation to the team. The rules here read the sentence — a request, a negation, a story about the past —
 * and when it is genuinely unclear they return "maybe", so the AI agent decides from the whole conversation (it already
 * ends its reply with [[HANDOFF]] when a person is really needed, by the business's own hand-over rules).
 */
import { wantsHuman } from "./autopilot-core";
import { isAngry } from "./guardrails";

export type HumanRequest = "yes" | "maybe" | "no";

const NEGATED = [
  /(?:^|\s)(?:לא|אל|בלי|ללא|אין\s+צורך|אין\s+לי\s+צורך)\s+(?:\S+\s+){0,3}?(?:נציג|נציגה|בן\s*אדם|אדם\s*אמיתי|מישהו\s*אמיתי|מנהל)/,
  /\b(?:no|not|don'?t|do\s+not|doesn'?t|without|never|no\s+need\s+for)\b[^.!?\n]{0,30}\b(?:human|real\s+person|person|representative|live\s+agent|agent|manager)\b/i,
  /(?:^|\s)(?:لا|بدون|ما)\s+(?:\S+\s+){0,3}?(?:ممثل|موظف|شخص|إنسان)/,
];
/** a story about something that already happened / a compliment, not a request */
const ABOUT_THE_PAST = [
  /(?:דיברתי|שוחחתי|התכתבתי|ענה\s+לי|ענתה\s+לי|עזר\s+לי|עזרה\s+לי|הנציג\s+שלכם|הנציגה\s+שלכם|הנציג\s+ש|הנציגה\s+ש|אמר\s+לי\s+(?:ה)?נציג|היה\s+נציג)/,
  /\b(?:i\s+(?:talked|spoke|chatted)\s+(?:to|with)|the\s+(?:representative|agent|person)\s+(?:said|told|helped|was|gave)|your\s+(?:representative|agent)\s+(?:said|told|helped|was))\b/i,
  /(?:تحدثت\s+مع|كلمت|ساعدني|قال\s+لي)/,
];
/** a wish / a request near the mention of a person */
const ASKING = [
  /(?:רוצה|צריך|צריכה|מבקש|מבקשת|מעוניין|מעוניינת|אפשר|ניתן|תעביר\S*|תחבר\S*|העבר\S*|חבר\S*|תן\s+לי|תנו\s+לי|אשמח|תתקשר\S*|שיחזור|שיחזרו|שיתקשר\S*|לדבר|לשוחח|לפנות|דחוף|בבקשה|מיד|עכשיו)/,
  /\b(?:want|need|talk|speak|connect|transfer|get\s+me|let\s+me|can\s+i|could\s+i|may\s+i|please|call\s+me|pass\s+me|put\s+me|i'?d\s+like|escalate)\b/i,
  /(?:أريد|اريد|أبغى|ابغى|بدي|ممكن|حولني|تحويل|أتكلم|اتكلم|أتحدث|التحدث|رجاء|من\s+فضلك|أحتاج|احتاج)/,
];

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** does this message really ask for a person? yes → hand over now; maybe → the AI decides from context; no → keep talking */
export function humanRequest(text: string | null | undefined): HumanRequest {
  const t = (text ?? "").slice(0, 500).trim();
  if (!t || !wantsHuman(t)) return "no";
  if (NEGATED.some((r) => r.test(t))) return "no";
  const asking = ASKING.some((r) => r.test(t));
  if (ABOUT_THE_PAST.some((r) => r.test(t)) && !asking) return "no";
  if (asking) return "yes";
  // a bare "נציג" / "נציג בבקשה" / "human" — the way people actually type it
  if (words(t) <= 4) return "yes";
  return "maybe";
}

/** shown to the AI (never to the customer) when the customer mentioned a person but it is not clear they are asking for one */
export function humanMaybeHint(locale: string): string {
  if (locale === "en") return "The customer mentioned a person / representative, but it may not be a request for one. Decide from the whole conversation: if they really want to speak with a person, answer kindly and end with [[HANDOFF]]; otherwise just answer their message normally and do not hand over.";
  if (locale === "ar") return "ذكر العميل شخصًا / ممثلًا لكن قد لا يكون يطلبه فعلًا. قرّر من سياق المحادثة كلها: إن كان يريد فعلًا التحدث مع شخص فأجبه بلطف وأنهِ ردك بـ [[HANDOFF]]؛ وإلا فأجب عن رسالته بشكل طبيعي دون تحويل.";
  return "הלקוח הזכיר נציג / אדם, אבל לא בטוח שהוא מבקש אחד. החלט לפי כל השיחה: אם הוא באמת רוצה לדבר עם אדם, ענה בחום וסיים ב-[[HANDOFF]]; אחרת פשוט ענה על ההודעה שלו כרגיל ואל תעביר.";
}

/** phrases that look angry to a keyword list but are not: a profession, "we could" (נוכל), a denied feeling */
const BENIGN_ANGER = [
  /אני\s+(?:עורך|עורכת)\s*דין/g,
  /אני\s+עו"ד/g,
  /\bi(?:'m|\s+am)\s+a\s+(?:lawyer|attorney)\b/gi,
  /\bmy\s+(?:\w+\s+)?(?:is|works\s+as)\s+a\s+lawyer\b/gi,
  /(?:אני\s+)?לא\s+(?:כועס|כועסת|עצבני|עצבנית|מאוכזב|מאוכזבת)/g,
  /\bi(?:'m|\s+am)\s+not\s+(?:angry|furious)\b/gi,
  /נוכל\s+[לבמ]\S*/g, // "נוכל להגיע" (we will be able to) is not "נוכל" (a scammer)
  /\bworst[\s-]case\b/gi,
];

/** an angry / threatening customer who really needs a person — the same detector as before, minus the harmless look-alikes */
export function angerNeedsPerson(text: string | null | undefined): boolean {
  let t = text ?? "";
  if (!isAngry(t)) return false;
  for (const r of BENIGN_ANGER) t = t.replace(r, " ");
  return isAngry(t);
}
