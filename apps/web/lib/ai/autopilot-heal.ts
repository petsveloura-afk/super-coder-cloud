/**
 * Wave 57 — the agent never gets stuck (pure helpers, unit-tested).
 *
 * A conversation must pause for a person only when a person took it, the customer asked for one, a
 * guardrail fired, or the AI credits ran out. A technical hiccup (an empty or broken AI answer, a busy
 * engine, a timeout) must NOT leave the customer waiting until someone presses "return to agent".
 */

/** Pause reasons (conversations.ai_note) that are technical — the agent takes the conversation back by itself. */
export function technicalPause(note: string | null | undefined): boolean {
  const n = (note ?? "").trim();
  if (!n) return false;
  if (/limit|demo|credit|quota/i.test(n)) return false; // out of AI credits → a person on purpose
  return n === "empty_answer" || n === "ai_busy" || n === "agent_error" || /^ai\.(?:failed|busy|self_check_timeout|empty_retry_timeout|notConfigured)$/.test(n);
}

/**
 * Removes control lines the parsers did not recognise (a free model wrote "[[FOLLOW-UP …]]",
 * "[[TASK - …]]", an unfinished "[[…" at the end) so the customer never sees them.
 */
export function stripStrayMarkers(text: string): string {
  return (text ?? "")
    .replace(/\[\[[^\]]{0,900}\]\]/g, " ")
    .replace(/\[\[[^\]]*$/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
