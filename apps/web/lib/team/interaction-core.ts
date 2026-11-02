/**
 * The digital team — interaction and psychology (pure, unit-tested; rule-based, no AI call, so it is fast and free).
 * Reads emotion and urgency in a customer's message, the customer's communication style and the kind of objection,
 * and turns them into short guidance lines for the employee's prompt. Persuasion is ethical only: no fake scarcity,
 * no pressure, no invented claims. A person is called in when the situation needs one.
 */
export type Emotion = "angry" | "anxious" | "sad" | "confused" | "happy" | "neutral";

export interface EmotionRead {
  emotion: Emotion;
  /** 0..1 */
  intensity: number;
  /** 0..1 */
  urgency: number;
  signals: string[];
}

const ANGRY = /(מתוסכל|עצבני|זעם|נמאס|מאוכזב|גרוע|בושה|פשוט לא ייאמן|שירות מחורבן|אכזבה|angry|furious|unacceptable|terrible|worst|disappointed|fed up|ridiculous|غاضب|سيء|غير مقبول|مستاء)/i;
const ANXIOUS = /(דחוף|בבקשה תעזרו|מודאג|חוששת|חושש|לחוץ|asap|urgent|worried|concerned|please help|immediately|عاجل|قلق|بسرعة)/i;
const SAD = /(עצוב|מצטער לשמוע|קשה לי|נפטר|אבל|sad|sorry for|passed away|grieving|حزين|وفاة)/i;
const CONFUSED = /(לא הבנתי|לא מבין|לא ברור|מבולבל|איך זה עובד|what do you mean|don't understand|confused|unclear|مش فاهم|لم أفهم|غير واضح)/i;
const HAPPY = /(תודה רבה|מעולה|מושלם|אהבתי|מרוצה|שמח|thank you so much|great|perfect|love it|amazing|thanks!|شكرا جزيلا|رائع|ممتاز)/i;
const URGENT = /(דחוף|היום|עכשיו|מיד|בהקדם|הערב|עוד שעה|today|now|asap|urgent|immediately|tonight|اليوم|الآن|عاجل)/i;

export function detectEmotion(text: string): EmotionRead {
  const t = String(text ?? "");
  const signals: string[] = [];
  let emotion: Emotion = "neutral";
  let intensity = 0;
  const caps = (t.match(/[A-Z]{4,}/g) ?? []).length;
  const bangs = (t.match(/[!！]{2,}/g) ?? []).length + (t.match(/\?{2,}/g) ?? []).length;
  if (ANGRY.test(t)) {
    emotion = "angry";
    intensity = 0.6;
    signals.push("anger_words");
  } else if (ANXIOUS.test(t)) {
    emotion = "anxious";
    intensity = 0.5;
    signals.push("anxiety_words");
  } else if (SAD.test(t)) {
    emotion = "sad";
    intensity = 0.5;
    signals.push("sadness_words");
    if (/(נפטר|passed away|grieving|وفاة)/i.test(t)) signals.push("bereavement");
  } else if (CONFUSED.test(t)) {
    emotion = "confused";
    intensity = 0.4;
    signals.push("confusion_words");
  } else if (HAPPY.test(t)) {
    emotion = "happy";
    intensity = 0.5;
    signals.push("positive_words");
  }
  if (caps) {
    intensity += 0.15;
    signals.push("caps");
  }
  if (bangs) {
    intensity += 0.15;
    signals.push("emphasis");
  }
  const urgent = URGENT.test(t);
  if (urgent) signals.push("time_pressure");
  const urgency = Math.min(1, (urgent ? 0.55 : 0) + (emotion === "anxious" ? 0.25 : 0) + (emotion === "angry" ? 0.2 : 0) + (bangs ? 0.1 : 0));
  return { emotion, intensity: Math.min(1, intensity), urgency, signals };
}

/* ------------------------------------------------------------------ objections */

export type ObjectionKind = "price" | "timing" | "trust" | "competitor" | "need" | "authority" | "none";

const OBJECTIONS: { kind: ObjectionKind; re: RegExp }[] = [
  { kind: "competitor", re: /(מתחרה|במקום אחר|מצאתי אצל|הצעה אחרת|competitor|another (company|vendor|provider)|found (it )?cheaper|منافس|عرض آخر)/i },
  { kind: "price", re: /(יקר|מחיר גבוה|אין לי תקציב|זול יותר|הנחה|too expensive|pricey|cheaper|discount|out of (my )?budget|غالي|خصم|أرخص)/i },
  { kind: "trust", re: /(לא בטוח|אפשר לסמוך|ביקורות|אחריות|הבטחה|not sure|can i trust|reviews|guarantee|scam|مش متأكد|ضمان|احتيال)/i },
  { kind: "timing", re: /(לא עכשיו|אחר כך|בעוד כמה|אחזור אליך|נחזור|later|not now|next month|maybe someday|get back to you|لاحقا|مش هلق|بعدين)/i },
  { kind: "authority", re: /(צריך לשאול|לדבר עם (בעלי|אשתי|השותף|המנהל)|ask my|talk to my (husband|wife|partner|boss)|need approval|لازم أسأل|أستشير)/i },
  { kind: "need", re: /(לא צריך|לא רלוונטי|לא מעוניין|לא מתאים|don't need|not interested|not relevant|no need|مش محتاج|غير مهتم)/i },
];

export function classifyObjection(text: string): ObjectionKind {
  for (const o of OBJECTIONS) if (o.re.test(text)) return o.kind;
  return "none";
}

const OBJECTION_GUIDE: Record<Exclude<ObjectionKind, "none">, string> = {
  price: "Price objection: acknowledge it honestly, restate the concrete value the business really delivers, offer only options/discounts the business actually stated. Never invent a discount or deadline.",
  competitor: "Competitor objection: never disparage the competitor. Ask what matters most to the customer and show where the business is genuinely strong. Do not match prices on your own.",
  trust: "Trust objection: be transparent. Share real, verifiable proof the business has (reviews, guarantees it stated). If there is none in the data, say so and offer to connect them with the owner.",
  timing: "Timing objection: respect it. Offer one easy next step and a time to follow up that the customer chooses. No artificial urgency.",
  authority: "Decision-maker objection: make it easy to include the other person — offer a short summary they can forward. Do not push.",
  need: "No-need objection: ask ONE short question to understand, accept a polite no gracefully, and leave the door open.",
};

/* ------------------------------------------------------------------ customer style */

export interface CustomerStyle {
  register: "warm" | "business" | "brief";
  usesEmoji: boolean;
  avgWords: number;
  formal: boolean;
}

/** learned from the customer's own recent messages */
export function inferStyle(customerMessages: string[]): CustomerStyle {
  const msgs = customerMessages.map((m) => String(m ?? "").trim()).filter(Boolean).slice(-8);
  if (!msgs.length) return { register: "business", usesEmoji: false, avgWords: 0, formal: false };
  const words = msgs.map((m) => m.split(/\s+/).length);
  const avgWords = words.reduce((a, b) => a + b, 0) / words.length;
  const emoji = /\p{Extended_Pictographic}/u;
  const usesEmoji = msgs.some((m) => emoji.test(m));
  const formal = msgs.some((m) => /(שלום רב|בברכה|בכבוד רב|dear|sincerely|regards|kind regards|تحية طيبة|مع الاحترام)/i.test(m));
  const casual = msgs.some((m) => /(היי|אהלן|מה קורה|hey|hi there|yo\b|هلا|مرحبا)/i.test(m));
  const register: CustomerStyle["register"] = avgWords <= 5 && !formal ? "brief" : usesEmoji || casual ? "warm" : "business";
  return { register, usesEmoji, avgWords: Math.round(avgWords * 10) / 10, formal };
}

/* ------------------------------------------------------------------ escalation */

export function shouldEscalateToHuman(read: EmotionRead, objection: ObjectionKind, history: { complaints: number; unanswered: number } = { complaints: 0, unanswered: 0 }): string | null {
  if (read.emotion === "angry" && read.intensity >= 0.75) return "angry_customer";
  if (read.emotion === "angry" && history.complaints >= 1) return "repeat_complaint";
  if (read.emotion === "sad" && read.signals.includes("bereavement")) return "sensitive_situation";
  if (history.complaints >= 2) return "repeat_complaint";
  if (history.unanswered >= 3) return "long_wait";
  void objection;
  return null;
}

/* ------------------------------------------------------------------ the guidance block */

export function interactionGuidance(input: { message: string; history?: string[]; complaints?: number }): { lines: string[]; read: EmotionRead; objection: ObjectionKind; style: CustomerStyle; escalate: string | null } {
  const read = detectEmotion(input.message);
  const objection = classifyObjection(input.message);
  const style = inferStyle([...(input.history ?? []), input.message]);
  const escalate = shouldEscalateToHuman(read, objection, { complaints: input.complaints ?? 0, unanswered: 0 });
  const lines: string[] = [];
  if (read.emotion === "angry") lines.push("The customer is upset: open with a sincere acknowledgement of the problem (not a template apology), take ownership, give ONE concrete next step. No defensiveness, no jokes, no emojis.");
  else if (read.emotion === "anxious") lines.push("The customer is worried or in a hurry: answer the core question in the first line, be calm and specific, say exactly when they will hear back.");
  else if (read.emotion === "sad") lines.push("The customer is going through something hard: be gentle and human, do not sell, offer help only if appropriate.");
  else if (read.emotion === "confused") lines.push("The customer is confused: use short plain sentences, one idea at a time, offer an example, and check understanding with one simple question.");
  else if (read.emotion === "happy") lines.push("The customer is happy: match the warmth, thank them genuinely, and only then suggest a natural next step.");
  if (read.urgency >= 0.5) lines.push("It is urgent for the customer: reply first with what you CAN do now.");
  lines.push(style.register === "brief" ? "Style: this customer writes briefly — keep the reply to 1-3 short lines." : style.register === "warm" ? `Style: friendly and personal${style.usesEmoji ? "; one fitting emoji is fine" : ""}.` : "Style: professional and to the point, a polite register.");
  if (objection !== "none") lines.push(OBJECTION_GUIDE[objection]);
  lines.push("Build rapport by reflecting the customer's own words and needs. Persuade only with true, relevant facts and the customer's real interest — never pressure, fake scarcity or manipulation.");
  if (escalate) lines.push(`This needs a person (${escalate.replace(/_/g, " ")}): do not try to resolve it alone — summarize the case and hand it to the owner.`);
  return { lines, read, objection, style, escalate };
}

/** the prompt block (empty when there is nothing worth saying) */
export function interactionPrompt(input: { message: string; history?: string[]; complaints?: number }): string {
  const g = interactionGuidance(input);
  return ["HOW TO ANSWER THIS CUSTOMER (read from their message):", ...g.lines.map((l) => `- ${l}`)].join("\n");
}

/* ------------------------------------------------------------------ the owner */

export interface OwnerStyle {
  prefersShort: boolean;
  avgWords: number;
}

export function ownerStyle(ownerMessages: string[]): OwnerStyle {
  const msgs = ownerMessages.map((m) => String(m ?? "").trim()).filter(Boolean).slice(-10);
  if (!msgs.length) return { prefersShort: true, avgWords: 0 };
  const avg = msgs.reduce((a, m) => a + m.split(/\s+/).length, 0) / msgs.length;
  return { prefersShort: avg <= 12, avgWords: Math.round(avg * 10) / 10 };
}

export function ownerPrompt(style: OwnerStyle): string {
  return [
    "WHEN YOU WRITE TO THE OWNER:",
    style.prefersShort ? "- The owner writes briefly: reports in at most 5 short lines, the decision first." : "- The owner likes detail: give the reasoning in a short paragraph after the decision.",
    "- Ask at most ONE question, and attach your recommended answer and the reason (\"I suggest X because Y — OK?\").",
    "- Lead with the result, then what you need from the owner, then the details.",
  ].join("\n");
}
