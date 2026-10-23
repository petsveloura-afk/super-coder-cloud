/**
 * Wave 16 — quality & budget guardrails for the AI agent (pure, unit-tested).
 * Settings live in ai_agents.guardrails:
 *   max_replies_per_day  AI replies per conversation per 24h (0 = no limit) → then a person
 *   banned               phrases the agent must never send (e.g. "guaranteed", "free forever")
 *   price_guard          a price that is not in the business data → a person checks first
 *   angry_handoff        an angry / threatening customer → a person right away
 *   kb                   answer support questions from the knowledge base
 *   voice_replies        answer voice notes with a voice note (when a TTS key exists)
 */
export interface Guardrails {
  max_replies_per_day?: number;
  banned?: string[];
  price_guard?: boolean;
  angry_handoff?: boolean;
  kb?: boolean;
  voice_replies?: boolean;
}

export function normalizeGuardrails(raw: unknown): Required<Guardrails> {
  const g = (raw && typeof raw === "object" ? raw : {}) as Guardrails;
  const n = Number(g.max_replies_per_day);
  return {
    max_replies_per_day: Number.isFinite(n) && n > 0 ? Math.min(500, Math.round(n)) : 0,
    banned: Array.isArray(g.banned) ? g.banned.map((x) => String(x).trim()).filter((x) => x.length >= 2).slice(0, 50) : [],
    price_guard: g.price_guard === true,
    angry_handoff: g.angry_handoff !== false,
    kb: g.kb !== false,
    voice_replies: g.voice_replies === true,
  };
}

const ANGRY = [
  /נוכל|רמאי|רמאות|גנבים|גנבתם|תביעה|אתבע|עורך\s?דין|עו"ד|שערורי|בושה\s+וחרפה|גרועים|הכי\s+גרוע|לא\s+מקובל|חוצפה|מטומטמ|זבל|אני\s+(?:כועס|עצבני|מאוכזב)/,
  /\b(?:scam|scammers?|fraud|lawyer|sue|lawsuit|unacceptable|ridiculous|worst|disgusting|furious|angry|rip[\s-]?off)\b/i,
  /نصاب|نصابين|محامي|سيء\s+جدا|احتيال|غاضب|مقرف/,
];

export function isAngry(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return ANGRY.some((re) => re.test(t));
}

export function bannedHit(reply: string, banned: string[]): string | null {
  const low = reply.toLowerCase();
  for (const b of banned) if (b && low.includes(b.toLowerCase())) return b;
  return null;
}

const CURRENCY = "(?:₪|ש[\"״']?ח|שקל(?:ים)?|nis|ils|\\$|usd|€|eur|شيكل|شيقل)";
const PRICE_RE = new RegExp(`(?:${CURRENCY}\\s*(\\d[\\d,]*(?:\\.\\d+)?))|(?:(\\d[\\d,]*(?:\\.\\d+)?)\\s*${CURRENCY})`, "gi");

/** Prices in the reply (numbers next to a currency). */
export function pricesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const raw = (m[1] ?? m[2] ?? "").replace(/,/g, "");
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

/** Prices the agent wrote that do not exist anywhere in the business data. */
export function unknownPrices(reply: string, known: string): number[] {
  const knownNums = new Set((known.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, ""))).filter((x) => Number.isFinite(x)));
  return pricesIn(reply).filter((p) => !knownNums.has(p));
}

export function guardrailHandoffText(locale: string, kind: "budget" | "angry" | "check"): string {
  const he = { budget: "תודה על הסבלנות 🙏 נציג מהצוות ימשיך איתך כאן בהקדם.", angry: "אני מצטער מאוד שזו החוויה 🙏 אני מעביר את השיחה כבר עכשיו לאדם מהצוות שיטפל בזה אישית.", check: "רגע, אני מוודא את הפרט הזה מול הצוות כדי לתת לך תשובה מדויקת. נחזור אליך כאן בהקדם 🙏" };
  const en = { budget: "Thanks for your patience 🙏 a team member will continue with you here shortly.", angry: "I'm really sorry about this 🙏 I'm passing the conversation to a person from the team right now.", check: "Let me double-check that detail with the team so you get an exact answer — we'll get back to you here shortly 🙏" };
  const ar = { budget: "شكراً لصبرك 🙏 سيكمل معك أحد أفراد الفريق هنا قريباً.", angry: "نأسف جداً لذلك 🙏 أحوّل المحادثة الآن إلى أحد أفراد الفريق ليهتم بالأمر شخصياً.", check: "دعني أتأكد من هذه التفصيلة مع الفريق لأعطيك جواباً دقيقاً — سنعود إليك هنا قريباً 🙏" };
  return (locale === "en" ? en : locale === "ar" ? ar : he)[kind];
}

/** Knowledge-base articles as a prompt block (the agent answers from them when relevant). */
export function kbBlock(articles: { title: string; body: string }[]): string {
  if (!articles.length) return "";
  const parts = articles.slice(0, 4).map((a, i) => `[${i + 1}] ${a.title.replace(/[<>]/g, "")}\n${a.body.replace(/[<>]/g, "").slice(0, 1500)}`);
  return [
    "Knowledge base of the business (help-center articles). When the customer's question is answered here, answer ONLY from these facts, briefly, in the customer's language. If it is not covered, do not invent — offer to check with the team.",
    "<kb>",
    ...parts,
    "</kb>",
  ].join("\n");
}
