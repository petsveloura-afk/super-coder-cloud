/**
 * Wave 59 — connection health (pure, unit-tested): is every connected channel really working?
 * A broken connection is caught before a customer gets stuck, and the owner gets ONE alert with a
 * "reconnect" button (not one per message).
 */

export type HealthLevel = "ok" | "quiet" | "warning" | "error";

export interface AccountHealthInput {
  kind: string;
  status: string;
  lastError: string | null;
  lastInboundAt: string | null;
  createdAt: string | null;
  /** failed sends on this channel in the last 24h / all sends */
  failed24h: number;
  sent24h: number;
}

export interface AccountHealth {
  level: HealthLevel;
  reason: "ok" | "status_error" | "disabled" | "send_failures" | "no_messages" | "never";
}

export function accountHealth(a: AccountHealthInput, now = new Date()): AccountHealth {
  if (a.status === "disabled") return { level: "warning", reason: "disabled" };
  if (a.status === "error") return { level: "error", reason: "status_error" };
  if (a.failed24h >= 3 && a.failed24h >= a.sent24h * 0.5) return { level: "error", reason: "send_failures" };
  if (a.failed24h >= 2) return { level: "warning", reason: "send_failures" };
  const since = a.lastInboundAt ?? null;
  if (!since) {
    const age = a.createdAt ? now.getTime() - new Date(a.createdAt).getTime() : 0;
    return age > 7 * 86_400_000 ? { level: "quiet", reason: "never" } : { level: "ok", reason: "ok" };
  }
  if (now.getTime() - new Date(since).getTime() > 14 * 86_400_000) return { level: "quiet", reason: "no_messages" };
  return { level: "ok", reason: "ok" };
}

/** Only real problems alert, at most once per 12 hours per connection and problem. */
export function shouldAlert(h: AccountHealth, lastAlertAt: string | null, now = new Date()): boolean {
  if (h.level !== "error") return false;
  if (!lastAlertAt) return true;
  return now.getTime() - new Date(lastAlertAt).getTime() >= 12 * 3600_000;
}

/** Overall: the worst level among the connections. */
export function overallHealth(levels: HealthLevel[]): HealthLevel {
  const order: HealthLevel[] = ["ok", "quiet", "warning", "error"];
  return levels.reduce<HealthLevel>((w, l) => (order.indexOf(l) > order.indexOf(w) ? l : w), "ok");
}
