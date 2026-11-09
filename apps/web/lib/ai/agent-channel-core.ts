/**
 * Pure rules for "which agent answers on this channel" (no database, unit-tested).
 *
 * The autopilot answers a conversation with the first ENABLED agent that lists the conversation's channel in
 * `autopilot_channels`. An agent created before a channel existed — or ticked only for the official WhatsApp
 * ("whatsapp") — never listed "whatsapp_qr", so a business that linked its own WhatsApp by QR code / phone code
 * saw "connected" while nobody answered the customers.
 */

export interface AgentChannelRow {
  id: string;
  enabled?: boolean | null;
  autopilot_channels?: string[] | null;
}

/** Channels that share one inbox experience — an agent that already serves one of them is the natural pick for the others. */
const SIBLINGS: Record<string, string[]> = {
  whatsapp_qr: ["whatsapp"],
  whatsapp: ["whatsapp_qr"],
  telegram_user: ["telegram"],
};

/** True when an enabled agent already answers on `channel`. */
export function agentCoversChannel(agents: AgentChannelRow[], channel: string): boolean {
  return agents.some((a) => a.enabled !== false && (a.autopilot_channels ?? []).includes(channel));
}

/**
 * The agent that should take over `channel`: an enabled agent that already works on a sibling channel first
 * (the same sales agent the business uses on the official WhatsApp), then the first enabled agent that answers anywhere.
 * `agents` must be ordered by creation time. Null when the business has no working agent (then nothing is changed).
 */
export function pickAgentForChannel<T extends AgentChannelRow>(agents: T[], channel: string): T | null {
  const live = agents.filter((a) => a.enabled !== false && (a.autopilot_channels ?? []).length > 0);
  if (!live.length) return null;
  const siblings = SIBLINGS[channel] ?? [];
  return live.find((a) => siblings.some((s) => (a.autopilot_channels ?? []).includes(s))) ?? live[0] ?? null;
}

/** The channel list after adding `channel` (order kept, no duplicates). */
export function withChannel(channels: string[] | null | undefined, channel: string): string[] {
  return Array.from(new Set([...(channels ?? []), channel]));
}
