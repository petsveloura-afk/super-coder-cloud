/**
 * Upgrade 7 / stage H — reports and insights (pure). Weekly / monthly reports and the morning brief are BUILT by code from measured
 * numbers (so every figure is real, in the business language); a model may only polish the wording. Anomalies are found with
 * thresholds in code, never by a model's impression.
 */
export type Lang = "he" | "en" | "ar";
export type Period = "week" | "month";

export const METRIC_LABEL: Record<string, Record<Lang, string>> = {
  leads: { he: "לידים חדשים", en: "New leads", ar: "عملاء محتملون جدد" },
  conversations: { he: "שיחות", en: "Conversations", ar: "محادثات" },
  deals_won: { he: "עסקאות שנסגרו", en: "Deals won", ar: "صفقات مغلقة" },
  revenue: { he: "הכנסות", en: "Revenue", ar: "الإيرادات" },
  reviews_avg: { he: "דירוג ממוצע", en: "Average rating", ar: "متوسط التقييم" },
  reply_minutes: { he: "זמן מענה (דקות)", en: "Reply time (min)", ar: "زمن الرد (دقائق)" },
};
/** metrics where DOWN is good */
const LOWER_IS_BETTER = new Set(["reply_minutes"]);

export interface Change {
  metric: string;
  cur: number;
  prev: number;
  pct: number | null;
  good: boolean | null;
  notable: boolean;
}
/** compares two periods; "notable" = a change of at least 20% on a base of at least `minBase` */
export function compare(cur: Record<string, number>, prev: Record<string, number>, minBase = 5): Change[] {
  return Object.keys(cur).map((m) => {
    const c = cur[m]!;
    const p = prev[m] ?? 0;
    const pct = p > 0 ? (c - p) / p : null;
    const good = pct === null || Math.abs(pct) < 0.02 ? null : LOWER_IS_BETTER.has(m) ? pct < 0 : pct > 0;
    return { metric: m, cur: c, prev: p, pct, good, notable: pct !== null && p >= (m === "reviews_avg" || m === "reply_minutes" ? 1 : minBase) && Math.abs(pct) >= 0.2 };
  });
}

export interface Anomaly {
  metric: string;
  day: string;
  value: number;
  expected: number;
  z: number;
  direction: "up" | "down";
}
/** the last day against the days before it: needs ≥ 10 baseline days; flags |z| ≥ 2.5 AND a ≥ 30% and ≥ minAbs move */
export function detectAnomaly(metric: string, series: { day: string; value: number }[], opts: { minAbs?: number; zMin?: number } = {}): Anomaly | null {
  if (series.length < 11) return null;
  const sorted = [...series].sort((a, b) => a.day.localeCompare(b.day));
  const last = sorted[sorted.length - 1]!;
  const base = sorted.slice(-29, -1).map((p) => p.value);
  const mean = base.reduce((a, b) => a + b, 0) / base.length;
  const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / (base.length - 1));
  const floor = Math.max(sd, 0.5 * Math.sqrt(Math.max(mean, 0.25)));
  const z = (last.value - mean) / floor;
  const abs = Math.abs(last.value - mean);
  if (Math.abs(z) < (opts.zMin ?? 2.5) || abs < (opts.minAbs ?? 3) || (mean > 0 && abs / mean < 0.3)) return null;
  return { metric, day: last.day, value: last.value, expected: Math.round(mean * 10) / 10, z: Math.round(z * 10) / 10, direction: last.value > mean ? "up" : "down" };
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10));
const pctText = (p: number | null) => (p === null ? "—" : `${p >= 0 ? "+" : ""}${Math.round(p * 100)}%`);
const label = (m: string, l: Lang) => METRIC_LABEL[m]?.[l] ?? m;

const H: Record<Lang, { week: string; month: string; numbers: string; wins: string; risks: string; anomalies: string; goals: string; next: string; none: string; anomalyLine: (m: string, a: Anomaly) => string }> = {
  he: { week: "דוח שבועי", month: "דוח חודשי", numbers: "המספרים", wins: "מה עבד", risks: "מה דורש תשומת לב", anomalies: "חריגות", goals: "יעדים", next: "מה עושים עכשיו", none: "אין שינוי מהותי", anomalyLine: (m, a) => `${m}: ${fmt(a.value)} ב-${a.day} לעומת ${fmt(a.expected)} רגיל (${a.direction === "up" ? "עלייה" : "ירידה"} חריגה)` },
  en: { week: "Weekly report", month: "Monthly report", numbers: "The numbers", wins: "What worked", risks: "Needs attention", anomalies: "Anomalies", goals: "Goals", next: "What to do now", none: "No material change", anomalyLine: (m, a) => `${m}: ${fmt(a.value)} on ${a.day} vs ${fmt(a.expected)} usual (unusual ${a.direction === "up" ? "rise" : "drop"})` },
  ar: { week: "تقرير أسبوعي", month: "تقرير شهري", numbers: "الأرقام", wins: "ما نجح", risks: "يحتاج انتباها", anomalies: "حالات شاذة", goals: "الأهداف", next: "ما العمل الآن", none: "لا تغيير جوهري", anomalyLine: (m, a) => `${m}: ${fmt(a.value)} في ${a.day} مقابل ${fmt(a.expected)} المعتاد (${a.direction === "up" ? "ارتفاع" : "انخفاض"} غير عادي)` },
};

