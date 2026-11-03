/**
 * Upgrade 7 / stage C — goals and honest forecasts (pure; no I/O, no model).
 *
 * A goal = a measurable metric + a baseline + a target + a due date + an owner. Progress is computed from CRM numbers by
 * the server (never typed by a model). The forecast is a RANGE with a probability, and "not enough data" is a legitimate
 * answer: with fewer than MIN_POINTS days of history nothing is projected. A goal that slips into "at risk" raises ONE alert
 * (only when the status changes, never repeated every tick).
 */

export type Lang = "he" | "en" | "ar";

/** metrics the platform can measure by itself from the CRM. `cumulative`: the sum of daily values; `level`: a daily average-like value. */
export const GOAL_METRICS = {
  leads_new: { kind: "cumulative", direction: "up" },
  deals_won: { kind: "cumulative", direction: "up" },
  revenue_won: { kind: "cumulative", direction: "up" },
  conversations: { kind: "cumulative", direction: "up" },
  reviews_avg: { kind: "level", direction: "up" },
  reply_minutes: { kind: "level", direction: "down" },
  custom: { kind: "cumulative", direction: "up" },
} as const;
export type GoalMetric = keyof typeof GOAL_METRICS;
export const GOAL_METRIC_KEYS = Object.keys(GOAL_METRICS) as GoalMetric[];

export type GoalStatus = "proposed" | "active" | "achieved" | "missed" | "paused";
export type Risk = "achieved" | "on_track" | "at_risk" | "off_track" | "not_enough_data" | "expired";

export interface Goal {
  id: string;
  title: string;
  metric: GoalMetric;
  baseline: number;
  target: number;
  start_date: string; // YYYY-MM-DD
  due_date: string; // YYYY-MM-DD
  owner_member_id: string | null;
  owner_user_id: string | null;
  status: GoalStatus;
  source: "owner" | "agent";
  last_risk?: Risk | null;
}

export interface DailyPoint {
  day: string; // YYYY-MM-DD
  value: number;
}

export const MIN_POINTS = 7;
const DAY = 86_400_000;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const dayMs = (s: string) => Date.parse(`${s}T00:00:00Z`);
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** raw input (a form or a tool call) → a clean goal or the reason it was rejected. The server decides `source`, never the model. */
export function normalizeGoal(raw: Record<string, unknown>, now = Date.now()): { goal: Omit<Goal, "id" | "status" | "source" | "last_risk"> } | { rejected: string } {
  const title = typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  if (title.length < 3) return { rejected: "title" };
  const metric = (GOAL_METRIC_KEYS as string[]).includes(String(raw.metric)) ? (String(raw.metric) as GoalMetric) : null;
  if (!metric) return { rejected: "metric" };
  const target = num(raw.target);
  if (target === null || Math.abs(target) > 1e9) return { rejected: "target" };
  const start = isDay(raw.start_date) ? raw.start_date : dayKey(now);
  const due = isDay(raw.due_date) ? raw.due_date : null;
  if (!due) return { rejected: "due_date" };
  if (dayMs(due) <= dayMs(start)) return { rejected: "due_before_start" };
  if (dayMs(due) - dayMs(start) > 800 * DAY) return { rejected: "too_long" };
  const baseline = num(raw.baseline) ?? 0;
  const dir = GOAL_METRICS[metric].direction;
  if (dir === "up" && target <= baseline) return { rejected: "target_not_above_baseline" };
  if (dir === "down" && target >= baseline) return { rejected: "target_not_below_baseline" };
  return {
    goal: {
      title,
      metric,
      baseline,
      target,
      start_date: start,
      due_date: due,
      owner_member_id: typeof raw.owner_member_id === "string" && raw.owner_member_id ? raw.owner_member_id : null,
      owner_user_id: typeof raw.owner_user_id === "string" && raw.owner_user_id ? raw.owner_user_id : null,
    },
  };
}

/** progress 0..1 (can exceed 1 when beaten; never below 0) */
export function progressOf(g: Pick<Goal, "baseline" | "target">, current: number): number {
  const span = g.target - g.baseline;
  if (span === 0) return current === g.target ? 1 : 0;
  return Math.max(0, (current - g.baseline) / span);
}

