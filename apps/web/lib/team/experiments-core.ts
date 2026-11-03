/**
 * Upgrade 7 / stage F — recommendations and A/B experiments (pure). Every recommendation has an owner and ONE deciding metric.
 * A verdict needs the minimum sample size in BOTH arms and the minimum number of days; before that the only honest answer is
 * "not enough data". No peeking: the test is evaluated only at the planned sample size.
 */
import { normalCdf } from "./goals-core";

export type Lang = "he" | "en" | "ar";
export type ExpStatus = "proposed" | "running" | "concluded" | "stopped";
export type Verdict = "not_enough_data" | "keep_running" | "b_wins" | "a_wins" | "no_difference";

export interface Arm {
  name: string;
  trials: number;
  successes: number;
}
export interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  metric: string;
  owner: string | null;
  status: ExpStatus;
  baseline_rate: number | null;
  /** the smallest relative improvement worth acting on (default 0.2 = +20%) */
  min_effect: number;
  min_days: number;
  started_at: string | null;
  a: Arm;
  b: Arm;
}

const z = (p: number): number => {
  // inverse normal CDF (Acklam-style rational approximation, enough for alpha / power lookups)
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -z(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
};

/** the sample size PER ARM to detect a relative lift of `minEffect` over `baselineRate` (two-sided alpha 0.05, power 0.8) */
export function minSampleSize(baselineRate: number, minEffect = 0.2, alpha = 0.05, power = 0.8): number {
  const p1 = Math.min(0.99, Math.max(0.001, baselineRate));
  const p2 = Math.min(0.999, p1 * (1 + minEffect));
  if (p2 <= p1) return Infinity;
  const za = z(1 - alpha / 2);
  const zb = z(power);
  const pbar = (p1 + p2) / 2;
  const n = ((za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2) / (p2 - p1) ** 2;
  return Math.ceil(n);
}

export interface Analysis {
  verdict: Verdict;
  neededPerArm: number;
  rateA: number | null;
  rateB: number | null;
  /** relative lift of B over A */
  lift: number | null;
  pValue: number | null;
  /** 95% interval of the absolute difference B − A */
  ci: [number, number] | null;
  daysRunning: number;
  reason: string;
}

export function analyze(e: Pick<Experiment, "a" | "b" | "baseline_rate" | "min_effect" | "min_days" | "started_at">, now = Date.now()): Analysis {
  const ra = e.a.trials ? e.a.successes / e.a.trials : null;
  const rb = e.b.trials ? e.b.successes / e.b.trials : null;
  const base = e.baseline_rate ?? ra ?? 0.1;
  const needed = minSampleSize(base, e.min_effect);
  const days = e.started_at ? Math.max(0, Math.floor((now - Date.parse(e.started_at)) / 86_400_000)) : 0;
  const common = { neededPerArm: needed, rateA: ra, rateB: rb, daysRunning: days };
  const bad = e.a.successes > e.a.trials || e.b.successes > e.b.trials || e.a.successes < 0 || e.b.successes < 0;
  if (bad) return { verdict: "not_enough_data", lift: null, pValue: null, ci: null, reason: "invalid_counts", ...common };
  const small = Math.min(e.a.trials, e.b.trials);
  if (small < needed || days < e.min_days) return { verdict: small < needed * 0.25 || e.a.trials === 0 || e.b.trials === 0 ? "not_enough_data" : "keep_running", lift: null, pValue: null, ci: null, reason: small < needed ? "sample_too_small" : "too_few_days", ...common };
  const pa = ra!;
  const pb = rb!;
  const pool = (e.a.successes + e.b.successes) / (e.a.trials + e.b.trials);
  const se0 = Math.sqrt(pool * (1 - pool) * (1 / e.a.trials + 1 / e.b.trials));
  const zs = se0 === 0 ? 0 : (pb - pa) / se0;
  const p = 2 * (1 - normalCdf(Math.abs(zs)));
  const se = Math.sqrt((pa * (1 - pa)) / e.a.trials + (pb * (1 - pb)) / e.b.trials);
  const ci: [number, number] = [pb - pa - 1.96 * se, pb - pa + 1.96 * se];
  const lift = pa > 0 ? (pb - pa) / pa : null;
  const verdict: Verdict = p < 0.05 ? (pb > pa ? "b_wins" : "a_wins") : "no_difference";
  return { verdict, lift, pValue: Math.round(p * 10000) / 10000, ci, reason: "sample_reached", ...common };
}

export function normalizeExperiment(raw: Record<string, unknown>): { exp: Pick<Experiment, "title" | "hypothesis" | "metric" | "baseline_rate" | "min_effect" | "min_days"> & { a_name: string; b_name: string } } | { rejected: string } {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const title = s(raw.title, 140);
  if (title.length < 3) return { rejected: "title" };
  const hypothesis = s(raw.hypothesis, 400);
  if (hypothesis.length < 5) return { rejected: "hypothesis" };
  const metric = s(raw.metric, 60);
  if (!metric) return { rejected: "metric" };
  const a = s(raw.variant_a, 160);
  const b = s(raw.variant_b, 160);
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return { rejected: "variants" };
  const br = raw.baseline_rate === undefined || raw.baseline_rate === "" ? null : Number(raw.baseline_rate);
  if (br !== null && (!Number.isFinite(br) || br <= 0 || br >= 1)) return { rejected: "baseline_rate" };
  const me = Number(raw.min_effect);
  return { exp: { title, hypothesis, metric, baseline_rate: br, min_effect: Number.isFinite(me) && me >= 0.05 && me <= 2 ? me : 0.2, min_days: 7, a_name: a, b_name: b } };
}

const T: Record<Lang, Record<Verdict, string>> = {
  he: { not_enough_data: "אין מספיק נתונים", keep_running: "ממשיכים לאסוף", b_wins: "גרסה B ניצחה", a_wins: "גרסה A ניצחה", no_difference: "אין הבדל מובהק" },
  en: { not_enough_data: "Not enough data", keep_running: "Keep collecting", b_wins: "Variant B wins", a_wins: "Variant A wins", no_difference: "No significant difference" },
  ar: { not_enough_data: "لا توجد بيانات كافية", keep_running: "نواصل جمع البيانات", b_wins: "النسخة B فازت", a_wins: "النسخة A فازت", no_difference: "لا فرق ملحوظ" },
};
export const verdictLabel = (v: Verdict, lang: Lang) => T[lang][v];

export function analysisLine(a: Analysis, e: Pick<Experiment, "a" | "b">, lang: Lang): string {
  const head = T[lang][a.verdict];
  const have = `${Math.min(e.a.trials, e.b.trials)}/${Number.isFinite(a.neededPerArm) ? a.neededPerArm : "∞"}`;
  if (a.lift === null || a.pValue === null) return lang === "he" ? `${head} (${have} לכל קבוצה, ${a.daysRunning} ימים)` : lang === "ar" ? `${head} (${have} لكل مجموعة، ${a.daysRunning} أيام)` : `${head} (${have} per group, ${a.daysRunning} days)`;
  const pct = `${a.lift >= 0 ? "+" : ""}${Math.round(a.lift * 100)}%`;
  return lang === "he" ? `${head}: שינוי ${pct}, p=${a.pValue}` : lang === "ar" ? `${head}: التغيّر ${pct}، p=${a.pValue}` : `${head}: change ${pct}, p=${a.pValue}`;
}

/** deterministic recommendation templates from facts — each with an owner role and the metric that decides */
export interface Recommendation {
  id: string;
  title: string;
  why: string;
  ownerRole: string;
  metric: string;
}
export function recommend(s: { replyMinutes?: number | null; unansweredOver1h?: number; leadConversionRate?: number | null; stuckDeals?: number; reviewsAvg?: number | null; goalsAtRisk?: number }, lang: Lang = "he"): Recommendation[] {
  const out: Recommendation[] = [];
  const t = (he: string, en: string, ar: string) => (lang === "he" ? he : lang === "ar" ? ar : en);
  if ((s.unansweredOver1h ?? 0) >= 3) out.push({ id: "reply_speed", title: t("לקצר זמן מענה ללקוחות", "Shorten the time to answer customers", "تقصير زمن الرد على العملاء"), why: t(`${s.unansweredOver1h} שיחות ממתינות מעל שעה`, `${s.unansweredOver1h} conversations wait more than an hour`, `${s.unansweredOver1h} محادثات تنتظر أكثر من ساعة`), ownerRole: "customer_service", metric: "reply_minutes" });
  if ((s.stuckDeals ?? 0) >= 3) out.push({ id: "stuck_deals", title: t("להזיז עסקאות תקועות", "Move stuck deals", "تحريك الصفقات العالقة"), why: t(`${s.stuckDeals} עסקאות ללא תנועה`, `${s.stuckDeals} deals without activity`, `${s.stuckDeals} صفقات بلا نشاط`), ownerRole: "sales", metric: "deals_won" });
  if (s.leadConversionRate != null && s.leadConversionRate < 0.1) out.push({ id: "lead_conversion", title: t("לבדוק ניסוח פתיחה ללידים (A/B)", "Test the opening message to leads (A/B)", "اختبار رسالة الافتتاح للعملاء المحتملين (A/B)"), why: t(`המרה של ${Math.round(s.leadConversionRate * 100)}% בלבד`, `Only ${Math.round(s.leadConversionRate * 100)}% convert`, `نسبة التحويل ${Math.round(s.leadConversionRate * 100)}% فقط`), ownerRole: "marketing", metric: "lead_conversion" });
  if (s.reviewsAvg != null && s.reviewsAvg < 4.2) out.push({ id: "reviews", title: t("לבקש ביקורות מלקוחות מרוצים", "Ask happy customers for reviews", "طلب تقييمات من العملاء الراضين"), why: t(`דירוג ממוצע ${s.reviewsAvg.toFixed(1)}`, `Average rating ${s.reviewsAvg.toFixed(1)}`, `متوسط التقييم ${s.reviewsAvg.toFixed(1)}`), ownerRole: "reputation", metric: "reviews_avg" });
  if ((s.goalsAtRisk ?? 0) > 0) out.push({ id: "goals_risk", title: t("לתכנן מחדש יעד בסיכון", "Re-plan a goal at risk", "إعادة تخطيط هدف في خطر"), why: t(`${s.goalsAtRisk} יעדים בסיכון`, `${s.goalsAtRisk} goals at risk`, `${s.goalsAtRisk} أهداف في خطر`), ownerRole: "manager", metric: "goal_progress" });
  return out;
}
