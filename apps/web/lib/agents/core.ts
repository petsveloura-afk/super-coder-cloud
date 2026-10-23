/**
 * Wave 19 — the business's AI team (pure helpers, unit-tested).
 *   marketing      weekly content plan → post drafts (Facebook / Instagram), comment replies
 *   sales_manager  every morning: deals that went quiet → a task for the owner + next step
 *   analyst        every morning: yesterday in numbers, what changed, what to do today
 *   collections    overdue invoices → polite → firm reminders with the payment link; abandoned carts
 */
export const AGENTS = ["marketing", "sales_manager", "analyst", "collections"] as const;
export type AgentKey = (typeof AGENTS)[number];

export interface AgentDefaults {
  minutes: number;
  config: Record<string, number | boolean | string>;
}

export const AGENT_DEFAULTS: Record<AgentKey, AgentDefaults> = {
  marketing: { minutes: 7 * 24 * 60, config: { posts: 3, auto_publish: false } },
  sales_manager: { minutes: 24 * 60, config: { quiet_days: 7, max_tasks: 5 } },
  analyst: { minutes: 20 * 60, config: { email: true } },
  collections: { minutes: 6 * 60, config: { gap_days: 3, max_reminders: 3, carts: true } },
};

/** Morning agents run between 07:00 and 10:59 in the business's time zone. */
export function isMorning(tz: string, now = new Date()): boolean {
  try {
    const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz || "Asia/Jerusalem" }).format(now));
    return h >= 7 && h <= 10;
  } catch {
    return true;
  }
}

export interface DayMetrics {
  leads: number;
  conversations: number;
  aiReplies: number;
  avgReplyMs: number | null;
  wonValue: number;
  wonCount: number;
  revenue: number;
  overdueTotal: number;
  appointmentsToday: number;
  waiting: number;
  hotLeads: number;
}

/** Change vs. the 7-day daily average: "↑ 40%" / "↓ 25%" / null (no history or < 15% move). */
export function trend(today: number, weekAvg: number): string | null {
  if (!(weekAvg > 0)) return today > 0 ? "new" : null;
  const pct = Math.round(((today - weekAvg) / weekAvg) * 100);
  if (Math.abs(pct) < 15) return null;
  return pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`;
}

/** Deterministic part of the brief (works without AI): the items that need attention first. */
export function attentionItems(m: DayMetrics, locale: "he" | "en" | "ar"): string[] {
  const he = locale === "he";
  const ar = locale === "ar";
  const out: string[] = [];
  if (m.waiting > 0) out.push(he ? `${m.waiting} שיחות מחכות לתשובה של אדם` : ar ? `${m.waiting} محادثات تنتظر ردًا من شخص` : `${m.waiting} conversations are waiting for a person`);
  if (m.hotLeads > 0) out.push(he ? `${m.hotLeads} לידים חמים בלי משימה פתוחה` : ar ? `${m.hotLeads} عملاء محتملون ساخنون بلا مهمة` : `${m.hotLeads} hot leads without an open task`);
  if (m.overdueTotal > 0) out.push(he ? `חשבוניות באיחור: ₪${Math.round(m.overdueTotal).toLocaleString("he-IL")}` : ar ? `فواتير متأخرة: ₪${Math.round(m.overdueTotal)}` : `Overdue invoices: ₪${Math.round(m.overdueTotal)}`);
  if (m.appointmentsToday > 0) out.push(he ? `${m.appointmentsToday} פגישות היום` : ar ? `${m.appointmentsToday} مواعيد اليوم` : `${m.appointmentsToday} meetings today`);
  if (m.avgReplyMs != null && m.avgReplyMs > 30_000) out.push(he ? "הסוכן ענה לאט אתמול — כדאי לבדוק בניהול → מהירות התגובה" : ar ? "الوكيل كان بطيئًا أمس" : "The agent answered slowly yesterday — check Admin → Response speed");
  return out;
}

/** Collections: the tone of the n-th reminder (1 friendly, 2 clear, 3 final + the team takes over). */
export function reminderTone(n: number): "friendly" | "clear" | "final" {
  return n <= 0 ? "friendly" : n === 1 ? "clear" : "final";
}

export function overdueText(locale: "he" | "en" | "ar", input: { name: string | null; number: string; balance: number; currency: string; days: number; url: string; org: string; tone: "friendly" | "clear" | "final" }): string {
  const money = `${input.currency === "ILS" ? "₪" : `${input.currency} `}${input.balance.toLocaleString(locale === "en" ? "en-US" : "he-IL", { maximumFractionDigits: 2 })}`;
  const hi = input.name ? input.name.split(" ")[0] : "";
  if (locale === "en") {
    if (input.tone === "friendly") return `Hi ${hi} 👋 a friendly reminder from ${input.org}: invoice #${input.number} (${money}) is ${input.days} days past due. You can pay securely here: ${input.url}\nAlready paid? Just ignore this 🙏`;
    if (input.tone === "clear") return `Hi ${hi}, invoice #${input.number} from ${input.org} (${money}) is still open, ${input.days} days after the due date. Please pay here: ${input.url} — or reply if anything is unclear.`;
    return `Hi ${hi}, this is a last reminder for invoice #${input.number} (${money}), ${input.days} days overdue. Pay here: ${input.url}. A member of our team will contact you shortly.`;
  }
  if (locale === "ar") {
    if (input.tone === "friendly") return `مرحبًا ${hi} 👋 تذكير ودّي من ${input.org}: الفاتورة رقم ${input.number} (${money}) متأخرة ${input.days} أيام. للدفع الآمن: ${input.url}\nإذا دفعت بالفعل تجاهل هذه الرسالة 🙏`;
    if (input.tone === "clear") return `مرحبًا ${hi}، الفاتورة رقم ${input.number} من ${input.org} (${money}) لا تزال مفتوحة منذ ${input.days} أيام. للدفع: ${input.url}`;
    return `مرحبًا ${hi}، هذا تذكير أخير بالفاتورة رقم ${input.number} (${money}). للدفع: ${input.url}. سيتواصل معك أحد أفراد الفريق قريبًا.`;
  }
  if (input.tone === "friendly") return `היי ${hi} 👋 תזכורת ידידותית מ${input.org}: חשבונית מס' ${input.number} (${money}) באיחור של ${input.days} ימים. אפשר לשלם כאן בצורה מאובטחת: ${input.url}\nכבר שילמת? אפשר להתעלם 🙏`;
  if (input.tone === "clear") return `היי ${hi}, חשבונית מס' ${input.number} מ${input.org} (${money}) עדיין פתוחה, ${input.days} ימים אחרי מועד התשלום. לתשלום: ${input.url} — ואם משהו לא ברור, אפשר לענות כאן.`;
  return `היי ${hi}, זו תזכורת אחרונה לחשבונית מס' ${input.number} (${money}), באיחור של ${input.days} ימים. לתשלום: ${input.url}. נציג מהצוות ייצור איתך קשר בקרוב.`;
}