export interface ReportInput {
  period: Period;
  cur: Record<string, number>;
  prev: Record<string, number>;
  anomalies?: Anomaly[];
  goals?: { title: string; risk: string; line: string }[];
  recommendations?: { title: string; why: string }[];
  lang: Lang;
}
export interface Report {
  title: string;
  sections: { key: string; heading: string; lines: string[] }[];
  text: string;
  /** every figure that appears in the text, for the "no invented numbers" check */
  figures: number[];
}
export function buildReport(i: ReportInput): Report {
  const h = H[i.lang];
  const ch = compare(i.cur, i.prev);
  const sections: Report["sections"] = [{ key: "numbers", heading: h.numbers, lines: ch.map((c) => `${label(c.metric, i.lang)}: ${fmt(c.cur)} (${pctText(c.pct)})`) }];
  const wins = ch.filter((c) => c.notable && c.good === true).map((c) => `${label(c.metric, i.lang)} ${pctText(c.pct)}`);
  const risks = [...ch.filter((c) => c.notable && c.good === false).map((c) => `${label(c.metric, i.lang)} ${pctText(c.pct)}`), ...(i.goals ?? []).filter((g) => g.risk === "at_risk" || g.risk === "off_track").map((g) => g.line.startsWith(g.title) ? g.line : `${g.title}: ${g.line}`)];
  sections.push({ key: "wins", heading: h.wins, lines: wins.length ? wins : [h.none] }, { key: "risks", heading: h.risks, lines: risks.length ? risks : [h.none] });
  if (i.anomalies?.length) sections.push({ key: "anomalies", heading: h.anomalies, lines: i.anomalies.map((a) => h.anomalyLine(label(a.metric, i.lang), a)) });
  if (i.recommendations?.length) sections.push({ key: "next", heading: h.next, lines: i.recommendations.slice(0, 3).map((r) => `${r.title} — ${r.why}`) });
  const title = i.period === "week" ? h.week : h.month;
  const text = [title, ...sections.flatMap((s) => [`\n${s.heading}`, ...s.lines.map((l) => `• ${l}`)])].join("\n");
  const figures = [...new Set([...Object.values(i.cur), ...Object.values(i.prev)])];
  return { title, sections, text, figures };
}

/** numbers in a model-polished text that do not come from the data (a guard before a polished version replaces the built one) */
export function inventedFigures(text: string, allowed: number[], tolerance = 0.06): number[] {
  const nums = [...text.matchAll(/(?<![\d.])(\d[\d,]*(?:\.\d+)?)(?:%)?/g)].map((m) => Number(m[1]!.replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 31);
  const ok = (n: number) => allowed.some((a) => Math.abs(a - n) <= Math.max(0.5, Math.abs(a) * tolerance)) || /* a percentage of change */ n <= 1000 && n % 1 === 0 && n <= 200;
  return nums.filter((n) => !ok(n));
}

export interface BriefInput {
  goals?: { title: string; risk: string }[];
  anomalies?: Anomaly[];
  waitingApprovals?: number;
  unanswered?: number;
  stuckDeals?: number;
  meetingsToday?: number;
  lang: Lang;
}
/** top 3 things for the morning, in priority order: goals off track → anomalies → customers waiting → approvals → deals → meetings */
export function morningBrief(i: BriefInput): { items: { kind: string; text: string }[]; text: string } {
  const t = (he: string, en: string, ar: string) => (i.lang === "he" ? he : i.lang === "ar" ? ar : en);
  const all: { kind: string; text: string }[] = [];
  for (const g of i.goals ?? []) if (g.risk === "off_track" || g.risk === "at_risk") all.push({ kind: "goal", text: t(`יעד בסיכון: ${g.title}`, `Goal at risk: ${g.title}`, `هدف في خطر: ${g.title}`) });
  for (const a of i.anomalies ?? []) all.push({ kind: "anomaly", text: H[i.lang].anomalyLine(label(a.metric, i.lang), a) });
  if ((i.unanswered ?? 0) > 0) all.push({ kind: "unanswered", text: t(`${i.unanswered} לקוחות מחכים למענה`, `${i.unanswered} customers are waiting for an answer`, `${i.unanswered} عملاء بانتظار الرد`) });
  if ((i.waitingApprovals ?? 0) > 0) all.push({ kind: "approvals", text: t(`${i.waitingApprovals} אישורים ממתינים לך`, `${i.waitingApprovals} approvals are waiting for you`, `${i.waitingApprovals} موافقات بانتظارك`) });
  if ((i.stuckDeals ?? 0) > 0) all.push({ kind: "deals", text: t(`${i.stuckDeals} עסקאות תקועות`, `${i.stuckDeals} stuck deals`, `${i.stuckDeals} صفقات عالقة`) });
  if ((i.meetingsToday ?? 0) > 0) all.push({ kind: "meetings", text: t(`${i.meetingsToday} פגישות היום`, `${i.meetingsToday} meetings today`, `${i.meetingsToday} اجتماعات اليوم`) });
  const items = all.slice(0, 3);
  const title = t("תקציר בוקר", "Morning brief", "ملخص الصباح");
  return { items, text: items.length ? [title, ...items.map((x, n) => `${n + 1}. ${x.text}`)].join("\n") : `${title}\n${t("הכול רגוע — אין משהו דחוף.", "All quiet — nothing urgent.", "كل شيء هادئ — لا شيء عاجل.")}` };
}
