/**
 * Wave 21 — is a message sent from the business's own phone really the owner taking over?
 *
 *  - "echo":   the agent's own answer coming back (WhatsApp syncs every sent message to all devices;
 *              a long answer goes out as several bubbles) → ignored.
 *  - "auto":   an automatic message from the phone — a WhatsApp Business / Telegram Business greeting
 *              or away message fires within seconds of the customer's message, faster than a person
 *              can type; the same text sent to other customers right after their message is a template
 *              → shown in the chat, the agent keeps the conversation.
 *  - "person": the owner typed it → the agent steps back (wave 12 behaviour).
 * Pure (no I/O) so it is unit-tested.
 */
export type OwnerMessageKind = "echo" | "auto" | "person";

export function normalizeForCompare(text: string): string {
  return String(text ?? "")
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A person can't read a message and answer it this fast — an automatic reply. */
export const AUTO_REPLY_WINDOW_MS = 6_000;
/** A template seen in other chats is automatic only when it also came quickly. */
export const TEMPLATE_WINDOW_MS = 45_000;

export function classifyOwnerMessage(input: {
  text: string;
  /** when the phone sent it (WhatsApp timestamp); null = unknown (an older bridge) */
  sentAtMs: number | null;
  /** when it reached the server — used only for the looser template rule when the phone time is unknown */
  arrivedAtMs?: number | null;
  /** the customer's latest message in this chat (when it reached us); null = none */
  lastInboundAtMs: number | null;
  /** the agent's own texts in this chat during the last minutes */
  recentAgentTexts: string[];
  /** the same text was sent from the phone to other customers recently */
  seenInOtherChats: boolean;
  /** the agent answered this chat after the customer's latest message */
  agentAnsweredLast?: boolean;
}): { kind: OwnerMessageKind; reason: string } {
  const t = normalizeForCompare(input.text);
  if (t) {
    for (const a of input.recentAgentTexts) {
      const n = normalizeForCompare(a);
      if (!n) continue;
      if (n === t || (t.length >= 8 && n.includes(t))) return { kind: "echo", reason: "agent_echo" };
    }
  }
  const gap = input.sentAtMs !== null && input.lastInboundAtMs !== null ? input.sentAtMs - input.lastInboundAtMs : null;
  // only the phone's own timestamp is precise enough to say "faster than a person can type"
  // (clocks differ by a second or two between the phone and the server)
  if (gap !== null && gap >= -3_000 && gap <= AUTO_REPLY_WINDOW_MS) return { kind: "auto", reason: "instant_reply" };
  const at = input.sentAtMs ?? input.arrivedAtMs ?? null;
  const loose = at !== null && input.lastInboundAtMs !== null ? at - input.lastInboundAtMs : null;
  if (input.seenInOtherChats && loose !== null && loose >= -3_000 && loose <= TEMPLATE_WINDOW_MS) return { kind: "auto", reason: "template" };
  return { kind: "person", reason: "owner_typed" };
}
