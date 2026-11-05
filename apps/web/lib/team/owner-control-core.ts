/**
 * Wave 70 — control for the business owner (pure, unit-tested).
 *
 *   autonomyView   : per employee, in plain words, what they do alone / ask about first / cannot do. It asks the REAL
 *                    policy (`decide`) for every tool, so the card can never say something the engine does not do.
 *   tightenPlan    : which employees to move back to "ask me first" (only ever towards MORE caution).
 *   ownerLog       : the activity log turned into short lines for the owner: what was done, what waited for the owner,
 *                    what was stopped and why, what the owner changed. Technical phases are left out.
 * Nothing here writes anything.
 */
import { decide, type PolicyMember } from "./policy-core";
import { TOOL_MAP } from "./tools-core";

export type AutonomyLevel = "careful" | "balanced" | "independent";

export interface ControlMember {
  id: string;
  name: string;
  tools: string[];
  autonomy: "suggest" | "approve" | "auto";
  auto_actions: string[];
  status: "active" | "paused";
}

export interface AutonomyRow {
  id: string;
  name: string;
  level: AutonomyLevel;
  paused: boolean;
  /** works on "auto" (the owner can move this employee back to "ask first") */
  auto: boolean;
  /** write actions that run without asking, by what they touch */
  alone: { internal: number; customer: number; money: number; irreversible: number };
  /** write actions that wait for the owner */
  asks: number;
  /** actions the employee can only read / look at */
  looks: number;
}

export interface AutonomyView {
  rows: AutonomyRow[];
  /** employees that may do something customers see, money or irreversible WITHOUT asking */
  riskyCount: number;
  /** employees that tighten would change */
  loosenCount: number;
}

const OPEN: { enabled: boolean; emergency_stop: boolean } = { enabled: true, emergency_stop: false };

function levelOf(m: ControlMember, risky: boolean): AutonomyLevel {
  if (m.autonomy === "suggest") return "careful";
  if (m.autonomy === "auto" && risky) return "independent";
  return "balanced";
}

export function autonomyView(members: ControlMember[]): AutonomyView {
  const rows: AutonomyRow[] = [];
  let riskyCount = 0;
  let loosenCount = 0;
  for (const m of members) {
    const pm: PolicyMember = { tools: m.tools, autonomy: m.autonomy, auto_actions: m.auto_actions, status: "active" };
    const alone = { internal: 0, customer: 0, money: 0, irreversible: 0 };
    let asks = 0;
    let looks = 0;
    for (const tool of m.tools) {
      const spec = TOOL_MAP[tool];
      if (!spec) continue;
      if (spec.kind === "read") {
        looks++;
        continue;
      }
      const d = decide(tool, pm, OPEN, { interactive: true });
      if (d.do === "execute") alone[spec.sensitivity]++;
      else if (d.do === "approve") asks++;
    }
    const risky = alone.customer + alone.money + alone.irreversible > 0;
    if (risky && m.status === "active") riskyCount++;
    if (m.autonomy === "auto") loosenCount++;
    rows.push({ id: m.id, name: m.name, level: levelOf(m, risky), paused: m.status !== "active", auto: m.autonomy === "auto", alone, asks, looks });
  }
  return { rows, riskyCount, loosenCount };
}

/** employees to move back to "ask first": only those on "auto" (never touches "suggest" / "approve"); one id = just that one */
export function tightenPlan(members: { id: string; autonomy: string }[], onlyId?: string | null): string[] {
  return members.filter((m) => m.autonomy === "auto" && (!onlyId || m.id === onlyId)).map((m) => m.id);
}

/* ------------------------------------------------------------------ owner log */

export interface LogRow {
  id: number;
  member_id: string | null;
  phase: string;
  summary: string;
  ok: boolean;
  created_at: string;
  why?: string | null;
  autonomy?: string | null;
  member?: string | null;
}

export type OwnerLogKind = "did" | "waited" | "decided" | "blocked" | "problem" | "initiative" | "changed";
export type OwnerChange = "autonomy" | "settings" | "stop" | "release" | "tightened";

export interface OwnerLogEntry {
  id: number;
  at: string;
  day: string;
  memberId: string | null;
  kind: OwnerLogKind;
  /** the line to show (kinds did / waited / initiative / problem) */
  text: string;
  /** a reason code the screen turns into words (kind blocked) */
  why: string | null;
  change: OwnerChange | null;
  /** the employee the owner changed (kind changed / autonomy) */
  changedMemberId: string | null;
}

