/**
 * Team alerts that never get lost (pure, unit-tested).
 *   retry      a failed delivery is tried again after 1, 3, 10, 30 and 120 minutes, then given up (6 attempts in ~2.7 hours)
 *   catch-up   a customer message whose alert was never attempted (the server ran out of time after the agent replied) is sent by
 *              the sweep — only when the normal path would have sent it: the agent replied to it, or the chat is with a person
 */
export const RETRY_MINUTES = [1, 3, 10, 30, 120] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
/** a delivery left "pending" this long was interrupted (the process died mid-send) and is due again */
export const STUCK_PENDING_MS = 5 * 60_000;
/** catch-up looks at customer messages from this window, never at older ones */
export const CATCHUP_WINDOW_MS = 2 * 3600_000;
/** …and gives the normal path this long to send first */
export const CATCHUP_GRACE_MS = 3 * 60_000;

/** when the next attempt runs after `attempts` failed ones; null = give up */
export function nextRetryAt(attempts: number, now = Date.now()): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const m = RETRY_MINUTES[Math.max(0, Math.min(RETRY_MINUTES.length - 1, attempts - 1))]!;
  return new Date(now + m * 60_000);
}

export type CatchUp = "forward_reply" | "forward_human" | "skip";

/**
 * should the sweep send the alert for this customer message?
 *   - only messages inside the window, after the grace time, and after this business's first recorded delivery
 *     (so turning the feature on never floods anyone with old messages)
 *   - never when an alert for this message already exists
 *   - the agent replied → the exchange; the chat is with a person → the message; otherwise the reply is still on its way → wait
 */
export function catchUpAction(input: { messageAt: number; now: number; firstDeliveryAt: number | null; hasDelivery: boolean; agentReplied: boolean; aiMode: string | null }): CatchUp {
  if (input.hasDelivery || input.firstDeliveryAt === null) return "skip";
  if (input.messageAt <= input.firstDeliveryAt) return "skip";
  if (input.now - input.messageAt > CATCHUP_WINDOW_MS || input.now - input.messageAt < CATCHUP_GRACE_MS) return "skip";
  if (input.agentReplied) return "forward_reply";
  if (input.aiMode === "human") return "forward_human";
  return "skip";
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
