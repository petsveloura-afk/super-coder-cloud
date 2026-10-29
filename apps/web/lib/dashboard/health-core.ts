/**
 * Wave 48 — overview "command center" logic (pure, unit-tested; no I/O).
 * Every figure is derived from the RLS-protected KPIs the page already loads — nothing is invented.
 */

export interface HealthKpis {
  total_contacts: number;
  new_contacts: number;
  qualified_contacts: number;
  customers: number;
  open_deals: number;
  open_pipeline_value: number;
  won_value: number;
  won_deals: number;
  lost_deals: number;
  open_tasks: number;
  overdue_tasks: number;
}

export type HealthLevel = "excellent" | "good" | "fair" | "attention" | "start";

export interface HealthPart {
  key: "growth" | "conversion" | "pipeline" | "execution";
  score: number;
  max: number;
}

/**
 * Business health 0-100 from four parts (25 each):
 *  growth     — new contacts in the KPI window relative to the base
 *  conversion — won / (won + lost)
 *  pipeline   — open deals exist and qualified contacts feed them
 *  execution  — share of open tasks that are NOT overdue
 * A brand-new workspace (no contacts) returns level "start" instead of a misleading low score.
 */
export function businessHealth(k: HealthKpis): { score: number; level: HealthLevel; parts: HealthPart[] } {
  const n = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);
  const total = n(k.total_contacts);
  const growth = total === 0 ? 0 : Math.min(25, Math.round((n(k.new_contacts) / Math.max(1, total)) * 100));
  const closed = n(k.won_deals) + n(k.lost_deals);
  const conversion = closed === 0 ? (n(k.open_deals) > 0 ? 12 : 0) : Math.round((n(k.won_deals) / closed) * 25);
  const pipeline = Math.min(25, (n(k.open_deals) > 0 ? 13 : 0) + Math.min(12, Math.round((n(k.qualified_contacts) / Math.max(1, total)) * 40)));
  const execution = n(k.open_tasks) === 0 ? (total > 0 ? 20 : 0) : Math.round((1 - Math.min(1, n(k.overdue_tasks) / n(k.open_tasks))) * 25);
  const parts: HealthPart[] = [
    { key: "growth", score: growth, max: 25 },
    { key: "conversion", score: conversion, max: 25 },
    { key: "pipeline", score: pipeline, max: 25 },
    { key: "execution", score: execution, max: 25 },
  ];
  const score = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.score, 0)));
  const level: HealthLevel = total === 0 ? "start" : score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "fair" : "attention";
  return { score, level, parts };
}

/** Last 7 days vs the 7 before (from the daily new-contacts series). */
export function weekTrend(daily: { day: string; count: number }[]): { thisWeek: number; lastWeek: number; changePct: number | null } {
  const sorted = [...daily].sort((a, b) => a.day.localeCompare(b.day));
  const last = sorted.slice(-7);
  const prev = sorted.slice(-14, -7);
  const sum = (xs: { count: number }[]) => xs.reduce((s, x) => s + (Number.isFinite(x.count) ? x.count : 0), 0);
  const thisWeek = sum(last);
  const lastWeek = sum(prev);
  const changePct = lastWeek === 0 ? (thisWeek === 0 ? 0 : null) : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  return { thisWeek, lastWeek, changePct };
}

/** Part of the day for the greeting, in the business time zone. */
export function dayPart(now: Date, timeZone: string): "morning" | "noon" | "evening" | "night" {
  let h = now.getUTCHours();
  try {
    h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(now)) % 24;
  } catch {
    /* unknown zone — UTC */
  }
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "noon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

export type InsightKind = "overdue" | "conversion" | "pipeline" | "growth" | "qualified" | "customers";

export interface Insight {
  kind: InsightKind;
  tone: "danger" | "warning" | "success" | "info";
  /** values for the i18n template */
  vars: Record<string, string | number>;
  href: string;
}

/** Up to `max` short, actionable insights from the KPIs and the weekly trend (most important first). */
export function smartInsights(k: HealthKpis, trend: { thisWeek: number; lastWeek: number; changePct: number | null }, max = 4): Insight[] {
  const out: Insight[] = [];
  if (k.overdue_tasks > 0) out.push({ kind: "overdue", tone: "danger", vars: { n: k.overdue_tasks }, href: "tasks" });
  const closed = k.won_deals + k.lost_deals;
  if (closed >= 3) {
    const rate = Math.round((k.won_deals / closed) * 100);
    out.push({ kind: "conversion", tone: rate >= 30 ? "success" : "warning", vars: { rate }, href: "pipelines" });
  }
  if (k.open_deals > 0) out.push({ kind: "pipeline", tone: "info", vars: { n: k.open_deals }, href: "pipelines" });
  if (trend.changePct !== null && (trend.thisWeek > 0 || trend.lastWeek > 0)) {
    out.push({ kind: "growth", tone: trend.changePct >= 0 ? "success" : "warning", vars: { n: trend.thisWeek, pct: Math.abs(trend.changePct) }, href: "crm" });
  }
  if (k.qualified_contacts > 0 && k.open_deals === 0) out.push({ kind: "qualified", tone: "warning", vars: { n: k.qualified_contacts }, href: "pipelines" });
  if (k.customers > 0) out.push({ kind: "customers", tone: "info", vars: { n: k.customers }, href: "campaigns" });
  return out.slice(0, Math.max(0, max));
}
