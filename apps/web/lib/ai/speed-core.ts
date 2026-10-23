/**
 * Speed upgrade — pure helpers (unit-tested) that make the conversation agent answer fast:
 *  - geminiThinking: Gemini 3.x models "think" at a medium level by default (seconds of extra
 *    latency on every chat reply). A sales/service chat needs the lowest level the model allows.
 *  - smartDebounceMs: wait for a burst of short messages, but answer a complete question at once.
 *  - hedgeDelayMs: when the main AI engine is slow, a second engine starts in parallel and the
 *    first good answer wins ("hedged request", the way large chat platforms keep p95 latency low).
 *  - Timing: per-stage timings so every reply's latency is visible (logs + message meta).
 * All values can be tuned by env without code changes.
 */
type Env = Record<string, string | undefined>;

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Gemini generationConfig.thinkingConfig for a chat reply (null = leave the model default). */
export function geminiThinking(model: string, env: Env = {}, purpose: "chat" | "deep" = "chat"): { thinkingBudget: number } | { thinkingLevel: ThinkingLevel } | null {
  const m = model.toLowerCase();
  // 2.5 Flash / Flash-Lite: thinking can be switched off completely (kept exactly as before)
  if (/2\.5-flash/.test(m)) return { thinkingBudget: 0 };
  const major = Number(/gemini-(\d+)(?:\.(\d+))?/.exec(m)?.[1] ?? NaN);
  const isLatestAlias = /gemini-(flash|flash-lite|pro)-latest/.test(m);
  if (!(major >= 3) && !isLatestAlias) return null;
  if (purpose === "deep") return null;
  const forced = (env.AI_GEMINI_THINKING_LEVEL ?? "").trim().toLowerCase();
  if (forced === "off" || forced === "default") return null;
  if (["minimal", "low", "medium", "high"].includes(forced)) return { thinkingLevel: forced as ThinkingLevel };
  // the lowest level each family accepts (3.8 Flash and Pro models start at "low")
  if (/pro/.test(m)) return { thinkingLevel: "low" };
  if (/gemini-3\.8/.test(m)) return { thinkingLevel: "low" };
  return { thinkingLevel: "minimal" };
}

/** The next level up — used once when a model rejects the requested level (400). */
export function nextThinkingLevel(level: ThinkingLevel): ThinkingLevel | null {
  return level === "minimal" ? "low" : null;
}

/** A Gemini 400 that is about the thinking settings (unknown level / not supported). */
export function isThinkingConfigError(status: number, message: string): boolean {
  return status === 400 && /thinking/i.test(message);
}

/** How long to wait for more customer messages before answering. */
export function smartDebounceMs(requested: number | undefined, lastText: string, env: Env = {}): number {
  if (!requested || requested <= 0) return 0;
  const forced = Number(env.AI_AUTOPILOT_DEBOUNCE_MS);
  const base = Number.isFinite(forced) && forced >= 0 && env.AI_AUTOPILOT_DEBOUNCE_MS !== undefined && env.AI_AUTOPILOT_DEBOUNCE_MS !== "" ? Math.min(forced, 10_000) : Math.min(requested, 1200);
  const t = (lastText ?? "").trim();
  if (!t) return base;
  // a complete thought (a question, a sentence, a long message, a phone number) → answer now
  const complete = /[?？؟!.。]$/.test(t) || t.length >= 30 || /\d{7,}/.test(t.replace(/[\s-]/g, ""));
  if (complete) return Math.min(base, 500);
  // a one-word greeting often comes before the real question → keep the short wait
  return base;
}

/** After how long a second engine is started in parallel (0 = off). */
export function hedgeDelayMs(env: Env = {}): number {
  const v = env.AI_HEDGE_MS;
  if (v === undefined || v === "") return 6000;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 60_000) : 6000;
}

/** Time budget for the agent's one self-correction (v15) before the checked answer is used as is. */
export function selfCheckBudgetMs(env: Env = {}): number {
  const n = Number(env.AI_SELF_CHECK_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30_000) : 7000;
}

/** Resolves to `fallback` when `p` takes longer than `ms` (the work itself keeps running). */
export function withSoftDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, Math.max(0, ms));
    p.then(
      (v) => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(v);
        }
      },
      () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(fallback);
        }
      },
    );
  });
}

/** Per-stage timer for one reply. */
export class Timing {
  private readonly t0: number;
  private last: number;
  readonly marks: Record<string, number> = {};
  constructor(private readonly now: () => number = Date.now) {
    this.t0 = now();
    this.last = this.t0;
  }
  mark(name: string): void {
    const n = this.now();
    this.marks[name] = (this.marks[name] ?? 0) + (n - this.last);
    this.last = n;
  }
  total(): number {
    return this.now() - this.t0;
  }
  toJSON(): Record<string, number> {
    return { ...this.marks, total: this.total() };
  }
}

/** "⚡ 2.4s" style label for the inbox. */
export function latencyLabel(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/**
 * Hedged request: start `primary`; when it has not finished after `delayMs`, start `backup` in
 * parallel. The first success wins. When both fail, the primary's error is thrown (it carries the
 * full routing story). A primary that fails before the delay is reported at once (its own router
 * already tried the other engines one after another).
 */
export function hedged<T>(primary: () => Promise<T>, backup: () => Promise<T>, delayMs: number, onBackupStart?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let primaryErr: unknown = null;
    let primaryDone = false;
    let backupStarted = false;
    let backupDone = false;
    let backupErr: unknown = null;
    const finishFail = () => {
      if (settled) return;
      if (primaryDone && (!backupStarted || backupDone)) {
        settled = true;
        reject(primaryErr ?? backupErr);
      }
    };
    const timer = setTimeout(() => {
      if (settled || primaryDone) return;
      backupStarted = true;
      onBackupStart?.();
      backup().then(
        (v) => {
          backupDone = true;
          if (!settled) {
            settled = true;
            resolve(v);
          }
        },
        (e) => {
          backupDone = true;
          backupErr = e;
          finishFail();
        },
      );
    }, Math.max(0, delayMs));
    primary().then(
      (v) => {
        primaryDone = true;
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(v);
        }
      },
      (e) => {
        primaryDone = true;
        primaryErr = e;
        if (!backupStarted) clearTimeout(timer);
        finishFail();
      },
    );
  });
}
