/**
 * Upgrade 8 / stage B4 — service agreements BETWEEN departments (pure, unit-tested).
 *
 * An agreement: "when department X hands work to department Y, Y picks it up within N minutes". It is measured automatically from
 * data that already exists — the handoff messages the employees send (who → whom, when) and the tasks they created (created /
 * started / finished). Nothing is asked of the model. A handoff that is still waiting past its limit counts as a breach NOW, it does
 * not wait to be picked up late. A breach shows up as ONE line in the morning brief (and the weekly report) and as one owner alert a day.
 */
import { DEPT_KEYS, deptName, isDeptKey, type DeptKey, type Lang, type Placement } from "./departments-core";

export interface SlaDef {
  id: string;
  from: DeptKey;
  to: DeptKey;
  /** the pickup limit in minutes */
  minutes: number;
  enabled: boolean;
}

/** the starting agreements (the owner changes the minutes or switches one off; a default is never deleted) */
export const DEFAULT_SLAS: SlaDef[] = [
  { id: "marketing_sales", from: "marketing", to: "sales", minutes: 60, enabled: true },
  { id: "marketing_service", from: "marketing", to: "service", minutes: 120, enabled: true },
  { id: "sales_finance", from: "sales", to: "finance", minutes: 240, enabled: true },
  { id: "sales_service", from: "sales", to: "service", minutes: 240, enabled: true },
  { id: "service_operations", from: "service", to: "operations", minutes: 240, enabled: true },
  { id: "service_sales", from: "service", to: "sales", minutes: 120, enabled: true },
];
export const SLA_IDS = DEFAULT_SLAS.map((s) => s.id);

/** a stored owner row */
export interface SlaOverride {
  sla_id: string;
  minutes?: number | null;
  enabled?: boolean | null;
}

export const MIN_SLA_MINUTES = 5;
export const MAX_SLA_MINUTES = 7 * 24 * 60;

/** minutes the owner typed: an integer 5 .. 10,080 (one week) */
export function cleanMinutes(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const m = Math.round(n);
  return m < MIN_SLA_MINUTES || m > MAX_SLA_MINUTES ? null : m;
}

export function cleanSlaOverride(raw: Record<string, unknown>): { ok: true; row: SlaOverride } | { ok: false; error: string } {
  const id = String(raw.sla_id ?? "");
  if (!SLA_IDS.includes(id)) return { ok: false, error: "unknown_sla" };
  const row: SlaOverride = { sla_id: id };
  if (raw.minutes !== undefined && raw.minutes !== null && raw.minutes !== "") {
    const m = cleanMinutes(raw.minutes);
    if (m === null) return { ok: false, error: "bad:minutes" };
    row.minutes = m;
  }
  if (raw.enabled !== undefined && raw.enabled !== null) row.enabled = raw.enabled === true || raw.enabled === "true";
  return { ok: true, row };
}

export function resolveSlas(overrides: SlaOverride[] = []): SlaDef[] {
  return DEFAULT_SLAS.map((d) => {
    const o = overrides.find((x) => x.sla_id === d.id);
    if (!o) return d;
    return { ...d, minutes: o.minutes ? (cleanMinutes(o.minutes) ?? d.minutes) : d.minutes, enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled };
  });
}

export const slaName = (d: Pick<SlaDef, "from" | "to">, l: Lang): string => `${deptName(d.from, l)} → ${deptName(d.to, l)}`;

/* ------------------------------------------------------------------ measuring */

/** one handoff between employees, from the handoff messages joined to the task they created */
export interface HandoffLite {
  task_id: string;
  from_member: string;
  to_member: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  status: string;
}

const CLOSED = new Set(["canceled", "failed"]);

export interface HandoffTiming {
  task_id: string;
  from: DeptKey;
  to: DeptKey;
  /** minutes from the handoff until the receiver started (or until now, while it still waits) */
  waitedMin: number;
  /** picked up already? */
  picked: boolean;
  breached: boolean;
  /** still waiting and past the limit right now */
  openBreach: boolean;
}

export interface SlaResult {
  def: SlaDef;
  total: number;
  met: number;
  breached: number;
  openBreached: number;
  /** 0..1 of the measured handoffs that met the limit; null with none */
  rate: number | null;
  avgPickupMin: number | null;
  worstMin: number | null;
  worst: HandoffTiming | null;
}

const deptOf = (placements: Placement[], member: string): DeptKey | null => {
  const d = placements.find((p) => p.member_id === member)?.dept_key;
  return d && isDeptKey(d) ? d : null;
};

/** the timing of each handoff that crosses departments (same-department handoffs are not an agreement). Canceled / failed ones are skipped. */
export function timeHandoffs(handoffs: HandoffLite[], placements: Placement[], defs: SlaDef[], now: number): HandoffTiming[] {
  const out: HandoffTiming[] = [];
  for (const h of handoffs) {
    if (CLOSED.has(h.status)) continue;
    const from = deptOf(placements, h.from_member);
    const to = deptOf(placements, h.to_member);
    if (!from || !to || from === to) continue;
    const def = defs.find((d) => d.from === from && d.to === to);
    if (!def) continue;
    const t0 = Date.parse(h.created_at);
    if (!Number.isFinite(t0)) continue;
    const started = h.started_at ? Date.parse(h.started_at) : NaN;
    const picked = Number.isFinite(started);
    const waitedMin = Math.max(0, Math.round(((picked ? started : now) - t0) / 60_000));
    const breached = waitedMin > def.minutes;
    out.push({ task_id: h.task_id, from, to, waitedMin, picked, breached, openBreach: breached && !picked });
  }
  return out;
}