/** where a linear plan from baseline to target would be today (the "pace line") */
export function expectedNow(g: Pick<Goal, "baseline" | "target" | "start_date" | "due_date">, now: number): number {
  const total = dayMs(g.due_date) - dayMs(g.start_date);
  const done = Math.min(Math.max(now - dayMs(g.start_date), 0), total);
  return g.baseline + ((g.target - g.baseline) * done) / (total || 1);
}

/* ------------------------------------------------------------------------------------------------ the forecast */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
/** standard normal CDF (Abramowitz–Stegun 7.1.26) */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export interface Forecast {
  risk: Risk;
  current: number;
  /** expected value at the due date (null when there is not enough data) */
  expected: number | null;
  /** an 80% range at the due date */
  low: number | null;
  high: number | null;
  /** probability of reaching the target by the due date (0..1), null when unknown */
  probability: number | null;
  progress: number;
  /** the linear pace line today and how far behind (negative) / ahead (positive) the goal is, in metric units */
  paceGap: number;
  daysLeft: number;
  pointsUsed: number;
}

/** fill missing days with 0 for cumulative metrics (a day without events is a zero, not a gap); level metrics keep gaps out */
function densify(series: DailyPoint[], kind: "cumulative" | "level", from: string, to: string): number[] {
  const by = new Map(series.filter((p) => isDay(p.day) && Number.isFinite(p.value)).map((p) => [p.day, p.value]));
  const out: number[] = [];
  for (let t = dayMs(from); t <= dayMs(to); t += DAY) {
    const v = by.get(dayKey(t));
    if (v !== undefined) out.push(v);
    else if (kind === "cumulative") out.push(0);
  }
  return out;
}

/**
 * The honest forecast. `series` = the daily values since the start of the goal (cumulative: events per day; level: the day's
 * value). Fewer than MIN_POINTS days → "not_enough_data" (no number is invented). Uses the last 28 days.
 */
export function forecast(g: Pick<Goal, "metric" | "baseline" | "target" | "start_date" | "due_date">, series: DailyPoint[], now = Date.now()): Forecast {
  const spec = GOAL_METRICS[g.metric];
  const today = dayKey(now);
  const lastDay = dayKey(Math.min(now, dayMs(g.due_date)));
  const daysLeft = Math.max(0, Math.round((dayMs(g.due_date) - dayMs(today)) / DAY));
  const from = dayKey(Math.max(dayMs(g.start_date), dayMs(lastDay) - 27 * DAY));
  const win = densify(series, spec.kind, from, lastDay);
  const all = densify(series, spec.kind, g.start_date, lastDay);
  const up = spec.direction === "up";
  const beats = (v: number) => (up ? v >= g.target : v <= g.target);
  let current: number;
  if (spec.kind === "cumulative") current = g.baseline + all.reduce((a, b) => a + b, 0);
  else current = all.length ? mean(all.slice(-7)) : g.baseline;
  const progress = progressOf(g, current);
  const paceGap = up ? current - expectedNow(g, now) : expectedNow(g, now) - current;
  const base = { current, progress, paceGap, daysLeft, pointsUsed: win.length };
  if (beats(current) && spec.kind === "cumulative") return { risk: "achieved", expected: current, low: current, high: current, probability: 1, ...base };
  if (dayMs(today) > dayMs(g.due_date)) return { risk: beats(current) ? "achieved" : "expired", expected: current, low: current, high: current, probability: beats(current) ? 1 : 0, ...base };
  if (win.length < MIN_POINTS) return { risk: "not_enough_data", expected: null, low: null, high: null, probability: null, ...base };

  let expected: number;
  let spread: number; // standard deviation of the projected final value
  if (spec.kind === "cumulative") {
    const rate = mean(win);
    const s = sd(win);
    expected = current + rate * daysLeft;
    spread = s * Math.sqrt(daysLeft);
  } else {
    // level metric: least-squares trend over the window, extrapolated; the spread is the residual noise (plus slope uncertainty)
    const n = win.length;
    const xs = win.map((_, i) => i);
    const mx = mean(xs);
    const my = mean(win);
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (win[i]! - my), 0) / sxx;
    const resid = win.map((y, i) => y - (my + slope * (i - mx)));
    const rs = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2));
    expected = my + slope * (n - 1 - mx + daysLeft);
    spread = rs * Math.sqrt(1 + 1 / n + (n - 1 - mx + daysLeft) ** 2 / sxx);
  }
  const z80 = 1.2816;
  const low = expected - z80 * spread;
  const high = expected + z80 * spread;
  let probability: number;
  if (spread < 1e-9) probability = beats(expected) ? 1 : 0;
  else probability = up ? 1 - normalCdf((g.target - expected) / spread) : normalCdf((g.target - expected) / spread);
  probability = Math.min(1, Math.max(0, probability));
  const risk: Risk = probability >= 0.6 ? "on_track" : probability >= 0.25 ? "at_risk" : "off_track";
  return { risk, expected, low: Math.min(low, high), high: Math.max(low, high), probability, ...base };
}

