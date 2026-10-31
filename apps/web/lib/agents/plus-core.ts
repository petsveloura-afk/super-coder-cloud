/**
 * Wave 54 — two more members of the AI team (pure helpers, unit-tested).
 *   reviews_requester  after a completed meeting / a won deal → asks the customer for a review (with the link)
 *   reengage           customers / leads who went quiet → a short, personal check-in written by the AI
 * Both message customers ONLY through the conversation guard (consent, opt-out, caps, quiet hours, 24h windows).
 */
export const AGENTS_PLUS = ["reviews_requester", "reengage"] as const;
export type PlusAgentKey = (typeof AGENTS_PLUS)[number];

export interface PlusDefaults {
  minutes: number;
  config: Record<string, number | boolean | string>;
}

export const PLUS_DEFAULTS: Record<PlusAgentKey, PlusDefaults> = {
  reviews_requester: { minutes: 6 * 60, config: { review_url: "", days_after: 1, max_per_run: 10, meetings: true, deals: true, smart_gate: true } },
  reengage: { minutes: 24 * 60, config: { inactive_days: 30, target: "both", max_per_run: 5 } },
};

export function isPlusAgent(v: unknown): v is PlusAgentKey {
  return typeof v === "string" && (AGENTS_PLUS as readonly string[]).includes(v);
}

/** Settings fields shown in the hub, per agent (type drives the input). */
export const PLUS_FIELDS: Record<PlusAgentKey, { key: string; type: "number" | "text" | "boolean" | "select"; min?: number; max?: number; options?: string[] }[]> = {
  reviews_requester: [
    { key: "review_url", type: "text" },
    { key: "days_after", type: "number", min: 0, max: 14 },
    { key: "max_per_run", type: "number", min: 1, max: 50 },
    { key: "meetings", type: "boolean" },
    { key: "deals", type: "boolean" },
    // wave 59: ask "how was it?" first — happy → the review link, unhappy → the owner (privately)
    { key: "smart_gate", type: "boolean" },
  ],
  reengage: [
    { key: "inactive_days", type: "number", min: 7, max: 365 },
    { key: "target", type: "select", options: ["leads", "customers", "both"] },
    { key: "max_per_run", type: "number", min: 1, max: 30 },
  ],
};

/** Clamps / cleans a config coming from the form (unknown keys dropped). */
export function cleanPlusConfig(key: PlusAgentKey, raw: Record<string, unknown>): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = { ...PLUS_DEFAULTS[key].config };
  for (const f of PLUS_FIELDS[key]) {
    const v = raw[f.key];
    if (v === undefined) continue;
    if (f.type === "number") {
      const n = Math.round(Number(v));
      if (Number.isFinite(n)) out[f.key] = Math.max(f.min ?? 0, Math.min(f.max ?? 1000, n));
    } else if (f.type === "boolean") out[f.key] = v === true || v === "true" || v === "on";
    else if (f.type === "select") {
      if (f.options?.includes(String(v))) out[f.key] = String(v);
    } else {
      const s = String(v).trim().slice(0, 400);
      out[f.key] = f.key === "review_url" ? (/^https:\/\/\S+$/.test(s) ? s : "") : s;
    }
  }
  return out;
}

type Loc = "he" | "en" | "ar";

/** The review request (short, warm, one clear action). */
export function reviewRequestText(locale: Loc, input: { name: string | null; org: string; url: string | null; reason: "meeting" | "deal" }): string {
  const first = (input.name ?? "").trim().split(/\s+/)[0] ?? "";
  const hi = { he: first ? `היי ${first}` : "היי", en: first ? `Hi ${first}` : "Hi", ar: first ? `مرحباً ${first}` : "مرحباً" }[locale];
  const why = {
    he: input.reason === "meeting" ? `תודה שבחרת ב${input.org} 🙏` : `תודה שבחרת לעבוד עם ${input.org} 🙏`,
    en: `Thank you for choosing ${input.org} 🙏`,
    ar: `شكراً لاختيارك ${input.org} 🙏`,
  }[locale];
  const ask = input.url
    ? { he: `נשמח מאוד אם תקדיש/י דקה לכתוב לנו ביקורת — זה עוזר לנו המון:\n${input.url}`, en: `Would you take a minute to leave us a review? It helps us a lot:\n${input.url}`, ar: `يسعدنا أن تخصص دقيقة لكتابة تقييم لنا — هذا يساعدنا كثيراً:\n${input.url}` }[locale]
    : { he: "איך הייתה החוויה? נשמח לדירוג מ-1 עד 5 ומשפט קצר 😊", en: "How was your experience? We'd love a rating from 1 to 5 and a short line 😊", ar: "كيف كانت التجربة؟ يسعدنا تقييم من 1 إلى 5 وجملة قصيرة 😊" }[locale];
  return `${hi}! ${why}\n${ask}`;
}

/** Fallback check-in when the AI is not available. */
export function reengageFallback(locale: Loc, input: { name: string | null; org: string; customer: boolean }): string {
  const first = (input.name ?? "").trim().split(/\s+/)[0] ?? "";
  if (locale === "en") return `Hi${first ? ` ${first}` : ""}! It's ${input.org} 👋 ${input.customer ? "We haven't seen you in a while — is there anything we can help you with?" : "Just checking in — are you still looking for a solution? Happy to help."}`;
  if (locale === "ar") return `مرحباً${first ? ` ${first}` : ""}! معك ${input.org} 👋 ${input.customer ? "اشتقنا لك — هل هناك ما يمكننا مساعدتك به؟" : "نطمئن عليك — هل ما زلت تبحث عن حل؟ يسعدنا المساعدة."}`;
  return `היי${first ? ` ${first}` : ""}! כאן ${input.org} 👋 ${input.customer ? "מזמן לא דיברנו — יש משהו שנוכל לעזור בו?" : "רק בודקים — עדיין מחפש/ת פתרון? נשמח לעזור."}`;
}

/** The AI's check-in must be short and clean: one paragraph, no markers, bounded. */
export function cleanCheckIn(raw: string | null | undefined): string | null {
  const t = (raw ?? "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length < 15 || t.length > 600) return null;
  return t;
}