export const BLOCK_REASONS = ["emergency_stop", "team_off", "member_paused", "tool_not_allowed", "needs_screen", "unknown_tool"] as const;
export const blockReason = (why: string | null | undefined): string => (why && (BLOCK_REASONS as readonly string[]).includes(why) ? why : "other");

const SHOWN = new Set(["execute", "deliver", "approval", "initiative", "system"]);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function changeOf(r: LogRow): OwnerChange | null {
  const s = r.summary.toLowerCase();
  if (s.startsWith("emergency stop released")) return "release";
  if (s.startsWith("emergency stop")) return "stop";
  if (s.startsWith("owner moved") && s.includes("ask me first")) return "tightened";
  if (r.autonomy && r.member) return "autonomy";
  if (s.startsWith("team settings saved") || s.startsWith("team operations settings saved")) return "settings";
  return null;
}

/** one activity row → one owner-language entry, or null when the row is technical detail the owner does not need */
export function toOwnerEntry(r: LogRow): OwnerLogEntry | null {
  if (!SHOWN.has(r.phase)) return null;
  const base = { id: r.id, at: r.created_at, day: r.created_at.slice(0, 10), memberId: r.member_id, why: null as string | null, change: null as OwnerChange | null, changedMemberId: null as string | null };
  if (r.phase === "system") {
    const c = changeOf(r);
    if (c) return { ...base, kind: "changed", text: "", change: c, changedMemberId: c === "autonomy" ? (r.member ?? null) : null };
    return r.ok ? null : { ...base, kind: "problem", text: clip(r.summary, 160) };
  }
  if (r.phase === "execute" && !r.ok) {
    return r.why ? { ...base, kind: "blocked", text: "", why: blockReason(r.why) } : { ...base, kind: "problem", text: clip(r.summary, 160) };
  }
  if (!r.ok) return { ...base, kind: "problem", text: clip(r.summary, 160) };
  if (r.phase === "approval") {
    // the owner's own decisions ("Approved…", "Rejected by the owner…") are history; everything else is something waiting
    if (/^(approved|rejected)/i.test(r.summary.trim())) return { ...base, kind: "decided", text: clip(r.summary, 160) };
    const why = r.summary.includes("—") ? r.summary.slice(r.summary.indexOf("—") + 1).trim() : "";
    return { ...base, kind: "waited", text: clip(why, 160) };
  }
  if (r.phase === "initiative") return { ...base, kind: "initiative", text: clip(r.summary, 160) };
  return { ...base, kind: "did", text: clip(r.summary, 160) };
}

export function ownerLog(rows: LogRow[], limit = 100): OwnerLogEntry[] {
  const out: OwnerLogEntry[] = [];
  for (const r of rows) {
    const e = toOwnerEntry(r);
    if (e) out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

export type LogFilter = "all" | "waited" | "problems";

export function filterLog(entries: OwnerLogEntry[], f: LogFilter): OwnerLogEntry[] {
  if (f === "waited") return entries.filter((e) => e.kind === "waited");
  if (f === "problems") return entries.filter((e) => e.kind === "blocked" || e.kind === "problem");
  return entries;
}

export interface MemberTally {
  memberId: string;
  did: number;
  waited: number;
  stopped: number;
}

/** counts per employee over the given entries (entries without an employee are not counted) */
export function tallyByMember(entries: OwnerLogEntry[]): MemberTally[] {
  const by = new Map<string, MemberTally>();
  for (const e of entries) {
    if (!e.memberId) continue;
    const t = by.get(e.memberId) ?? { memberId: e.memberId, did: 0, waited: 0, stopped: 0 };
    if (e.kind === "did" || e.kind === "initiative" || e.kind === "decided") t.did++;
    else if (e.kind === "waited") t.waited++;
    else if (e.kind === "blocked" || e.kind === "problem") t.stopped++;
    by.set(e.memberId, t);
  }
  return [...by.values()].sort((a, b) => b.did + b.waited + b.stopped - (a.did + a.waited + a.stopped));
}

/** group by calendar day (UTC date of the row), newest day first, entries keep their order */
export function groupByDay(entries: OwnerLogEntry[]): { day: string; entries: OwnerLogEntry[] }[] {
  const out: { day: string; entries: OwnerLogEntry[] }[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.day === e.day) last.entries.push(e);
    else out.push({ day: e.day, entries: [e] });
  }
  return out;
}
