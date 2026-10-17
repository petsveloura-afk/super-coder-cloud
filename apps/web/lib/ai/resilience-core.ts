/**
 * Wave 15 — resilience (pure, unit-tested). Added on top of router-core; nothing there changed.
 *
 * The problem this solves: a key/model that failed was "rested" for up to 12 hours and the
 * rest was shared through the database. When every candidate was resting, the router skipped
 * ALL of them, the customer got only a holding message, and nothing recovered until someone
 * pressed "reset" in the admin screen.
 *
 * The fixes (all additive):
 *   1. capRest      — no rest can ever be longer than a few minutes (a real quota reset is
 *                     discovered by the next probe, not by waiting hours).
 *   2. probeOrder   — when every candidate is resting, probe the ones that expire soonest anyway
 *                     (a "last resort" pass), spread over providers. A success clears the rest.
 *   3. stuckPolicy  — a customer message that stays unanswered is retried, then escalated to the
 *                     team with a polite message. Nobody is ever left in silence.
 */
import type { Classified, FailureKind, RouteCandidate } from "./router-core";
import { restKey } from "./router-core";

type Env = Record<string, string | undefined>;

const MIN = 60_000;

/** Longest time a failed candidate may rest, per failure kind (overridable with AI_MAX_REST_MINUTES). */
export function restCaps(env: Env = {}): Record<FailureKind, number> {
  const override = Number(env.AI_MAX_REST_MINUTES);
  const all = Number.isFinite(override) && override > 0 ? override * MIN : null;
  const base: Record<FailureKind, number> = {
    rate: 2 * MIN,
    server: 30_000,
    daily: 20 * MIN,
    noquota: 20 * MIN,
    model: 60 * MIN,
    auth: 10 * MIN,
    other: 0,
  };
  if (all === null) return base;
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v === 0 ? 0 : Math.min(v, all)])) as Record<FailureKind, number>;
}

export function capRest(c: Pick<Classified, "kind" | "restMs">, env: Env = {}): number {
  return Math.max(0, Math.min(c.restMs, restCaps(env)[c.kind]));
}

/**
 * Candidates that are resting right now, ordered by when they expire (soonest first), keeping
 * at most `perProvider` per provider and `limit` overall — so a last-resort pass probes a few
 * different providers instead of hammering one.
 */
export function probeOrder(cands: RouteCandidate[], rests: Map<string, number>, now = Date.now(), limit = 3, perProvider = 1, minRemainingMs = 45_000): RouteCandidate[] {
  const until = (c: RouteCandidate) => Math.max(rests.get(restKey(c, "key+model")) ?? 0, rests.get(restKey(c, "model")) ?? 0, rests.get(restKey(c, "key")) ?? 0);
  // short rests (a per-minute limit) are simply waited out — only long ones are guesses worth checking
  const resting = cands.filter((c) => until(c) - now >= minRemainingMs).sort((a, b) => until(a) - until(b));
  const perCount = new Map<string, number>();
  const out: RouteCandidate[] = [];
  for (const c of resting) {
    if ((perCount.get(c.provider) ?? 0) >= perProvider) continue;
    perCount.set(c.provider, (perCount.get(c.provider) ?? 0) + 1);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** All rest keys of a candidate (a success clears every one of them). */
export function restKeysOf(c: RouteCandidate): string[] {
  return [restKey(c, "key+model"), restKey(c, "model"), restKey(c, "key")];
}

/* ------------------------------------------------------------------ stuck conversations */

export interface StuckInput {
  /** how long the customer's last message has been waiting without a real answer */
  waitingMs: number;
  /** how many times the safety net already tried to answer it */
  attempts: number;
}

export type StuckAction = "wait" | "retry" | "escalate";

/**
 * wait      — too early, the normal safety net handles it
 * retry     — try the AI again (with a last-resort probe)
 * escalate  — tell the customer politely and hand the chat to the team
 */
export function stuckPolicy(input: StuckInput, env: Env = {}): StuckAction {
  const escalateAfter = (Number(env.AI_STUCK_ESCALATE_MINUTES) > 0 ? Number(env.AI_STUCK_ESCALATE_MINUTES) : 8) * MIN;
  const retryAfter = 2 * MIN;
  if (input.waitingMs >= escalateAfter) return "escalate";
  if (input.waitingMs >= retryAfter) return "retry";
  return "wait";
}

/** Honest, warm message when the assistant could not answer for a while and the team takes over. */
export function stuckEscalationMessage(locale: string): string {
  if (locale === "en") return "Sorry for the wait 🙏 I couldn't finish answering you right now, so I've passed your message to our team — a person will reply here shortly.";
  if (locale === "ar") return "نعتذر عن التأخير 🙏 لم أتمكن من إكمال الرد الآن، لذلك حوّلت رسالتك إلى فريقنا وسيرد عليك أحد الأشخاص هنا قريباً.";
  return "סליחה על ההמתנה 🙏 לא הצלחתי לסיים לענות לך כרגע, אז העברתי את ההודעה לצוות שלנו, ונציג יחזור אליך כאן בהקדם.";
}

/** Whole-call hard deadline: a hung provider connection must never block the conversation. */
export async function withDeadline<T>(work: Promise<T>, ms: number, label = "deadline"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label} after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