/** per agreement: how many handoffs, how many met it, the average and the worst pickup. Only enabled agreements; window = last `days`. */
export function measureSlas(handoffs: HandoffLite[], placements: Placement[], defs: SlaDef[], now: number, days = 30): SlaResult[] {
  const since = now - days * 86_400_000;
  const recent = handoffs.filter((h) => Date.parse(h.created_at) >= since);
  const enabled = defs.filter((d) => d.enabled);
  const timings = timeHandoffs(recent, placements, enabled, now);
  return enabled.map((def) => {
    const mine = timings.filter((t) => t.from === def.from && t.to === def.to);
    const breached = mine.filter((t) => t.breached);
    const picked = mine.filter((t) => t.picked);
    const worst = [...mine].sort((a, b) => b.waitedMin - a.waitedMin)[0] ?? null;
    return {
      def,
      total: mine.length,
      met: mine.length - breached.length,
      breached: breached.length,
      openBreached: mine.filter((t) => t.openBreach).length,
      rate: mine.length ? (mine.length - breached.length) / mine.length : null,
      avgPickupMin: picked.length ? Math.round(picked.reduce((s, t) => s + t.waitedMin, 0) / picked.length) : null,
      worstMin: worst ? worst.waitedMin : null,
      worst,
    };
  });
}

/* ------------------------------------------------------------------ alerts and lines */

export type SlaLevel = "ok" | "watch" | "breach";

/** breach = a handoff is waiting past its limit right now, or most recent handoffs broke it; watch = some broke it; ok otherwise */
export function slaLevel(r: SlaResult): SlaLevel {
  if (r.openBreached > 0) return "breach";
  if (r.total >= 3 && r.rate !== null && r.rate < 0.5) return "breach";
  if (r.breached > 0) return "watch";
  return "ok";
}

export function slaLine(r: SlaResult, l: Lang): string {
  const n = slaName(r.def, l);
  const m = r.def.minutes;
  if (!r.total) {
    return { he: `${n}: אין העברות בתקופה (יעד ${m} דק')`, en: `${n}: no handoffs in the period (target ${m} min)`, ar: `${n}: لا توجد عمليات تسليم في الفترة (الهدف ${m} د)` }[l];
  }
  const pct = Math.round((r.rate ?? 0) * 100);
  return {
    he: `${n}: ${r.met} מתוך ${r.total} בתוך ${m} דק' (${pct}%)${r.avgPickupMin !== null ? `, ממוצע ${r.avgPickupMin} דק'` : ""}${r.openBreached ? `, ${r.openBreached} ממתינות עכשיו מעבר ליעד` : ""}`,
    en: `${n}: ${r.met} of ${r.total} within ${m} min (${pct}%)${r.avgPickupMin !== null ? `, average ${r.avgPickupMin} min` : ""}${r.openBreached ? `, ${r.openBreached} waiting past the target now` : ""}`,
    ar: `${n}: ${r.met} من ${r.total} خلال ${m} د (${pct}٪)${r.avgPickupMin !== null ? `، المتوسط ${r.avgPickupMin} د` : ""}${r.openBreached ? `، ${r.openBreached} تنتظر الآن بعد الهدف` : ""}`,
  }[l];
}

/**
 * The ONE line for the morning brief / weekly report: null when every agreement is fine (nothing is added then). With breaches it names
 * the worst agreement and how many more there are.
 */
export function slaBriefLine(results: SlaResult[], l: Lang): string | null {
  const bad = results.filter((r) => slaLevel(r) !== "ok").sort((a, b) => (slaLevel(b) === "breach" ? 1 : 0) - (slaLevel(a) === "breach" ? 1 : 0) || b.breached - a.breached);
  if (!bad.length) return null;
  const w = bad[0]!;
  const more = bad.length - 1;
  const base = {
    he: `חריגת SLA בין מחלקות — ${slaName(w.def, l)}: ${w.breached} העברות חרגו מ-${w.def.minutes} דק'${w.openBreached ? ` (${w.openBreached} ממתינות עכשיו)` : ""}${more ? ` ועוד ${more} הסכמים` : ""}`,
    en: `Department SLA breach — ${slaName(w.def, l)}: ${w.breached} handoffs went past ${w.def.minutes} min${w.openBreached ? ` (${w.openBreached} waiting now)` : ""}${more ? `, plus ${more} more agreement(s)` : ""}`,
    ar: `خرق اتفاقية بين الأقسام — ${slaName(w.def, l)}: ${w.breached} عمليات تسليم تجاوزت ${w.def.minutes} د${w.openBreached ? ` (${w.openBreached} تنتظر الآن)` : ""}${more ? ` و${more} اتفاقيات أخرى` : ""}`,
  };
  return base[l];
}

/** an owner alert is sent at most once a day per agreement: the key to dedupe on (agreement + day), only for level "breach" */
export function alertKey(r: SlaResult, now: number): string | null {
  return slaLevel(r) === "breach" ? `${r.def.id}:${new Date(now).toISOString().slice(0, 10)}` : null;
}

export { DEPT_KEYS };
