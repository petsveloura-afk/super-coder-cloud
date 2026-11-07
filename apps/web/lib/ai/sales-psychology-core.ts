/**
 * Sales psychology engine (additive, pure — no I/O, no AI call, unit-tested).
 *
 * Sits ON TOP of the existing sales brain (brain-pro: objections, buying signals, stage, temperature) and gives the
 * conversation agent three more things, every message, in under a millisecond:
 *
 *   1. A numeric sentiment score for the customer's message, from -1.0 (furious) to 1.0 (delighted), in Hebrew, English and
 *      Arabic (lexicon + negation + intensifiers + emoji + shouting), and the TREND over the last customer messages
 *      (improving / declining / stable).
 *   2. Deep objections: an objection the customer raised before and raises AGAIN is "deep" — the previous answer did not
 *      resolve it, so the agent must change approach instead of repeating itself.
 *   3. An adaptive persuasion plan: which proven sales tactics fit THIS moment — value anchoring, risk reversal, social proof,
 *      urgency framing, empathy first, a smaller next step — ordered by fit, each with strict honesty guardrails
 *      (only real facts of the business: no invented reviews, discounts, deadlines or scarcity).
 *
 * The result is a short prompt section (`salesPsychologyBrief`) the agent reads with the rest of its brief.
 */
import { conversationSignals, detectSignals, leadTemperature, type BuyingSignal, type HistoryMsg, type Objection, type Temperature } from "./brain-pro";

/* ------------------------------------------------------------------ sentiment -1.0 … 1.0 */

/**
 * A Hebrew pattern that starts at a word start (optionally after one attached prefix letter: ו/ה/ש/ב/ל/כ), so a short stem
 * never matches inside another word ("רע" is not "רעיון", "יקר" is not "ביקרתי").
 */
const he = (src: string, weight: number): [RegExp, number] => [new RegExp(`(?<![\\p{L}])[והשבלכ]?(?:${src})`, "iu"), weight];

/** word stems with a weight (positive / negative); matched case-insensitively */
const POSITIVE: [RegExp, number][] = [
  he("מעולה|מושלם|מדהים|וואו|מהמם|אלופים|אלוף|תותחים|תותח|כל\\s*הכבוד|הכי\\s*טוב", 0.9),
  he("תודה|מצוין|אהבתי|אוהב|אוהבת|שמח|שמחה|נהדר|יופי|סבבה|אחלה|נשמע\\s*טוב|מעניין|בשמחה", 0.55),
  [/\b(?:amazing|awesome|perfect|excellent|fantastic|wonderful|love it|the best|brilliant)\b/i, 0.9],
  [/\b(?:thanks|thank you|great|good|nice|cool|happy|glad|interested|sounds good|sure|lovely)\b/i, 0.5],
  [/ممتاز|رائع|مذهل|ممتازة|أفضل/i, 0.9],
  [/شكرا|شكراً|جميل|حلو|تمام|مهتم|يسعدني|منيح/i, 0.5],
];

