import { AGENTS, AGENT_DEFAULTS, type AgentKey } from "./core";

/**
 * Wave 27 — the AI team's "brain": pure, deterministic and unit-tested.
 * It reads what already exists (on/off, settings, last run, recent work) and answers
 *  - how healthy is each agent, and how complete is the team,
 *  - what is the next best thing to switch on or tune (each one applicable in a click).
 * No AI call, no database — so it is instant, free and can never contradict the run log.
 */
export interface AgentSnapshot {
  key: AgentKey;
  enabled: boolean;
  config: Record<string, number | boolean | string>;
  lastRunAt: string | null;
  runs: { actions: number; created_at: string }[];
}

export type HealthLevel = "off" | "great" | "ok" | "attention";
export type HealthReason = "off" | "neverRan" | "stale" | "idle" | "active";
export interface AgentHealth {
  key: AgentKey;
  score: number;
  level: HealthLevel;
  reason: HealthReason;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function agentHealth(a: AgentSnapshot, now = new Date()): AgentHealth {
  if (!a.enabled) return { key: a.key, score: 0, level: "off", reason: "off" };
  if (!a.lastRunAt && !a.runs.length) return { key: a.key, score: 40, level: "attention", reason: "neverRan" };
  const last = a.lastRunAt ? new Date(a.lastRunAt).getTime() : new Date(a.runs[0]!.created_at).getTime();
  const interval = AGENT_DEFAULTS[a.key].minutes * 60_000;
  // a healthy agent has run within ~2.5 of its own intervals (+ a day of slack for weekly ones)
  const overdue = Number.isFinite(last) && now.getTime() - last > interval * 2.5 + 86_400_000;
  if (overdue) return { key: a.key, score: 35, level: "attention", reason: "stale" };
  const recent = a.runs.slice(0, 3);
  const idle = recent.length >= 3 && recent.every((r) => r.actions === 0);
  if (idle) return { key: a.key, score: 60, level: "ok", reason: "idle" };
  const worked = recent.reduce((s, r) => s + (r.actions > 0 ? 1 : 0), 0);
  return { key: a.key, score: clamp(80 + worked * 7), level: "great", reason: "active" };
}

/** 0-100: half is coverage (how many of the four are on), half is how healthy the ones that are on are. */
export function teamScore(list: AgentSnapshot[], now = new Date()): number {
  const on = list.filter((a) => a.enabled);
  if (!on.length) return 0;
  const coverage = (on.length / AGENTS.length) * 50;
  const health = on.reduce((s, a) => s + agentHealth(a, now).score, 0) / on.length;
  return Math.round(clamp(coverage + health * 0.5));
}

export type Severity = "high" | "medium" | "low";
export interface Recommendation {
  id: string;
  severity: Severity;
  agent: AgentKey;
  /** i18n key under agents.brain.rec.* */
  textKey: string;
  /** when present the card shows an Apply button that saves exactly this */
  apply?: { enabled?: boolean; config?: Record<string, number | boolean | string> };
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function recommendations(list: AgentSnapshot[], now = new Date(), max = 5): Recommendation[] {
  const by = (k: AgentKey) => list.find((a) => a.key === k);
  const out: Recommendation[] = [];
  const push = (r: Recommendation) => out.push(r);
  const enabledCount = list.filter((a) => a.enabled).length;

  if (enabledCount === 0) {
    push({ id: "start-analyst", severity: "high", agent: "analyst", textKey: "agents.brain.rec.startAnalyst", apply: { enabled: true } });
  }
  const col = by("collections");
  if (col && !col.enabled) push({ id: "enable-collections", severity: "high", agent: "collections", textKey: "agents.brain.rec.enableCollections", apply: { enabled: true } });
  const sm = by("sales_manager");
  if (sm && !sm.enabled) push({ id: "enable-sales", severity: "medium", agent: "sales_manager", textKey: "agents.brain.rec.enableSales", apply: { enabled: true } });
  const an = by("analyst");
  if (an && !an.enabled && enabledCount > 0) push({ id: "enable-analyst", severity: "medium", agent: "analyst", textKey: "agents.brain.rec.enableAnalyst", apply: { enabled: true } });
  const mk = by("marketing");
  if (mk && !mk.enabled) push({ id: "enable-marketing", severity: "low", agent: "marketing", textKey: "agents.brain.rec.enableMarketing", apply: { enabled: true } });

  for (const a of list) {
    if (!a.enabled) continue;
    const h = agentHealth(a, now);
    if (h.reason === "neverRan") push({ id: `never-${a.key}`, severity: "medium", agent: a.key, textKey: "agents.brain.rec.neverRan" });
    if (h.reason === "stale") push({ id: `stale-${a.key}`, severity: "high", agent: a.key, textKey: "agents.brain.rec.stale" });
    if (h.reason === "idle") push({ id: `idle-${a.key}`, severity: "low", agent: a.key, textKey: "agents.brain.rec.idle" });
  }

  if (sm?.enabled && Number(sm.config.quiet_days) > 14) {
    push({ id: "tune-quiet", severity: "medium", agent: "sales_manager", textKey: "agents.brain.rec.tuneQuiet", apply: { config: { quiet_days: 7 } } });
  }
  if (col?.enabled && col.config.carts === false) {
    push({ id: "tune-carts", severity: "medium", agent: "collections", textKey: "agents.brain.rec.tuneCarts", apply: { config: { carts: true } } });
  }
  if (col?.enabled && Number(col.config.max_reminders) < 2) {
    push({ id: "tune-reminders", severity: "low", agent: "collections", textKey: "agents.brain.rec.tuneReminders", apply: { config: { max_reminders: 3 } } });
  }
  if (mk?.enabled && Number(mk.config.posts) < 2) {
    push({ id: "tune-posts", severity: "low", agent: "marketing", textKey: "agents.brain.rec.tunePosts", apply: { config: { posts: 3 } } });
  }
  if (mk?.enabled && mk.config.auto_publish === true && mk.runs.length === 0) {
    push({ id: "review-first", severity: "medium", agent: "marketing", textKey: "agents.brain.rec.reviewFirst", apply: { config: { auto_publish: false } } });
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, Math.max(1, max));
}
