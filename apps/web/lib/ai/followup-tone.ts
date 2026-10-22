/**
 * Wave 16 — follow-ups that adapt to how the customer feels (pure, unit-tested).
 * The same silence gets a different follow-up: excited / hot customers get a quicker,
 * concrete next step; hesitant ones get reassurance; unhappy ones are not chased by the
 * bot (the database does not even plan it — see plan_followup).
 */
export type Mood = "positive" | "neutral" | "negative" | null;

export function followupTone(input: { sentiment: Mood; stage: string | null; leadScore: string | null; objections?: string | null }): string {
  if (input.sentiment === "negative") return "The customer sounded unhappy. Do NOT sell. Apologise briefly for any trouble and offer that a person from the team will call — one sentence.";
  if (input.leadScore === "hot" || input.stage === "ready" || input.sentiment === "positive")
    return "The customer was keen. Propose ONE concrete next step right away (a specific time slot, the payment link or booking) and make it a one-tap yes.";
  if (input.stage === "considering" || (input.objections ?? "").trim())
    return `The customer is still deciding${input.objections ? ` (doubt: ${String(input.objections).slice(0, 160)})` : ""}. Address that doubt in one sentence with a fact from the business data, then ask a soft yes/no question.`;
  return "Keep it light and helpful: remind them what they asked about and ask if they still need it.";
}

/** Hours until the follow-up, by mood (mirror of SQL plan_followup): hot → faster, negative → none. */
export function followupHours(baseHours: number, mood: Mood, leadScore: string | null): number | null {
  if (!baseHours || baseHours <= 0) return null;
  if (mood === "negative") return null;
  if (leadScore === "hot" || mood === "positive") return Math.max(1, Math.round(baseHours * 0.5 * 10) / 10);
  return baseHours;
}
