/**
 * Upgrade 8 / stage A — the "waiting for a reply" queue and the response-time SLA (pure, unit-tested). Customers who wrote and
 * did not get an answer are ordered by AGE and VALUE; the average is shown next to the MEDIAN (one old conversation must not
 * hide that most were answered quickly); the service employee handles this queue first in every tick.
 */
export type Lang = "he" | "en" | "ar";

export interface WaitingConversation {
  id: string;
  contactId?: string | null;
  /** when the customer's last message arrived */
  waitingSince: string | number;
  /** open deal value of the customer, if any (same currency) */
  value?: number | null;
  /** an automated sender / robot — never queued */
  automated?: boolean;
  /** the customer already got an answer after waitingSince */
  answeredAt?: string | number | null;
}

const ts = (v: string | number) => (typeof v === "number" ? v : Date.parse(v));

export interface QueueItem {
  id: string;
  contactId: string | null;
  waitingMin: number;
  value: number;
  score: number;
  state: "ok" | "warning" | "breached";
}

/** age in minutes × a value weight: old and valuable first; very old (over 3 days) conversations are pushed down — they need a person's judgement, not a rush */
export function queueScore(waitingMin: number, value: number): number {
  const age = Math.min(waitingMin, 72 * 60);
  const valueWeight = 1 + Math.min(4, Math.log10(1 + Math.max(0, value)) / 1.5);
  return Math.round(age * valueWeight);
}

export function buildQueue(rows: WaitingConversation[], now: number, targetMin = 60): QueueItem[] {
  return rows
    .filter((r) => !r.automated && !r.answeredAt)
    .map((r) => {
      const waitingMin = Math.max(0, Math.round((now - ts(r.waitingSince)) / 60_000));
      const value = Math.max(0, r.value ?? 0);
      return { id: r.id, contactId: r.contactId ?? null, waitingMin, value, score: queueScore(waitingMin, value), state: (waitingMin > targetMin ? "breached" : waitingMin >= targetMin * 0.75 ? "warning" : "ok") as QueueItem["state"] };
    })
    .sort((a, b) => b.score - a.score || b.waitingMin - a.waitingMin);
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export interface ResponseStats {
  total: number;
  breached: number;
  avgMinutes: number;
  medianMinutes: number;
  /** share of conversations answered within the target, 0..1 */
  withinTarget: number;
}

/** the response-time numbers for a period: the median next to the average */
export function responseStats(minutes: number[], targetMin = 60): ResponseStats {
  const total = minutes.length;
  const avg = total ? Math.round(minutes.reduce((a, b) => a + b, 0) / total) : 0;
  const ok = minutes.filter((m) => m <= targetMin).length;
  return { total, breached: total - ok, avgMinutes: avg, medianMinutes: median(minutes), withinTarget: total ? ok / total : 1 };
}

export interface SlaAlert {
  level: "none" | "warn" | "alert";
  code: "ok" | "queue_old" | "many_breaches" | "median_over_target";
}

/** an SLA alert: any waiting customer over the target, or too many breaches, or even the median over the target */
export function slaAlert(queue: QueueItem[], stats: ResponseStats, targetMin = 60): SlaAlert {
  if (stats.total >= 3 && stats.medianMinutes > targetMin) return { level: "alert", code: "median_over_target" };
  if (stats.total >= 5 && stats.breached / stats.total >= 0.3) return { level: "alert", code: "many_breaches" };
  if (queue.some((q) => q.state === "breached")) return { level: "warn", code: "queue_old" };
  return { level: "none", code: "ok" };
}

/** the service employee's tick: the conversations to handle first, at most `limit` */
export function nextToHandle(queue: QueueItem[], limit = 5): QueueItem[] {
  return queue.slice(0, Math.max(0, limit));
}

const TXT: Record<Lang, { ok: string; queue_old: string; many_breaches: string; median_over_target: string }> = {
  he: { ok: "זמני התגובה תקינים.", queue_old: "יש לקוחות שממתינים למענה מעבר ליעד.", many_breaches: "שיעור גבוה של פניות שחרגו מיעד זמן התגובה.", median_over_target: "גם חציון זמן התגובה גבוה מהיעד — צריך לטפל בזה היום." },
  en: { ok: "Response times are fine.", queue_old: "Some customers are waiting longer than the target.", many_breaches: "A high share of requests missed the response-time target.", median_over_target: "Even the median response time is over the target — this needs attention today." },
  ar: { ok: "أوقات الاستجابة جيدة.", queue_old: "بعض العملاء ينتظرون أكثر من الهدف.", many_breaches: "نسبة عالية من الطلبات تجاوزت هدف زمن الاستجابة.", median_over_target: "حتى وسيط زمن الاستجابة أعلى من الهدف — يلزم التعامل مع ذلك اليوم." },
};
export const slaAlertText = (a: SlaAlert, lang: Lang): string => TXT[lang][a.code];

/** the line shown on the screen: "median 12 min · average 1093 min · target 60" */
export function statsLine(s: ResponseStats, targetMin: number, lang: Lang): string {
  return lang === "he" ? `חציון ${s.medianMinutes} דק׳ · ממוצע ${s.avgMinutes} דק׳ · יעד ${targetMin} דק׳ · ${s.breached} חריגות מתוך ${s.total}` : lang === "ar" ? `الوسيط ${s.medianMinutes} د · المتوسط ${s.avgMinutes} د · الهدف ${targetMin} د · ${s.breached} تجاوزات من ${s.total}` : `median ${s.medianMinutes} min · average ${s.avgMinutes} min · target ${targetMin} · ${s.breached} breaches of ${s.total}`;
}
