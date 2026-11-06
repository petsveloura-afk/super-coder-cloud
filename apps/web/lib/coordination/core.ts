/**
 * Agent coordination (pure, unit-tested) — one rule for every agent in the platform: before an agent proactively reaches a customer
 * for a purpose, it claims that customer for a window; another agent with the same purpose steps aside until the window ends.
 *   outreach  a proactive message (re-engagement, review request, abandoned cart, a team employee's message)   — 24 hours
 *   money     a payment reminder (collections agent, a team employee's reminder)                               — 20 hours
 *   task      a follow-up opened for the owner (sales manager, opportunity scan)                                — 20 hours
 * Replies inside a live conversation are NOT claims (the conversation guard handles them). A person's explicit action always wins.
 */
export type Lane = "outreach" | "money" | "task";
export type Lang = "he" | "en" | "ar";

export const LANE_MINUTES: Record<Lane, number> = { outreach: 24 * 60, money: 20 * 60, task: 20 * 60 };

/** owner ids: "<system>:<role>" — system smart (the smart team) | team (my digital team) | operator | person */
export const OWNERS = ["smart:collections", "smart:reengage", "smart:reviews", "smart:carts", "smart:sales_manager", "smart:agent", "team:employee", "operator:run", "person:owner"] as const;
export type Owner = (typeof OWNERS)[number];

/** which owner + lane a messageContact call belongs to (from the meta every caller already passes) */
export function claimForMessage(kind: "reminder" | "automation", meta: Record<string, unknown>): { lane: Lane; owner: Owner; minutes: number } {
  const lane: Lane = kind === "reminder" ? "money" : "outreach";
  const owner: Owner = meta.team ? "team:employee" : meta.operator ? "operator:run" : meta.invoice_id ? "smart:collections" : meta.reengage ? "smart:reengage" : meta.review_request ? "smart:reviews" : meta.cart ? "smart:carts" : "smart:agent";
  return { lane, owner, minutes: LANE_MINUTES[lane] };
}

const LABELS: Record<string, Record<Lang, string>> = {
  "smart:collections": { he: "סוכן הגבייה (הצוות החכם)", en: "Collections agent (smart team)", ar: "وكيل التحصيل (الفريق الذكي)" },
  "smart:reengage": { he: "סוכן החזרת לקוחות (הצוות החכם)", en: "Re-engagement agent (smart team)", ar: "وكيل إعادة التفاعل (الفريق الذكي)" },
  "smart:reviews": { he: "סוכן הביקורות (הצוות החכם)", en: "Reviews agent (smart team)", ar: "وكيل المراجعات (الفريق الذكي)" },
  "smart:carts": { he: "תזכורות עגלה נטושה (הצוות החכם)", en: "Abandoned carts (smart team)", ar: "السلات المتروكة (الفريق الذكي)" },
  "smart:sales_manager": { he: "מנהל המכירות (הצוות החכם)", en: "Sales manager (smart team)", ar: "مدير المبيعات (الفريق الذكي)" },
  "smart:agent": { he: "הצוות החכם", en: "Smart team", ar: "الفريق الذكي" },
  "team:employee": { he: "עובד/ת בצוות שלי", en: "My team employee", ar: "موظف في فريقي" },
  "operator:run": { he: "סוכן הביצוע", en: "Operator agent", ar: "وكيل التنفيذ" },
  "person:owner": { he: "את/ה (פעולה ידנית)", en: "You (manual action)", ar: "أنت (إجراء يدوي)" },
};

export function ownerLabel(owner: string, lang: Lang): string {
  const exact = LABELS[owner];
  if (exact) return exact[lang];
  const sys = owner.split(":")[0];
  const fall = LABELS[sys === "team" ? "team:employee" : sys === "operator" ? "operator:run" : sys === "person" ? "person:owner" : "smart:agent"]!;
  return fall[lang];
}

/** the line an employee sees when another agent already handles this customer (added to its contact brief) */
export function claimsBriefLine(rows: { lane: string; owner: string; until: string }[], now = Date.now()): string {
  const live = rows.filter((r) => Date.parse(r.until) > now);
  if (!live.length) return "";
  return `handled now by other agents (do not repeat their work): ${live.map((r) => `${r.lane} → ${r.owner} for ${Math.max(1, Math.round((Date.parse(r.until) - now) / 3_600_000))}h`).join("; ")}`;
}

/** the reason shown in a run / tool result when an agent stepped aside */
export function steppedAside(holder: string, lang: Lang): string {
  const who = ownerLabel(holder, lang);
  return lang === "en" ? `${who} is already handling this customer — stepped aside to avoid a double message.` : lang === "ar" ? `${who} يتولى هذا العميل الآن — تراجعتُ لتجنّب رسالة مكررة.` : `${who} כבר מטפל/ת בלקוח הזה — נמנעתי כדי שלא תצא הודעה כפולה.`;
}

/** the harmony score of the coordination board (100 = no overlaps tried; overlaps that were stopped cost only a little) */
export function harmonyScore(input: { active: number; prevented7d: number }): number {
  if (input.prevented7d <= 0) return 100;
  return Math.max(70, 100 - Math.round(Math.log2(1 + input.prevented7d) * 4));
}