export function cartText(locale: "he" | "en" | "ar", input: { name: string | null; org: string; url: string | null; total: number; currency: string }): string {
  const hi = input.name ? input.name.split(" ")[0] : "";
  const link = input.url ? `\n${input.url}` : "";
  if (locale === "en") return `Hi ${hi} 👋 you left a few items in your cart at ${input.org}. They're saved for you — complete the order here:${link}\nQuestions? Just reply.`;
  if (locale === "ar") return `مرحبًا ${hi} 👋 تركت بعض المنتجات في سلة ${input.org}. حفظناها لك — أكمل الطلب هنا:${link}`;
  return `היי ${hi} 👋 השארת כמה מוצרים בעגלה ב${input.org}. שמרנו לך אותם — אפשר להשלים את ההזמנה כאן:${link}\nיש שאלה? אפשר לענות כאן.`;
}

/** Spread N posts over the next 7 days at good hours (10:00 / 13:00 / 19:00 local). */
export function scheduleSlots(n: number, from: Date): Date[] {
  const hours = [10, 19, 13];
  const out: Date[] = [];
  const count = Math.max(1, Math.min(14, n));
  const gap = 7 / count;
  for (let i = 0; i < count; i++) {
    const d = new Date(from.getTime() + Math.round((i * gap + 1) * 86_400_000));
    d.setUTCHours(hours[i % hours.length]! - 3, 0, 0, 0); // ≈ Israel time
    out.push(d);
  }
  return out;
}

/** Parses the marketing agent's JSON plan: [{text, image_prompt?, platforms?}] (tolerant). */
export function parsePostPlan(raw: string, max: number): { text: string; platforms: ("facebook" | "instagram")[] }[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const list = JSON.parse(m[0]) as { text?: unknown; platforms?: unknown }[];
    return list
      .filter((p) => typeof p?.text === "string" && (p.text as string).trim().length >= 10)
      .slice(0, Math.max(1, Math.min(14, max)))
      .map((p) => ({
        text: String(p.text).trim().slice(0, 2200),
        platforms: (Array.isArray(p.platforms) ? p.platforms : ["facebook"]).filter((x): x is "facebook" | "instagram" => x === "facebook" || x === "instagram").slice(0, 2) as ("facebook" | "instagram")[],
      }))
      .map((p) => ({ ...p, platforms: p.platforms.length ? p.platforms : (["facebook"] as ("facebook" | "instagram")[]) }));
  } catch {
    return [];
  }
}
