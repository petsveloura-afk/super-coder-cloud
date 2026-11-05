/**
 * Wave 69 — 👍/👎 on an agent's reply (pure). The rating is stored in the EXISTING audit log (`audit_logs`, action
 * `ai.reply_feedback`, entity = the message), so no new table and no migration. A person may change their mind: only the
 * latest rating per (message, person) counts.
 */
export type FeedbackRating = "up" | "down";
export const FEEDBACK_ACTION = "ai.reply_feedback";
export const FEEDBACK_REASONS = ["wrong_info", "tone", "language", "too_long", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const isRating = (v: unknown): v is FeedbackRating => v === "up" || v === "down";
export const isReason = (v: unknown): v is FeedbackReason => typeof v === "string" && (FEEDBACK_REASONS as readonly string[]).includes(v);

export type ParsedFeedback = { ok: true; rating: FeedbackRating; reason: FeedbackReason | null } | { ok: false };

/** Only `up` / `down` are accepted; a reason is kept only on a 👎 and only when it is one of the known ones. */
export function parseFeedback(input: { rating?: unknown; reason?: unknown } | null | undefined): ParsedFeedback {
  const rating = input?.rating;
  if (!isRating(rating)) return { ok: false };
  return { ok: true, rating, reason: rating === "down" && isReason(input?.reason) ? input.reason : null };
}

export interface FeedbackRow {
  organization_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: { rating: FeedbackRating; reason: FeedbackReason | null; conversation_id: string | null; agent_id: string | null };
}

export function feedbackRow(a: { orgId: string; actorId: string | null; messageId: string; conversationId: string | null; agentId: string | null; rating: FeedbackRating; reason: FeedbackReason | null }): FeedbackRow {
  return {
    organization_id: a.orgId,
    actor_id: a.actorId,
    action: FEEDBACK_ACTION,
    entity_type: "message",
    entity_id: a.messageId,
    metadata: { rating: a.rating, reason: a.reason, conversation_id: a.conversationId, agent_id: a.agentId },
  };
}

export interface FeedbackLogRow { entity_id: string | null; actor_id: string | null; created_at: string; metadata: unknown }
export interface FeedbackSummary { up: number; down: number; total: number; upRate: number | null; reasons: Partial<Record<FeedbackReason, number>> }

/** Counts the latest rating of each person on each message. `upRate` is a whole percentage, null when nothing was rated. */
export function summarizeFeedback(rows: FeedbackLogRow[]): FeedbackSummary {
  const latest = new Map<string, { at: number; rating: FeedbackRating; reason: FeedbackReason | null }>();
  for (const r of rows ?? []) {
    const meta = (r?.metadata ?? {}) as { rating?: unknown; reason?: unknown };
    if (!r?.entity_id || !isRating(meta.rating)) continue;
    const key = `${r.entity_id}|${r.actor_id ?? ""}`;
    const at = Date.parse(r.created_at);
    const prev = latest.get(key);
    if (prev && !(at >= prev.at)) continue;
    latest.set(key, { at: Number.isFinite(at) ? at : 0, rating: meta.rating, reason: isReason(meta.reason) ? meta.reason : null });
  }
  let up = 0;
  let down = 0;
  const reasons: Partial<Record<FeedbackReason, number>> = {};
  for (const v of latest.values()) {
    if (v.rating === "up") up++;
    else {
      down++;
      if (v.reason) reasons[v.reason] = (reasons[v.reason] ?? 0) + 1;
    }
  }
  const total = up + down;
  return { up, down, total, upRate: total ? Math.round((up / total) * 100) : null, reasons };
}
