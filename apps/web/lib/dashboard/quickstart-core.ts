/**
 * Wave 59 — "ready in 3 minutes" (pure, unit-tested): the five steps that take a new business from
 * sign-up to an agent that answers customers, with a progress ring on the overview.
 */

export type QuickStepKey = "agent" | "site" | "channel" | "test" | "app";

export interface QuickStartInput {
  hasAgent: boolean;
  /** the agent knows the business (website imported or services / FAQ written) */
  knowsBusiness: boolean;
  hasChannel: boolean;
  /** a test chat ran or a real conversation exists */
  tested: boolean;
  /** phone notifications on (push subscription) or the app installed */
  appReady: boolean;
}

export interface QuickStep {
  key: QuickStepKey;
  done: boolean;
}

export function quickStartSteps(i: QuickStartInput): QuickStep[] {
  return [
    { key: "agent", done: i.hasAgent },
    { key: "site", done: i.knowsBusiness },
    { key: "channel", done: i.hasChannel },
    { key: "test", done: i.tested },
    { key: "app", done: i.appReady },
  ];
}

export function quickStartProgress(steps: QuickStep[]): { done: number; total: number; pct: number; complete: boolean; next: QuickStepKey | null } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 100, complete: done === steps.length, next: steps.find((s) => !s.done)?.key ?? null };
}

/** SVG ring geometry for the progress (stroke-dasharray). */
export function ringDash(pct: number, r = 22): { circumference: number; offset: number } {
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return { circumference: Math.round(c * 100) / 100, offset: Math.round(c * (1 - p / 100) * 100) / 100 };
}