const NEGATIVE: [RegExp, number][] = [
  he("נוכלים|רמאים|גנבים|עוקץ|בושה|חוצפה|זבל|גרוע\\s*ביותר|נמאס|מתבייש|תביעה|אתבע|עורך\\s*דין", -0.95),
  he("מאוכזב|מאוכזבת|גרוע|גרועה|רע(?![\\p{L}])|רעה(?![\\p{L}])|כועס|כועסת|עצבני|עצבנית|לא\\s*מרוצה|לא\\s*בסדר|תקלה|בעיה|שבור|שבורה|לא\\s*עובד|מתעצבן|מבאס|חבל(?![\\p{L}])", -0.6),
  he("יקר(?:ה|ים|ות)?(?![\\p{L}])|לא\\s*בטוח|מהסס|מתלבט|לא\\s*יודע|קשה(?![\\p{L}])", -0.25),
  [/\b(?:scam|fraud|disgusting|worst|ridiculous|lawsuit|lawyer|unacceptable|furious|terrible|horrible|hate)\b/i, -0.95],
  [/\b(?:disappointed|bad|angry|upset|annoyed|broken|not working|doesn'?t work|problem|issue|poor|unhappy|frustrat\w*)\b/i, -0.6],
  [/\b(?:expensive|not sure|hesitant|unsure|confus\w*|difficult)\b/i, -0.25],
  [/نصاب|احتيال|فضيحة|أسوأ|محامي|زفت/i, -0.95],
  [/زعلان|سيء|سيئ|مشكلة|خربان|ما\s*بيشتغل|محبط|غاضب/i, -0.6],
  [/غالي|مش\s*متأكد|متردد/i, -0.25],
];

const NEGATION = /(?:^|\s)(?:לא|אין|בלי|ממש\s*לא|not|no|never|isn'?t|wasn'?t|don'?t|doesn'?t|ما|مش|لا|مو)\s+(?:\S+\s+)?$/i;
const INTENSIFIER = /(?:^|\s)(?:מאוד|ממש|כל\s*כך|הכי|super|very|really|so|extremely|totally|جدا|كتير|كثير)\s+$/i;
const POS_EMOJI = /[😀😃😄😁😊🙂😍🥰😘👍👏🙏❤️💪🔥✨🎉🤩😎💯]/u;
const NEG_EMOJI = /[😡😠🤬😤😞😔😢😭👎💔😒🙄😩😫]/u;

/** clamp to [-1, 1] and round to 2 decimals */
const clamp = (n: number) => Math.round(Math.max(-1, Math.min(1, n)) * 100) / 100;

/**
 * Sentiment of one customer message: -1.0 (furious) … 0 (neutral) … 1.0 (delighted). Cheap and deterministic.
 * Each lexicon hit adds its weight; a negation right before the hit flips it (half strength); an intensifier right before
 * it multiplies it by 1.4; emoji and SHOUTING add to the mood.
 */
export function sentimentScore(textRaw: string): number {
  const text = String(textRaw ?? "").trim().slice(0, 1500);
  if (!text) return 0;
  let sum = 0;
  let hits = 0;
  const scan = (list: [RegExp, number][]) => {
    for (const [re, w] of list) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      let m: RegExpExecArray | null;
      while ((m = g.exec(text))) {
        if (m[0].length === 0) {
          g.lastIndex++;
          continue;
        }
        const before = text.slice(Math.max(0, m.index - 24), m.index);
        let weight = w;
        if (NEGATION.test(before)) weight = -w * 0.5;
        else if (INTENSIFIER.test(before)) weight = w * 1.4;
        sum += weight;
        hits++;
      }
    }
  };
  scan(POSITIVE);
  scan(NEGATIVE);
  const posEmoji = (text.match(new RegExp(POS_EMOJI.source, "gu")) ?? []).length;
  const negEmoji = (text.match(new RegExp(NEG_EMOJI.source, "gu")) ?? []).length;
  if (posEmoji) {
    sum += 0.35 * Math.min(posEmoji, 3);
    hits++;
  }
  if (negEmoji) {
    sum -= 0.45 * Math.min(negEmoji, 3);
    hits++;
  }
  const letters = text.replace(/[^A-Za-z]/g, "");
  const shouting = letters.length >= 8 && letters === letters.toUpperCase();
  const bangs = (text.match(/!{2,}/g) ?? []).length;
  if (!hits) return shouting ? -0.3 : 0;
  // average the hits so a long message is not automatically extreme, then let a few strong hits push further
  let score = sum / Math.max(1, Math.sqrt(hits));
  if (shouting || bangs) score += score < 0 ? -0.15 : 0.05;
  return clamp(score);
}

export type SentimentTrend = "improving" | "declining" | "stable";

export interface SentimentReading {
  /** the latest customer message */
  score: number;
  /** a weighted average of the last customer messages (the latest counts most) */
  average: number;
  trend: SentimentTrend;
  /** a plain label for the brief and the inbox */
  label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive";
}

export function sentimentLabel(score: number): SentimentReading["label"] {
  if (score <= -0.6) return "very_negative";
  if (score <= -0.2) return "negative";
  if (score < 0.2) return "neutral";
  if (score < 0.6) return "positive";
  return "very_positive";
}

/** The customer's mood now and where it is going (last 5 customer messages, the latest weighted most). */
export function sentimentTrend(history: HistoryMsg[], window = 5): SentimentReading {
  const scores = history
    .filter((m) => m.role === "user")
    .slice(-window)
    .map((m) => sentimentScore(m.content));
  if (!scores.length) return { score: 0, average: 0, trend: "stable", label: "neutral" };
  const score = scores[scores.length - 1]!;
  let wsum = 0;
  let w = 0;
  scores.forEach((s, i) => {
    const weight = i + 1;
    wsum += s * weight;
    w += weight;
  });
  const average = clamp(wsum / w);
  let trend: SentimentTrend = "stable";
  if (scores.length >= 2) {
    const earlier = scores.slice(0, -1);
    const before = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    if (score - before >= 0.3) trend = "improving";
    else if (before - score >= 0.3) trend = "declining";
  }
  return { score, average, trend, label: sentimentLabel(score) };
}

/* ------------------------------------------------------------------ deep objections */

export interface ObjectionReading {
  /** objections in the latest customer message */
  now: Objection[];
  /** objections raised before AND again now — the previous answer did not resolve them */
  deep: Objection[];
  /** everything raised in the conversation */
  all: Objection[];
}

export function readObjections(history: HistoryMsg[]): ObjectionReading {
  const customer = history.filter((m) => m.role === "user");
  const last = customer[customer.length - 1]?.content ?? "";
  const now = detectSignals(last).objections;
  const before = new Set<Objection>();
  for (const m of customer.slice(0, -1)) detectSignals(m.content).objections.forEach((o) => before.add(o));
  const deep = now.filter((o) => before.has(o));
  const all = [...new Set([...before, ...now])];
  return { now, deep, all };
}

/* ------------------------------------------------------------------ adaptive persuasion plan */

export const TACTICS = ["empathy_first", "value_anchoring", "risk_reversal", "social_proof", "urgency_framing", "smaller_step", "assumptive_next_step"] as const;
export type Tactic = (typeof TACTICS)[number];

/** what the business really has — a tactic that needs a fact is used only when the fact exists */
export interface BusinessProofs {
  /** the business information mentions reviews / testimonials / clients / years of experience */
  socialProof?: boolean;
  /** the business information mentions a guarantee / warranty / refund / free trial / free consultation */
  riskReversal?: boolean;
  /** the business information mentions a real deadline / limited places / a dated offer / stock */
  realUrgency?: boolean;
}

/** reads the business facts (the agent's profile / knowledge text) for the proofs a tactic needs */
export function proofsFromFacts(facts: string): BusinessProofs {
  const f = String(facts ?? "");
  return {
    socialProof: /ביקורות|המלצות|לקוחות\s*מרוצים|שנות\s*ניסיון|שנים\s*בתחום|דירוג|כוכבים|\b(?:reviews?|testimonials?|clients?|customers served|years? of experience|rated|stars?)\b|مراجعات|عملاء|سنوات\s*خبرة/i.test(f),
    riskReversal: /אחריות|ערבות|החזר\s*כספי|החזר\s*מלא|ניסיון\s*חינם|ייעוץ\s*(?:ראשון\s*)?חינם|שיחת\s*היכרות\s*חינם|ללא\s*התחייבות|\b(?:guarantee|warranty|refund|money.back|free trial|free consultation|no commitment|cancel anytime)\b|ضمان|استرجاع|تجربة\s*مجانية|بدون\s*التزام/i.test(f),
    realUrgency: /מקומות\s*מוגבלים|עד\s*(?:ה|ל)?\d{1,2}[./]\d{1,2}|בתוקף\s*עד|מבצע\s*עד|נותרו|מלאי\s*מוגבל|\b(?:limited (?:spots|places|stock|time)|valid until|offer ends|until \d|only \d+ left)\b|عرض\s*لفترة\s*محدودة|حتى\s*تاريخ|كمية\s*محدودة/i.test(f),
  };
}

export interface PsychologyInput {
  history: HistoryMsg[];
  proofs?: BusinessProofs;
}

export interface PsychologyPlan {
  sentiment: SentimentReading;
  objections: ObjectionReading;
  temperature: Temperature;
  buying: BuyingSignal[];
  /** ordered by fit — the first is the main tactic of this reply, at most 3 */
  tactics: Tactic[];
}

/** Picks the tactics that fit this moment. Order matters: the first is the main move of the reply. */
export function psychologyPlan(input: PsychologyInput): PsychologyPlan {
  const history = input.history ?? [];
  const proofs = input.proofs ?? {};
  const sentiment = sentimentTrend(history);
  const objections = readObjections(history);
  const conv = conversationSignals(history);
  const { temperature } = leadTemperature(history);
  const tactics: Tactic[] = [];
  const add = (t: Tactic) => {
    if (!tactics.includes(t)) tactics.push(t);
  };
  const upset = sentiment.score <= -0.4 || (sentiment.trend === "declining" && sentiment.score < 0);

  // an upset customer is never "sold" to: empathy first, then the smallest helpful step
  if (upset) {
    add("empathy_first");
    add("smaller_step");
    return { sentiment, objections, temperature, buying: conv.buying, tactics: tactics.slice(0, 3) };
  }
  // a deep objection (raised again) → the previous approach failed: lower the risk and shrink the ask
  if (objections.deep.length) {
    add("empathy_first");
    if (proofs.riskReversal) add("risk_reversal");
    add("smaller_step");
  }
  for (const o of objections.now) {
    if (o === "price" || o === "competitor") {
      add("value_anchoring");
      if (proofs.riskReversal) add("risk_reversal");
    } else if (o === "trust") {
      if (proofs.socialProof) add("social_proof");
      if (proofs.riskReversal) add("risk_reversal");
      add("smaller_step");
    } else if (o === "timing") {
      add("smaller_step");
      if (proofs.realUrgency) add("urgency_framing");
    } else if (o === "authority") {
      add("smaller_step");
    } else if (o === "fit") {
      add("value_anchoring");
      if (proofs.socialProof) add("social_proof");
    }
  }
  // buying signals with no open objection → move to the next step naturally
  if (!objections.now.length && (conv.buying.includes("commit") || conv.buying.includes("payment") || conv.buying.includes("start_when") || temperature === "hot")) {
    add("assumptive_next_step");
    if (proofs.realUrgency) add("urgency_framing");
  }
  // a warm, positive conversation with no objection → value first, proof if the business has it
  if (!tactics.length) {
    add("value_anchoring");
    if (proofs.socialProof && temperature !== "cold") add("social_proof");
    if (temperature === "hot") add("assumptive_next_step");
  }
  return { sentiment, objections, temperature, buying: conv.buying, tactics: tactics.slice(0, 3) };
}

/* ------------------------------------------------------------------ the brief for the agent */

const TACTIC_RULES: Record<Tactic, string> = {
  empathy_first: "EMPATHY FIRST — open by acknowledging the feeling in one honest sentence (no excuses, no selling). Then solve or offer the next helpful step.",
  value_anchoring: "VALUE ANCHORING — before (or instead of) the price, anchor on the concrete outcome for THIS customer: what they get, what it saves or earns them, what it costs them NOT to act. Use only the business's real offer and real numbers.",
  risk_reversal: "RISK REVERSAL — make saying yes safe: mention the business's REAL guarantee / refund / free first step / no-commitment option, exactly as written in the business information.",
  social_proof: "SOCIAL PROOF — mention the REAL proof the business has (its reviews, number of clients, years in the field, a real example). Never invent a review, a number or a client name.",
  urgency_framing: "URGENCY FRAMING — only the REAL deadline / limited places / stock written in the business information, stated calmly once. Never invent scarcity or pressure.",
  smaller_step: "SMALLER STEP — shrink the ask to an easy yes: a short call, details to look at, a reserved spot without obligation, a question that uncovers the real concern.",
  assumptive_next_step: "NEXT STEP — the customer is ready: propose the concrete next action (time / link / what you need from them) as the natural continuation, with two simple options to choose from.",
};

const LABEL_TEXT: Record<SentimentReading["label"], string> = {
  very_negative: "very negative",
  negative: "negative",
  neutral: "neutral",
  positive: "positive",
  very_positive: "very positive",
};

/**
 * The prompt section the conversation agent reads with the rest of its brief. Always short (the tactics, the mood, the deep
 * objections) and always bound to the truth of the business information.
 */
export function salesPsychologyBrief(plan: PsychologyPlan): string {
  const lines = [
    "SALES PSYCHOLOGY (this reply):",
    `- Customer sentiment ${plan.sentiment.score.toFixed(2)} (${LABEL_TEXT[plan.sentiment.label]}, ${plan.sentiment.trend}); lead ${plan.temperature}.`,
  ];
  if (plan.objections.deep.length) lines.push(`- DEEP objection (${plan.objections.deep.join(", ")}): it came back — your earlier answer did not resolve it. Do NOT repeat it; change the approach.`);
  plan.tactics.forEach((t, i) => lines.push(`- ${i === 0 ? "Main move" : "Then"}: ${TACTIC_RULES[t]}`));
  lines.push("- Honesty is absolute: every proof, guarantee, deadline, price and number comes only from the business information. Natural, warm, short — never manipulative.");
  return lines.join("\n");
}

/** one call for the agent: the plan + its brief (never throws — a failure returns an empty brief) */
export function salesPsychology(input: PsychologyInput): { plan: PsychologyPlan | null; brief: string } {
  try {
    const plan = psychologyPlan(input);
    return { plan, brief: salesPsychologyBrief(plan) };
  } catch {
    return { plan: null, brief: "" };
  }
}
