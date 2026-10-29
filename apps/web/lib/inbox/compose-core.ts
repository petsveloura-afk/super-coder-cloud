/**
 * Wave 50 — AI writing tools for the inbox reply box (pure, unit-tested).
 * The person writes; one click improves the draft (never sends it). Like the "AI assist" in the big inbox tools.
 */

export const COMPOSE_MODES = ["improve", "fix", "shorter", "longer", "friendlier", "formal", "persuasive", "empathetic", "translate_he", "translate_en", "translate_ar"] as const;
export type ComposeMode = (typeof COMPOSE_MODES)[number];

const INSTRUCTION: Record<ComposeMode, string> = {
  improve: "Rewrite the draft so it is clear, natural and professional, keeping its meaning, facts and language. Keep it about the same length.",
  fix: "Fix spelling, grammar and punctuation only. Do not change the wording, tone or meaning beyond what is needed.",
  shorter: "Make the draft about half as long while keeping every fact, price, date and the call to action.",
  longer: "Expand the draft a little (max ~1.5x) with helpful, relevant detail taken only from the draft and the conversation — never invent facts.",
  friendlier: "Make the tone warmer and friendlier (one fitting emoji at most), keeping every fact.",
  formal: "Make the tone polite and formal/professional, keeping every fact.",
  persuasive: "Make the draft more persuasive: lead with the customer's benefit and end with one clear, easy next step. Keep every fact; never invent discounts or promises.",
  empathetic: "Make the draft empathetic: start by acknowledging the customer's feeling in one sincere sentence, then the solution. Keep every fact.",
  translate_he: "Translate the draft into natural, native-level Hebrew.",
  translate_en: "Translate the draft into natural, native-level English.",
  translate_ar: "Translate the draft into natural, native-level Arabic.",
};

export function isComposeMode(v: unknown): v is ComposeMode {
  return typeof v === "string" && (COMPOSE_MODES as readonly string[]).includes(v);
}

/** The instruction sent to the model for a mode (our own text only — the draft travels separately as data). */
export function composeInstruction(mode: ComposeMode): string {
  return [
    INSTRUCTION[mode],
    "Keep the same language as the draft unless the task is a translation.",
    "Never add prices, dates, names, links or promises that are not already in the draft.",
    "Keep line breaks that help reading. No quotes around the answer, no explanations, no preface — output ONLY the new message text.",
  ].join("\n");
}

/** Cleans the model answer: strips wrapping quotes / code fences / a leading label, bounds the length. */
export function cleanRewrite(raw: string | null | undefined, max = 4000): string {
  let t = (raw ?? "").trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  t = t.replace(/^(?:here(?:'s| is)[^:\n]*:|הנה[^:\n]*:|إليك[^:\n]*:)\s*/i, "").trim();
  if (/^(["“«']).*(["”»'])$/s.test(t)) t = t.slice(1, -1).trim();
  return t.slice(0, max);
}

/** A rewrite is usable when it is non-empty and not a refusal / echo of the instruction. */
export function usableRewrite(original: string, rewritten: string): boolean {
  const r = rewritten.trim();
  if (r.length < 2) return false;
  if (/^(?:i can(?:'|no)t|i'm sorry|as an ai|אני לא יכול|מצטער, אני)/i.test(r)) return false;
  if (/output only the new message|keep the same language/i.test(r)) return false;
  return r !== "" && (r !== original.trim() || original.trim().length > 0);
}
