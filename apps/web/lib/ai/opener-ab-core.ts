/**
 * Wave 59 — A/B test of the agent's opening line (pure, unit-tested).
 *
 * The business writes two opening lines; every new conversation gets one of them (stable per
 * conversation), and the line that turns more conversations into leads wins automatically once both
 * have enough conversations. The winner can always be reset by editing the lines.
 */

export interface OpenerStats {
  /** conversations that started with each opener */
  n: [number, number];
  /** of them, how many became a lead */
  leads: [number, number];
}

export const AB_MIN_PER_VARIANT = 30;
export const AB_MIN_GAP = 0.05;

/** The business's opening lines (max two, trimmed, 4–300 characters). */
export function openersOf(profile: { openers?: unknown } | null | undefined): string[] {
  const raw = Array.isArray(profile?.openers) ? (profile!.openers as unknown[]) : [];
  return raw
    .map((x) => String(x ?? "").replace(/\s+/g, " ").trim())
    .filter((x) => x.length >= 4)
    .map((x) => x.slice(0, 300))
    .slice(0, 2);
}

/** Stable 0/1 per conversation (the same conversation always gets the same opener). */
export function variantFor(conversationId: string): 0 | 1 {
  let h = 0;
  for (let i = 0; i < conversationId.length; i++) h = (h * 31 + conversationId.charCodeAt(i)) >>> 0;
  return (h % 2) as 0 | 1;
}

export function rate(leads: number, n: number): number {
  return n > 0 ? leads / n : 0;
}

/** The winning opener once both have enough conversations and a clear gap, else null (still testing). */
export function decideWinner(s: OpenerStats): 0 | 1 | null {
  if (s.n[0] < AB_MIN_PER_VARIANT || s.n[1] < AB_MIN_PER_VARIANT) return null;
  const a = rate(s.leads[0], s.n[0]);
  const b = rate(s.leads[1], s.n[1]);
  if (Math.abs(a - b) < AB_MIN_GAP) return null;
  return a > b ? 0 : 1;
}

/** Which opener this conversation uses: the only one, the winner, or a stable split while testing. */
export function chooseOpener(conversationId: string, openers: string[], stats: OpenerStats | null): { variant: 0 | 1; text: string } | null {
  if (!openers.length) return null;
  if (openers.length === 1) return { variant: 0, text: openers[0]! };
  const winner = stats ? decideWinner(stats) : null;
  const variant = winner ?? variantFor(conversationId);
  return { variant, text: openers[variant]! };
}

/** System-prompt line for the first reply of a conversation. */
export function openerInstruction(text: string): string {
  return `OPENING LINE (this is the first reply in this conversation): start your reply with this opening, adapted naturally to what the customer wrote (keep its meaning and tone, never ignore the customer's question): "${text.replace(/"/g, "'")}"`;
}

/** Display summary for the setup screen. */
export function abSummary(s: OpenerStats): { rates: [number, number]; winner: 0 | 1 | null; needed: number } {
  return {
    rates: [rate(s.leads[0], s.n[0]), rate(s.leads[1], s.n[1])],
    winner: decideWinner(s),
    needed: Math.max(0, AB_MIN_PER_VARIANT - Math.min(s.n[0], s.n[1])),
  };
}
