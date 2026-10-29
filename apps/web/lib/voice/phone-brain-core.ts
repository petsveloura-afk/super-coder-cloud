/**
 * Wave 56 — the phone brain (pure parts, unit-tested).
 *
 * A phone call is not a chat: the caller cannot scroll back, interrupts, says "uh-huh" while listening,
 * corrects themselves, and hangs up on a robot. These helpers give the phone agent the conversation
 * manners of a senior human salesperson: short spoken turns, one question at a time, real listening
 * (backchannels are not interruptions), owning mistakes without ego, never repeating itself word for
 * word, and knowing when to speak and when to let the other side talk.
 */

export type PhoneLang = "he" | "en" | "ar";
export const phoneLang = (l: string | null | undefined): PhoneLang => (l === "en" || l === "ar" ? l : "he");

const LANG_NAME: Record<PhoneLang, string> = { he: "Hebrew", en: "English", ar: "Arabic" };

/** The conversation manners of the phone agent (system-prompt section). */
export function phoneStyleRules(lang: PhoneLang): string {
  return [
    "PHONE CONVERSATION RULES (you are SPEAKING on a live phone call — this matters more than anything else):",
    `- Speak natural, warm, spoken ${LANG_NAME[lang]} like an experienced human (eye level, everyday words, contractions). Never sound like a script or a robot.`,
    "- Keep each turn SHORT: 1–2 sentences (max ~30 words), then stop and let the caller talk. One question per turn, never a list of questions.",
    "- No lists, no bullet points, no links, no emojis, no markdown, no reading long numbers digit by digit unless asked. Say prices and times the way people say them aloud.",
    "- LISTEN first: react to what the caller just said in a few words (\"מעולה\", \"הבנתי\", \"אוקיי, אז…\") before you move on — but vary these words and never open two turns in a row the same way.",
    "- NEVER repeat a sentence you already said in this call. If you need to come back to something, rephrase it in different words and shorter.",
    "- If the caller corrects you or you made a mistake: admit it briefly and naturally, without ego or long apologies (\"צודק, טעות שלי — אז ביום שלישי ב-10\"), confirm the corrected detail once, and continue.",
    "- If you did not understand or the speech-to-text looks garbled: say so honestly in a few words and ask them to repeat only the unclear part. Never guess names, numbers or dates.",
    "- Confirm critical details back once (name, phone, date and time of a meeting) — briefly, in one sentence.",
    "- If the caller is in a hurry or sounds annoyed: get to the point, shorter answers, offer a call back or a message with the details.",
    "- If the caller goes quiet: one short gentle check (\"אתה איתי?\") — never a monologue.",
    "- Be polite and respectful at all times, never pushy, never argue. A clear \"no\" is respected: thank them warmly.",
    "- You are a senior expert in THIS business's field: explain simply and confidently like a professional who knows the domain, but prices, policies, availability and promises come ONLY from the business information.",
    "- Never mention that you are reading instructions, a prompt, a system, a funnel or tools.",
  ].join("\n");
}

/** Very short listener sounds — while the agent speaks these are NOT a request to stop talking. */
const BACKCHANNEL =
  /^(?:כן|כן כן|אהה|אה|אהא|אוקיי|אוקי|בסדר|נכון|ברור|מממ|ממ|יופי|טוב|וואלה|סבבה|uh-?huh|mm+|mhm|ok(?:ay)?|yeah|yes|right|sure|aha|نعم|اه|أه|تمام|ماشي|طيب|اوكي)[.!?,…\s]*$/i;
export function isBackchannel(text: string): boolean {
  return BACKCHANNEL.test((text ?? "").trim());
}

/** The caller corrects the agent ("לא, אמרתי…", "זה לא נכון", "you got it wrong"). */
export function isCorrection(text: string): boolean {
  return /^(?:לא[,.!\s]|לא\s*נכון|טעית|זה\s*לא\s*(?:מה\s*ש|נכון)|אמרתי\s|התכוונתי|no[,.!\s]+(?:i\s+said|it'?s)|that'?s\s+(?:not|wrong)|you\s+got\s+it\s+wrong|i\s+meant|لا[،,.\s]|قلت\s|قصدت)/i.test((text ?? "").trim());
}

/**
 * Does the utterance sound unfinished (the caller paused mid-sentence)? Then the agent waits a bit
 * longer before answering instead of cutting them off.
 */
export function soundsUnfinished(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  if (/[.?!؟]$/.test(t)) return false;
  return /(?:^|\s)(?:ו|אבל|כי|ש|אז|או|גם|עם|של|על|את|אני|רציתי|רק|and|but|so|because|or|with|the|a|i|to|و|لكن|لأن|أو|مع)$/i.test(t) || /[,،-]$/.test(t);
}

const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** Word-overlap similarity of two sentences (0..1). */
export function sentenceSimilarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * Removes sentences the agent already said in this call (near-duplicates), so it never sounds like a
 * broken record. Keeps at least the last sentence when everything would be dropped.
 */
export function dropRepeats(reply: string, previous: string[], threshold = 0.8): { text: string; dropped: number } {
  const sentences = (reply ?? "").split(/(?<=[.!?؟])\s+/).map((s) => s.trim()).filter(Boolean);
  const prev = previous.flatMap((p) => p.split(/(?<=[.!?؟])\s+/)).map((s) => s.trim()).filter((s) => words(s).length >= 3);
  const kept = sentences.filter((s) => words(s).length < 4 || !prev.some((p) => sentenceSimilarity(s, p) >= threshold));
  const out = kept.length ? kept : sentences.slice(-1);
  return { text: out.join(" "), dropped: sentences.length - out.length };
}

/** Is the whole reply basically the same as one of the last replies? (→ ask the model again). */
export function isRepeatReply(reply: string, previous: string[], threshold = 0.85): boolean {
  return words(reply).length >= 4 && previous.slice(-3).some((p) => sentenceSimilarity(reply, p) >= threshold);
}

/** Spoken-length guard: at most `maxWords` words, cut at a sentence end when possible. */
export function spokenTurn(text: string, maxWords = 45): string {
  const clean = (text ?? "")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>|~•]/g, " ")
    .replace(/^\s*[-–]\s+/gm, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const w = clean.split(" ");
  if (w.length <= maxWords) return clean;
  const cut = w.slice(0, maxWords).join(" ");
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > cut.length * 0.4 ? cut.slice(0, end + 1) : `${cut}…`).trim();
}

