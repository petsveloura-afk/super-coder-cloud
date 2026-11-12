/**
 * Round 13 — tasks held by the team's daily credit cap (pure, unit-tested).
 *
 * The cap counts the credits of the last 24 hours (a rolling window, by when each task RAN). Tasks held by it already resume
 * by themselves, but the owner only saw "waiting for credits (1014/1000 today)" with no idea WHEN, and the used number could
 * be above the cap (a step that was already running finishes and is counted). Two additions:
 *   • capResumeAt — when the window frees enough credits for the first held task to resume by itself
 *   • suggestedCap — a one-click raise for the owner (cap × 1.5, at least what is used today + room for a few tasks, rounded)
 */
import { CREDITS_PER_RESUME } from "./resume-core";

export interface CreditRow {
  started_at: string | null;
  credits_used: number | null;
}

const DAY = 86_400_000;

/**
 * The moment (ms) when the credits used in the last 24 hours drop to `cap − CREDITS_PER_RESUME` or lower — the first held task
 * can resume then. `now` when there is already room; null when the cap is off or the window never frees enough (no data).
 */
export function capResumeAt(rows: readonly CreditRow[], cap: number, now: number): number | null {
  if (!(cap > 0)) return null;
  const inWindow = rows
    .map((r) => ({ at: Date.parse(String(r.started_at ?? "")), c: Math.max(0, Number(r.credits_used) || 0) }))
    .filter((r) => Number.isFinite(r.at) && r.at > now - DAY && r.at <= now && r.c > 0)
    .sort((a, b) => a.at - b.at);
  let used = inWindow.reduce((s, r) => s + r.c, 0);
  const target = cap - CREDITS_PER_RESUME;
  if (used <= target) return now;
  for (const r of inWindow) {
    used -= r.c; // this task leaves the window 24 hours after it ran
    if (used <= target) return r.at + DAY;
  }
  return null;
}

/** the cap after one click on "raise the cap": × 1.5, and at least today's use + 300 (room for ~20 tasks), rounded up to 100 */
export function suggestedCap(cap: number, used: number): number {
  const base = Math.max(Math.ceil((cap > 0 ? cap : 200) * 1.5), Math.max(0, used) + 300);
  return Math.min(100_000, Math.ceil(base / 100) * 100);
}

/** the used number shown next to the cap: never "1014/1000" — a step that was already running finished above the cap */
export function shownUsed(used: number, cap: number): number {
  return cap > 0 ? Math.min(Math.max(0, used), cap) : Math.max(0, used);
}
