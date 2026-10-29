/**
 * Wave 48 — "Brain Pro": an extra intelligence layer for every AI agent (pure, unit-tested).
 * Added on top of intelligence.ts / autopilot-core.ts — nothing there changed.
 *
 * What it adds, like the strongest sales & support assistants:
 *   • objection detection (price, timing, trust, competitor, authority, fit) + a proven playbook per objection;
 *   • buying-signal detection → the agent moves to close instead of continuing to explain;
 *   • conversation stage (discovery → qualification → proposal → objection → closing → after-sale);
 *   • lead temperature with reasons (hot / warm / cold) for the team;
 *   • next-best-action for this exact moment;
 *   • style mirroring (length, emoji, formality) so the agent sounds like a real person from the business.
 * It never contains customer text (no prompt-injection surface) — only our own guidance.
 */

export type Objection = "price" | "timing" | "trust" | "competitor" | "authority" | "fit";
export type BuyingSignal = "start_when" | "payment" | "stock" | "delivery" | "details" | "commit";
export type Stage = "discovery" | "qualification" | "proposal" | "objection" | "closing" | "after_sale";
export type Temperature = "hot" | "warm" | "cold";

const OBJECTION_PATTERNS: [Objection, RegExp][] = [
  ["price", /יקר|יקרה|יקרים|מחיר\s*גבוה|זה\s*הרבה\s*כסף|אין\s*לי\s*תקציב|מעבר\s*לתקציב|יש\s*הנחה|אפשר\s*הנחה|תוריד|להוריד\s*(?:במחיר|קצת)|\b(?:too expensive|expensive|pricey|over (?:my )?budget|can't afford|any discount|cheaper|lower the price)\b|غالي|غالية|خصم|تخفيض|ما\s*عندي\s*ميزانية/i],
  ["timing", /לא\s*עכשיו|אחשוב\s*על\s*זה|אני\s*אחשוב|אחזור\s*אליכם|אולי\s*בהמשך|בחודש\s*הבא|עוד\s*לא\s*החלטתי|צריך\s*לחשוב|\b(?:not now|i'?ll think|think about it|maybe later|next month|get back to you|not ready)\b|سأفكر|ليس\s*الآن|لاحقاً|بعدين/i],
  ["trust", /איך\s*אני\s*יודע|אפשר\s*לסמוך|יש\s*ביקורות|המלצות|אחריות|ערבות|מה\s*אם\s*זה\s*לא|נשמע\s*טוב\s*מדי|עוקץ|\b(?:can i trust|reviews?|testimonials?|guarantee|warranty|what if it doesn'?t|sounds too good|is this legit|legit)\b|ضمان|مراجعات|هل\s*أثق/i],
  ["competitor", /אצל\s*\S+\s*(?:יותר\s*)?(?:זול|זולה|בפחות)|מתחרה|מצאתי\s*(?:יותר\s*)?זול|ראיתי\s*(?:ב|אצל)\S*\s*ב(?:פחות|זול)|בחנות\s*אחרת|\b(?:competitor|found it cheaper|cheaper elsewhere|another (?:company|place) offers|other quote)\b|أرخص\s*عند|منافس/i],
  ["authority", /(?:אשאל|לשאול|להתייעץ)\s*(?:את|עם)\s*(?:אשתי|בעלי|השותף|השותפה|הבוס|המנהל|ההורים|אבא|אמא)|צריך\s*אישור|לא\s*תלוי\s*רק\s*בי|\b(?:ask my (?:wife|husband|partner|boss|manager)|need approval|not my decision|check with my)\b|أسأل\s*(?:زوجتي|زوجي|شريكي|مديري)/i],
  ["fit", /לא\s*בטוח\s*ש(?:זה)?\s*מתאים|זה\s*מתאים\s*לי|מתאים\s*ל(?:מי|מקרה)|לא\s*יודע\s*אם\s*זה\s*בשבילי|מה\s*ההבדל|\b(?:not sure (?:it|this) (?:fits|is right)|is it right for me|what'?s the difference|does it work for)\b|هل\s*يناسبني|ما\s*الفرق/i],
];

const BUYING_PATTERNS: [BuyingSignal, RegExp][] = [
  ["start_when", /מתי\s*(?:אפשר|ניתן)\s*(?:להתחיל|לקבל|להגיע|לקבוע)|כמה\s*מהר|הכי\s*מוקדם|\b(?:when can (?:we|i|you) start|how soon|earliest|when can i get)\b|متى\s*(?:نبدأ|يمكن)/i],
  ["payment", /אפשר\s*לשלם|תשלומים|ביט|פייבוקס|אשראי|העברה\s*בנקאית|חשבונית|קבלה|\b(?:can i pay|payment (?:options|plan)|installments|credit card|invoice|paypal|bank transfer)\b|الدفع|تقسيط|بطاقة/i],
  ["stock", /יש\s*(?:במלאי|מלאי)|נשאר|זמין\s*(?:עכשיו|במלאי)|יש\s*בגודל|יש\s*בצבע|\b(?:in stock|available now|do you have (?:it|size|color))\b|متوفر|في\s*المخزون/i],
  ["delivery", /משלוח|שליח|איסוף\s*עצמי|תוך\s*כמה\s*זמן\s*(?:זה\s*)?מגיע|זמן\s*אספקה|\b(?:shipping|delivery|deliver|pick ?up|how long (?:does it|to) (?:take|arrive))\b|توصيل|شحن/i],
  ["details", /(?:שלח|תשלח|תשלחו|שלחו)\s*(?:לי\s*)?(?:פרטים|הצעה|קישור|חשבון)|מה\s*הצעד\s*הבא|איך\s*ממשיכים|מה\s*צריך\s*ממני|\b(?:send me (?:the )?(?:details|quote|link|invoice)|what'?s the next step|how do (?:we|i) proceed)\b|أرسل\s*(?:لي\s*)?التفاصيل|الخطوة\s*التالية/i],
  ["commit", /סגור|סגרנו|מעולה\s*בוא|יאללה|אני\s*בפנים|תרשום\s*אותי|תשריין|שריין|\b(?:deal|let'?s go|count me in|book it|reserve it|i'?m in|sounds good,? let'?s)\b|اتفقنا|احجز\s*لي/i],
];

export interface ProSignals {
  objections: Objection[];
  buying: BuyingSignal[];
  /** the customer writes very short messages (≤ 6 words) */
  terse: boolean;
  /** the customer uses emoji */
  emoji: boolean;
  /** the customer writes formally (no slang, full sentences) */
  formal: boolean;
  /** question count in the message */
  questions: number;
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const SLANG_RE = /אחי|אחותי|סבבה|יאללה|וואלה|תותח|חחח|lol|bro|dude|gonna|wanna|yalla|حبيبي|يلا/i;

/** Reads one customer message for objections, buying signals and writing style. Cheap, no AI call. */
export function detectSignals(textRaw: string): ProSignals {
  const text = (textRaw ?? "").trim().slice(0, 1500);
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return {
    objections: OBJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([o]) => o),
    buying: BUYING_PATTERNS.filter(([, re]) => re.test(text)).map(([b]) => b),
    terse: words > 0 && words <= 6,
    emoji: EMOJI_RE.test(text),
    formal: words >= 8 && !SLANG_RE.test(text) && !EMOJI_RE.test(text),
    questions: (text.match(/[?؟]/g) ?? []).length,
  };
}

export interface HistoryMsg {
  role: "user" | "assistant";
  content: string;
}

/** Signals over the whole conversation (customer messages only). */
export function conversationSignals(history: HistoryMsg[]): { objections: Objection[]; buying: BuyingSignal[]; turns: number; hasContact: boolean } {
  const obj = new Set<Objection>();
  const buy = new Set<BuyingSignal>();
  let turns = 0;
  let hasContact = false;
  for (const m of history) {
    if (m.role !== "user") continue;
    turns++;
    const s = detectSignals(m.content);
    s.objections.forEach((o) => obj.add(o));
    s.buying.forEach((b) => buy.add(b));
    if (/(?:\+?\d[\d\s-]{7,}\d)|[\w.+-]+@[\w-]+\.[\w.]+/.test(m.content)) hasContact = true;
  }
  return { objections: [...obj], buying: [...buy], turns, hasContact };
}

/** Where the conversation is now. */
export function conversationStage(input: { now: ProSignals; history: HistoryMsg[] }): Stage {
  const conv = conversationSignals(input.history);
  if (input.now.buying.includes("commit") || (input.now.buying.length >= 1 && conv.hasContact)) return "closing";
  if (input.now.objections.length) return "objection";
  if (input.now.buying.length) return "closing";
  const assistantMentionedPrice = input.history.some((m) => m.role === "assistant" && /\d[\d,.]*\s*(?:₪|ש"ח|ש״ח|שקל|\$|€|nis|ils)|(?:₪|\$|€)\s*\d/i.test(m.content));
  if (assistantMentionedPrice) return "proposal";
  if (conv.turns >= 2) return "qualification";
  return "discovery";
}

/** Lead temperature with short reasons for the team. */
export function leadTemperature(history: HistoryMsg[]): { temperature: Temperature; reasons: string[] } {
  const c = conversationSignals(history);
  const reasons: string[] = [];
  let score = 0;
  if (c.buying.includes("commit")) {
    score += 4;
    reasons.push("agreed / asked to book");
  }
  if (c.buying.some((b) => b === "payment" || b === "start_when" || b === "details")) {
    score += 2;
    reasons.push("asked about payment / start / next step");
  }
  if (c.buying.some((b) => b === "stock" || b === "delivery")) {
    score += 1;
    reasons.push("asked about stock / delivery");
  }
  if (c.hasContact) {
    score += 2;
    reasons.push("shared contact details");
  }
  if (c.turns >= 4) {
    score += 1;
    reasons.push("engaged conversation");
  }
  if (c.objections.includes("timing")) {
    score -= 2;
    reasons.push("timing objection");
  }
  if (c.objections.includes("price") || c.objections.includes("competitor")) {
    score -= 1;
    reasons.push("price sensitivity");
  }
  const temperature: Temperature = score >= 5 ? "hot" : score >= 2 ? "warm" : "cold";
  return { temperature, reasons: reasons.slice(0, 4) };
}

const OBJECTION_PLAYBOOK: Record<Objection, string> = {
  price:
    "PRICE objection → never argue and never invent a discount. 1) Acknowledge in one short sentence. 2) Re-anchor on value: what exactly they get and the concrete result for THEM. 3) If the business facts list cheaper options / packages / payment plans, offer the one that fits. 4) Only a discount that the pricing policy explicitly allows. 5) End with an easy yes/no next step.",
  timing:
    "TIMING objection (\"I'll think about it\") → respect it, no pressure. Ask ONE gentle question that uncovers the real concern (\"is it the price, the timing or something you want to check?\"). Offer a light micro-commitment: send details to look at, or reserve a spot without obligation. Capture name + phone so the team can follow up.",
  trust:
    "TRUST objection → answer with facts only from the business information: experience, guarantees, policies, real examples/portfolio (send media if available). Never invent reviews, numbers or guarantees. Offer a safe first step (consultation, small order, trial) when the business offers one.",
  competitor:
    "COMPETITOR comparison → never badmouth the competitor. Ask what exactly is included in their offer, then highlight the 1-2 real differences from the business facts (quality, service, warranty, speed). If the business is truly not cheaper, compete on value, not on price.",
  authority:
    "DECISION-MAKER objection → make it easy to share: offer to send a short clear summary (what, price, next step) they can forward, and suggest a convenient time to follow up with both. Capture contact details.",
  fit:
    "FIT doubt → ask ONE qualifying question about their exact situation, then recommend the single option that fits and why in one sentence. If nothing fits, say so honestly and offer the closest alternative or a person.",
};

const STAGE_GUIDE: Record<Stage, string> = {
  discovery: "Stage: DISCOVERY — understand the need. Answer what was asked, then ONE open question that reveals what they want and why.",
  qualification: "Stage: QUALIFICATION — learn the one missing detail that decides the right option (size / quantity / date / budget / location). Do not interrogate; one question at a time.",
  proposal: "Stage: PROPOSAL — recommend ONE best-fit option with its concrete benefit for this customer and the real price from the facts. Then invite a simple next step.",
  objection: "Stage: OBJECTION — follow the objection playbook below before anything else. Short, calm, empathetic.",
  closing: "Stage: CLOSING — the customer shows buying intent. STOP explaining. Confirm what they chose, collect only the missing details (name, phone, what the business needs), give the exact next step, and record it with [[LEAD …]] (score=hot when contact details are known).",
  after_sale: "Stage: AFTER-SALE — confirm what happens next, thank warmly, and offer help. No new selling unless asked.",
};

const BUYING_GUIDE: Partial<Record<BuyingSignal, string>> = {
  payment: "they asked how to pay → answer with the payment options from the business facts (or say the team will send them), then move to close",
  stock: "they asked about availability → answer from the facts; if unknown, say you will check and capture the lead — never confirm stock you do not know",
  delivery: "they asked about delivery → answer only from the facts (areas, time, cost); if unknown, check with the team",
  start_when: "they asked when they can start → offer the nearest concrete option within the opening hours / booking link",
  details: "they asked for details / the next step → give the next step right now (link, summary, or collect name + phone)",
};

/**
 * Extra system-prompt section ("SALES BRAIN PRO") built from the latest customer message and the history.
 * Appended after the existing situation brief.
 */
export function proBrief(input: { text: string; history: HistoryMsg[] }): string {
  const now = detectSignals(input.text);
  const stage = conversationStage({ now, history: input.history });
  const lead = leadTemperature(input.history);
  const lines: string[] = ["SALES & SERVICE BRAIN PRO (written by the system, follow it):", `- ${STAGE_GUIDE[stage]}`];
  for (const o of now.objections) lines.push(`- ${OBJECTION_PLAYBOOK[o]}`);
  for (const b of now.buying) if (BUYING_GUIDE[b]) lines.push(`- Buying signal: ${BUYING_GUIDE[b]}.`);
  lines.push(`- Lead temperature so far: ${lead.temperature}${lead.reasons.length ? ` (${lead.reasons.join(", ")})` : ""}. Use this score in [[LEAD …]] when you record it.`);
  // style mirroring
  if (now.terse) lines.push("- The customer writes very short messages: answer in 1-2 short sentences, no long explanations.");
  if (now.questions >= 2) lines.push("- The customer asked several questions: answer each one briefly, in the same order, then one next step.");
  lines.push(now.emoji ? "- The customer uses emoji: one fitting emoji is fine." : "- The customer does not use emoji: use none or at most one.");
  if (now.formal) lines.push("- The customer writes formally: keep a polite, professional register.");
  lines.push(
    "- Quality bar for EVERY reply: answer first, be specific (exact names from the business facts), one idea per line, one clear call to action. Sound like a real, experienced person from the business — never mention being an AI unless asked directly, never use robotic phrases (\"as an AI\", \"I am here to help you with any question\").",
  );
  return lines.join("\n");
}

/** Extra copywriting rules for the marketing agent's weekly content plan. */
export function marketingCopyRules(): string {
  return [
    "Copywriting rules for every post (top social media agency level):",
    "- First line is a scroll-stopping hook (max ~12 words): a bold benefit, a surprising fact or a direct question.",
    "- One idea per post, short lines with line breaks, written for mobile.",
    "- Speak to the customer's desire or pain, show the result — benefits, not features.",
    "- Exactly one clear call to action (message us / book / comment / share).",
    "- Vary the formats across the week: tip, behind the scenes, customer benefit/story, question to the audience, offer.",
    "- Natural native-level language, 2-4 fitting emojis at most. Never invent prices, discounts, dates or facts.",
  ].join("\n");
}


/** Extra rules for the analyst agent's morning brief (appended to its existing prompt). */
export function analystBriefRules(): string {
  return [
    "Analyst quality rules (like a top business consultant):",
    "- Start with ONE headline line: the single most important thing about yesterday (good or bad).",
    "- For every number that moved, say the likely reason only when the data shows it; otherwise just the trend.",
    "- \"Today:\" actions must be concrete (who / what / which customers or deals), ordered by money impact, each max ~15 words.",
    "- If waiting_for_a_person or hot_leads_open is above 0, the first action handles them.",
  ].join("\n");
}

/** Extra rules for the sales-manager agent's next steps (appended to its existing prompt). */
export function salesManagerRules(): string {
  return [
    "Next-step rules (like an experienced sales manager):",
    "- Match the step to the stage: early stage → a short check-in call/message with a relevant question; proposal stage → follow up on the proposal and ask for a decision; negotiation → offer a call to close the open point.",
    "- Many quiet days (21+) → a friendly \"should we keep this open?\" message; high value → a phone call, not a message.",
    "- Start each step with a verb (call / send / ask / book) and include the angle of the message.",
  ].join("\n");
}