/** What to say when the caller is silent (1st time: gentle check, 2nd: polite goodbye). */
export function silenceLine(lang: PhoneLang, n: number): { say: string; end: boolean } {
  if (n <= 1) return { say: { he: "אתה עדיין איתי?", en: "Are you still with me?", ar: "هل ما زلت معي؟" }[lang], end: false };
  return { say: { he: "נראה שהקו נותק. נשמח לחזור אליך — יום נעים!", en: "It seems the line dropped. We'll be happy to get back to you — have a great day!", ar: "يبدو أن الخط انقطع. يسعدنا أن نعاود الاتصال — يوماً سعيداً!" }[lang], end: true };
}

/** "Sorry, I didn't catch that" — varied, short. */
export function notHeardLine(lang: PhoneLang, n: number): string {
  const he = ["סליחה, לא שמעתי טוב — אפשר לחזור על זה?", "הקו קצת קוטע, תוכל להגיד שוב?", "לא קלטתי את החלק האחרון, אפשר שוב?"];
  const en = ["Sorry, I didn't catch that — could you say it again?", "The line is breaking up a bit, could you repeat that?", "I missed the last part, could you say it again?"];
  const ar = ["عذراً، لم أسمع جيداً — هل يمكنك الإعادة؟", "الخط يتقطع قليلاً، هل يمكنك الإعادة؟", "فاتني الجزء الأخير، هل يمكنك الإعادة؟"];
  const list = { he, en, ar }[lang];
  return list[Math.abs(n) % list.length]!;
}

export interface PhonePromptInput {
  lang: PhoneLang;
  agentName: string;
  orgName: string;
  direction: "in" | "out";
  businessInstructions: string;
  businessData: string;
  /** optional sections built by the shared brains (each may be empty) */
  sections: string[];
  callerKnown: boolean;
}

/** The full system prompt of the phone agent. */
export function phoneSystemPrompt(i: PhonePromptInput): string {
  const opening =
    i.direction === "out"
      ? `You are "${i.agentName}" from "${i.orgName}" and YOU called the customer. Open politely: say who you are and why you are calling in one sentence, then ask if it's a good time.`
      : `You are "${i.agentName}", the phone representative of "${i.orgName}". A customer called the business.`;
  return [
    opening,
    phoneStyleRules(i.lang),
    "GOAL: help like a senior closer — understand the need, qualify (what, when, budget), show the value that fits, handle objections calmly, and lead to a clear next step (a booked meeting, an order, or a call back). Ask for the caller's name naturally if it is not known.",
    i.callerKnown ? "The caller is an existing contact — use what you remember naturally (never recite it)." : "",
    `Business instructions:\n${i.businessInstructions.slice(0, 4000)}`,
    i.businessData ? `Business data:\n${i.businessData.slice(0, 3000)}` : "",
    ...i.sections.filter(Boolean),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** How the booked time is said aloud ("יום שלישי, 3 בנובמבר, ב-10:00"). */
export function spokenWhen(iso: string, lang: PhoneLang, timeZone: string): string {
  try {
    const d = new Date(iso);
    const loc = lang === "en" ? "en-US" : lang === "ar" ? "ar" : "he-IL";
    const day = new Intl.DateTimeFormat(loc, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    return lang === "en" ? `${day} at ${time}` : lang === "ar" ? `${day} الساعة ${time}` : `${day} ב-${time}`;
  } catch {
    return iso;
  }
}

/** The call summary prompt (for the CRM). */
export function summaryPrompt(lang: PhoneLang): string {
  return [
    `Summarise this phone call for the business team in ${LANG_NAME[lang]}.`,
    "Format (plain text, no markdown): 1) one sentence: who called and what they wanted; 2) the outcome (booked / interested / not interested / needs follow-up / transferred); 3) the next step and when; 4) important details (budget, objections, preferences). Max 4 short lines. Only facts from the transcript.",
  ].join("\n");
}
