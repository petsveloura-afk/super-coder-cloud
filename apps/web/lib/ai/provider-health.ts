import "server-only";
import { recordSample, rankByHealth, summarizeWindow, type HealthRow, type HealthWindow } from "./provider-health-core";
import { hintOrder, type ModelHint } from "./task-hint-core";

/**
 * Wave 66 — server glue for the provider health window. In-process memory only (no table, no environment variable): a new
 * server instance simply starts neutral. Every function swallows its own errors and falls back to "no change".
 */
let win: HealthWindow = {};

/** one finished attempt of the router (success or failure, with its response time) */
export function noteAttempt(a: { provider: string; ok: boolean; ms: number }, now = Date.now()): void {
  try {
    win = recordSample(win, a.provider, { t: now, ok: a.ok, ms: a.ms }, now);
  } catch {
    /* health is a hint, never a requirement */
  }
}

/** the candidates in the order to try: the model hint first (not for the preferred provider), then the health re-rank. Same items, never fewer. */
export function tuneCandidates<T extends { provider: string; model: string }>(cands: T[], o: { preferred?: string | null; hint?: ModelHint | null; now?: number } = {}): T[] {
  try {
    const now = o.now ?? Date.now();
    const hinted = hintOrder(cands, o.hint ?? null, o.preferred ?? null);
    const ranked = rankByHealth(hinted, win, now);
    return ranked.length === cands.length ? ranked : cands;
  } catch {
    return cands;
  }
}

/** the rows of a health card (read by wave 67); empty on any error */
export function healthRows(now = Date.now()): HealthRow[] {
  try {
    return summarizeWindow(win, now);
  } catch {
    return [];
  }
}

/** tests only */
export function resetHealthWindow(): void {
  win = {};
}
