/**
 * Wave 21 — why the agent is not answering a conversation, in plain words for the inbox.
 * Pure; the reason codes come from conversations.ai_note (ai_handoff / owner take-over / busy AI).
 */
export type AiNoteKey =
  | "owner_phone"
  | "customer_asked"
  | "angry"
  | "unsure"
  | "budget"
  | "critical"
  | "credits"
  | "busy"
  | "flow"
  | "agent";

export function aiNoteKey(note: string | null | undefined): AiNoteKey {
  const n = String(note ?? "");
  if (n === "owner_phone") return "owner_phone";
  if (n === "customer_asked" || n === "phone_human") return "customer_asked";
  if (n === "angry_customer") return "angry";
  if (/^guardrail/.test(n)) return "unsure";
  if (n === "ai_budget") return "budget";
  if (/^critical/.test(n)) return "critical";
  if (/plan_limit|credits|limit|demo/.test(n)) return "credits";
  if (/^ai_busy|^ai\.(busy|failed)/.test(n)) return "busy";
  if (/flow/.test(n)) return "flow";
  return "agent";
}

/** When an owner take-over ends by itself (null = it doesn't). */
export function resumeAt(takeoverAt: string | null | undefined, minutes: number | null | undefined): Date | null {
  if (!takeoverAt || !minutes || minutes <= 0) return null;
  const t = new Date(takeoverAt).getTime();
  return Number.isFinite(t) ? new Date(t + minutes * 60_000) : null;
}

/** Minutes until the agent may take the conversation back (0 = with the customer's next message, null = never). */
export function resumeInMinutes(takeoverAt: string | null | undefined, minutes: number | null | undefined, now: number = Date.now()): number | null {
  const at = resumeAt(takeoverAt, minutes);
  if (!at) return null;
  return Math.max(0, Math.ceil((at.getTime() - now) / 60_000));
}
