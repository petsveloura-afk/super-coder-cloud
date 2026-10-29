/**
 * Wave 53 — "smart pulse" for every screen, pure logic (unit-tested, no I/O).
 * Each function turns numbers the page already can load into a few stat tiles and 1-3 actionable tips,
 * like the "insights" side panels of the big CRMs. Nothing is invented: only counts / sums from the database.
 */

export type Tone = "accent" | "success" | "warning" | "danger" | "teal" | "muted";

export interface PulseStat {
  key: string;
  value: number;
  /** money tiles are formatted by the component */
  money?: boolean;
  tone: Tone;
  href?: string;
}

export interface PulseTip {
  key: string;
  tone: Tone;
  vars?: Record<string, string | number>;
  href?: string;
}

export interface Pulse {
  stats: PulseStat[];
  tips: PulseTip[];
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
const tipsMax = (t: PulseTip[], max = 3) => t.slice(0, max);

/* ------------------------------------------------------------------ contacts */
export function contactsPulse(c: { total: number; newWeek: number; customers: number; hot: number; noChannel: number }): Pulse {
  const stats: PulseStat[] = [
    { key: "total", value: n(c.total), tone: "accent" },
    { key: "newWeek", value: n(c.newWeek), tone: "teal" },
    { key: "hot", value: n(c.hot), tone: n(c.hot) ? "danger" : "muted", href: "/crm?hot=1" },
    { key: "customers", value: n(c.customers), tone: "success", href: "/crm?status=customer" },
  ];
  const tips: PulseTip[] = [];
  if (n(c.hot) > 0) tips.push({ key: "callHot", tone: "danger", vars: { n: n(c.hot) }, href: "/crm?hot=1" });
  if (n(c.noChannel) > 0) tips.push({ key: "enrich", tone: "warning", vars: { n: n(c.noChannel) } });
  if (n(c.total) > 0 && n(c.newWeek) === 0) tips.push({ key: "noNew", tone: "warning", href: "/forms" });
  if (n(c.customers) >= 5) tips.push({ key: "winBack", tone: "accent", vars: { n: n(c.customers) }, href: "/campaigns/new" });
  if (n(c.total) === 0) tips.push({ key: "first", tone: "accent", href: "/crm?new=1" });
  return { stats, tips: tipsMax(tips) };
}

/* ------------------------------------------------------------------ campaigns */
export function campaignsPulse(s: { total: number; drafts: number; active: number; sent: number; failed: number; deliveryRate: number }): Pulse {
  const tips: PulseTip[] = [];
  if (n(s.total) === 0) tips.push({ key: "first", tone: "accent", href: "/campaigns/new" });
  if (n(s.drafts) > 0) tips.push({ key: "drafts", tone: "warning", vars: { n: n(s.drafts) }, href: "/campaigns?status=draft" });
  if (n(s.sent) + n(s.failed) >= 20 && s.deliveryRate < 0.9) tips.push({ key: "delivery", tone: "danger", vars: { pct: Math.round(s.deliveryRate * 100) } });
  if (n(s.total) > 0 && n(s.active) === 0 && n(s.drafts) === 0) tips.push({ key: "keepRhythm", tone: "accent", href: "/campaigns/new" });
  return { stats: [], tips: tipsMax(tips) };
}

/* ------------------------------------------------------------------ websites */
export function sitesPulse(sites: { status: string; visits: number }[]): Pulse {
  const published = sites.filter((s) => s.status === "published");
  const drafts = sites.filter((s) => s.status !== "published");
  const visits = sites.reduce((a, s) => a + n(s.visits), 0);
  const zero = published.filter((s) => n(s.visits) === 0).length;
  const stats: PulseStat[] = [
    { key: "published", value: published.length, tone: "success" },
    { key: "drafts", value: drafts.length, tone: drafts.length ? "warning" : "muted" },
    { key: "visits", value: visits, tone: "accent" },
  ];
  const tips: PulseTip[] = [];
  if (!sites.length) tips.push({ key: "first", tone: "accent", href: "/websites/new" });
  if (drafts.length) tips.push({ key: "publish", tone: "warning", vars: { n: drafts.length } });
  if (zero) tips.push({ key: "share", tone: "accent", vars: { n: zero } });
  if (published.length && visits > 0) tips.push({ key: "convert", tone: "teal", href: "/forms" });
  return { stats, tips: tipsMax(tips) };
}

/* ------------------------------------------------------------------ forms */
export function formsPulse(forms: { status: string; submission_count: number; name: string }[], lastWeek: number): Pulse {
  const active = forms.filter((f) => f.status === "active");
  const total = forms.reduce((a, f) => a + n(f.submission_count), 0);
  const idle = active.filter((f) => n(f.submission_count) === 0).length;
  const best = [...forms].sort((a, b) => n(b.submission_count) - n(a.submission_count))[0];
  const stats: PulseStat[] = [
    { key: "active", value: active.length, tone: "success" },
    { key: "total", value: total, tone: "accent" },
    { key: "week", value: n(lastWeek), tone: n(lastWeek) ? "teal" : "muted" },
  ];
  const tips: PulseTip[] = [];
  if (!forms.length) tips.push({ key: "first", tone: "accent", href: "/forms/new" });
  if (idle) tips.push({ key: "idle", tone: "warning", vars: { n: idle } });
  if (best && n(best.submission_count) > 0) tips.push({ key: "best", tone: "success", vars: { name: best.name.slice(0, 60), n: n(best.submission_count) } });
  if (total > 0) tips.push({ key: "automate", tone: "accent", href: "/automations/new?recipe=formLead" });
  return { stats, tips: tipsMax(tips) };
}

/* ------------------------------------------------------------------ appointments */
export function appointmentsPulse(a: { today: number; week: number; upcoming: number; noShows30: number; held30: number; types: number }): Pulse {
  const base = n(a.noShows30) + n(a.held30);
  const noShowPct = base ? Math.round((n(a.noShows30) / base) * 100) : 0;
  const stats: PulseStat[] = [
    { key: "today", value: n(a.today), tone: n(a.today) ? "accent" : "muted" },
    { key: "week", value: n(a.week), tone: "teal" },
    { key: "upcoming", value: n(a.upcoming), tone: "success" },
    { key: "noShow", value: noShowPct, tone: noShowPct >= 15 ? "danger" : "muted" },
  ];
  const tips: PulseTip[] = [];
  if (n(a.types) === 0) tips.push({ key: "bookingPage", tone: "accent", href: "/appointments?tab=pages" });
  if (noShowPct >= 15 && base >= 5) tips.push({ key: "noShow", tone: "danger", vars: { pct: noShowPct } });
  if (n(a.today) > 0) tips.push({ key: "today", tone: "accent", vars: { n: n(a.today) } });
  if (n(a.upcoming) === 0 && n(a.types) > 0) tips.push({ key: "promote", tone: "warning", href: "/campaigns/new" });
  return { stats, tips: tipsMax(tips) };
}

/* ------------------------------------------------------------------ analytics */
/** Revenue pace for the selected period → a 30-day run-rate and the change vs the previous period. */
export function analyticsPulse(p: { wonValue: number; prevWonValue: number; days: number; openValue: number; weightedValue: number }): Pulse {
  const days = Math.max(1, n(p.days));
  const runRate = Math.round((n(p.wonValue) / days) * 30);
  const changePct = n(p.prevWonValue) > 0 ? Math.round(((n(p.wonValue) - n(p.prevWonValue)) / n(p.prevWonValue)) * 100) : null;
  const coverage = runRate > 0 ? Math.round((n(p.weightedValue) / runRate) * 10) / 10 : null;
  const stats: PulseStat[] = [
    { key: "runRate", value: runRate, money: true, tone: "success" },
    { key: "weighted", value: n(p.weightedValue), money: true, tone: "accent" },
  ];
  const tips: PulseTip[] = [];
  if (changePct !== null) tips.push({ key: changePct >= 0 ? "up" : "down", tone: changePct >= 0 ? "success" : "danger", vars: { pct: Math.abs(changePct) } });
  if (coverage !== null) tips.push({ key: coverage >= 1 ? "coverageOk" : "coverageLow", tone: coverage >= 1 ? "teal" : "warning", vars: { x: coverage }, href: "/pipelines?view=insights" });
  if (n(p.wonValue) === 0 && n(p.openValue) > 0) tips.push({ key: "closeFirst", tone: "warning", href: "/pipelines" });
  return { stats, tips: tipsMax(tips) };
}

/* ------------------------------------------------------------------ support */
export function supportPulse(tickets: { status: string; priority: string; sla_due_at: string | null; first_response_at: string | null }[], now: Date): Pulse {
  const open = tickets.filter((t) => t.status === "open" || t.status === "pending");
  const breached = open.filter((t) => t.sla_due_at && new Date(t.sla_due_at).getTime() < now.getTime()).length;
  const urgent = open.filter((t) => t.priority === "urgent" || t.priority === "high").length;
  const unanswered = open.filter((t) => !t.first_response_at).length;
  const stats: PulseStat[] = [
    { key: "open", value: open.length, tone: "accent" },
    { key: "breached", value: breached, tone: breached ? "danger" : "muted" },
    { key: "urgent", value: urgent, tone: urgent ? "warning" : "muted" },
    { key: "unanswered", value: unanswered, tone: unanswered ? "warning" : "muted" },
  ];
  const tips: PulseTip[] = [];
  if (breached) tips.push({ key: "breached", tone: "danger", vars: { n: breached } });
  if (unanswered) tips.push({ key: "unanswered", tone: "warning", vars: { n: unanswered } });
  if (!open.length) tips.push({ key: "clear", tone: "success" });
  else tips.push({ key: "kb", tone: "accent", href: "/support/kb" });
  return { stats, tips: tipsMax(tips) };
}

/* ------------------------------------------------------------------ finance */
export function financePulse(
  docs: { kind: string; status: string; due_date: string | null; total: number; amount_paid: number }[],
  today: string,
): Pulse {
  const inWeek = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();
  const openInv = docs.filter((d) => d.kind === "invoice" && (d.status === "sent" || d.status === "accepted"));
  const balance = (d: { total: number; amount_paid: number }) => Math.max(0, n(d.total) - n(d.amount_paid));
  const outstanding = openInv.reduce((a, d) => a + balance(d), 0);
  const overdueDocs = openInv.filter((d) => d.due_date && d.due_date < today && balance(d) > 0);
  const overdue = overdueDocs.reduce((a, d) => a + balance(d), 0);
  const dueSoon = openInv.filter((d) => d.due_date && d.due_date >= today && d.due_date <= inWeek).reduce((a, d) => a + balance(d), 0);
  const quotes = docs.filter((d) => d.kind === "quote" && d.status === "sent");
  const stats: PulseStat[] = [
    { key: "outstanding", value: Math.round(outstanding), money: true, tone: "accent" },
    { key: "overdue", value: Math.round(overdue), money: true, tone: overdue ? "danger" : "muted" },
    { key: "dueSoon", value: Math.round(dueSoon), money: true, tone: dueSoon ? "warning" : "muted" },
    { key: "quotes", value: quotes.length, tone: quotes.length ? "teal" : "muted" },
  ];
  const tips: PulseTip[] = [];
  if (overdueDocs.length) tips.push({ key: "collect", tone: "danger", vars: { n: overdueDocs.length } });
  if (quotes.length) tips.push({ key: "followQuotes", tone: "teal", vars: { n: quotes.length } });
  if (overdueDocs.length) tips.push({ key: "collectionsAgent", tone: "accent", href: "/agents" });
  if (!docs.length) tips.push({ key: "first", tone: "accent" });
  return { stats, tips: tipsMax(tips) };
}