/** the single alert rule: only a change INTO at_risk / off_track (or a worsening between them) raises one */
export function goalAlert(prev: Risk | null | undefined, next: Risk): "at_risk" | "off_track" | null {
  if (next !== "at_risk" && next !== "off_track") return null;
  if (prev === next) return null;
  if (prev === "off_track" && next === "at_risk") return null;
  return next;
}

/* ------------------------------------------------------------------------------------------------ wording */

const RISK_TEXT: Record<Lang, Record<Risk, string>> = {
  he: { achieved: "היעד הושג", on_track: "בדרך הנכונה", at_risk: "בסיכון", off_track: "רחוק מהיעד", not_enough_data: "אין מספיק נתונים לתחזית", expired: "התאריך עבר ולא הושג" },
  en: { achieved: "Goal reached", on_track: "On track", at_risk: "At risk", off_track: "Off track", not_enough_data: "Not enough data to forecast", expired: "Due date passed, not reached" },
  ar: { achieved: "تم تحقيق الهدف", on_track: "على المسار الصحيح", at_risk: "في خطر", off_track: "بعيد عن الهدف", not_enough_data: "لا توجد بيانات كافية للتوقع", expired: "انتهى الموعد ولم يتحقق" },
};
export const riskLabel = (r: Risk, lang: Lang) => RISK_TEXT[lang][r];

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10));

/** one honest sentence: never a promise, always the range */
export function forecastLine(f: Forecast, lang: Lang): string {
  const label = riskLabel(f.risk, lang);
  if (f.expected === null || f.low === null || f.high === null || f.probability === null) return `${label} (${f.pointsUsed}/${MIN_POINTS}).`;
  const pct = Math.round(f.probability * 100);
  const range = `${fmt(f.low)}–${fmt(f.high)}`;
  if (lang === "he") return `${label}: צפוי להגיע ל-${fmt(f.expected)} (טווח ${range}), סיכוי של כ-${pct}% לעמוד ביעד.`;
  if (lang === "ar") return `${label}: المتوقع ${fmt(f.expected)} (النطاق ${range})، احتمال تحقيق الهدف نحو ${pct}%.`;
  return `${label}: expected ${fmt(f.expected)} (range ${range}), about ${pct}% chance to reach the target.`;
}

export function alertLine(title: string, level: "at_risk" | "off_track", f: Forecast, lang: Lang): string {
  const l = RISK_TEXT[lang][level];
  return lang === "he" ? `היעד "${title}" — ${l}. ${forecastLine(f, lang)}` : lang === "ar" ? `الهدف "${title}" — ${l}. ${forecastLine(f, lang)}` : `Goal "${title}" — ${l}. ${forecastLine(f, lang)}`;
}

/** the compact card the owner sees (also used inside the manager's context) */
export function goalCard(g: Goal, f: Forecast, lang: Lang): { title: string; progressPct: number; risk: Risk; riskText: string; line: string; daysLeft: number } {
  return { title: g.title, progressPct: Math.min(100, Math.round(f.progress * 100)), risk: f.risk, riskText: riskLabel(f.risk, lang), line: forecastLine(f, lang), daysLeft: f.daysLeft };
}

/** a block for the manager's prompt: only active goals, with the honest forecast */
export function goalsPrompt(items: { goal: Goal; forecast: Forecast }[], lang: Lang = "en"): string {
  const act = items.filter((i) => i.goal.status === "active").slice(0, 6);
  if (!act.length) return "";
  return ["BUSINESS GOALS (measured from the CRM; the forecast is a range, never a promise):", ...act.map((i) => `- ${i.goal.title} [${i.goal.metric}] ${fmt(i.forecast.current)} → ${fmt(i.goal.target)} by ${i.goal.due_date}: ${forecastLine(i.forecast, lang)}`)].join("\n");
}
