/**
 * Wave 59 — the agent learns from the owner (pure, unit-tested).
 *
 * When someone from the business answers a customer's question themselves (inbox or their own phone),
 * the database records a suggestion. The owner approves it with one click and the question + answer
 * join the agent's FAQ, so next time the agent answers it alone.
 */

const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** FAQ text with the new question + answer (no duplicates, newest last, bounded). */
export function faqAppend(faq: string | null | undefined, question: string, answer: string, max = 6000): string {
  const q = clean(question, 300);
  const a = clean(answer, 1200);
  const base = String(faq ?? "").trim();
  if (q.length < 2 || a.length < 2) return base;
  if (base && norm(base).includes(norm(q)) && norm(base).includes(norm(a).slice(0, 60))) return base;
  const entry = `ש: ${q}\nת: ${a}`;
  let out = base ? `${base}\n\n${entry}` : entry;
  // keep the newest entries when the FAQ grows past the limit
  while (out.length > max && out.includes("\n\n")) out = out.slice(out.indexOf("\n\n") + 2);
  return out.slice(-max);
}

/** Cleaned suggestion for the editor (the owner may edit the answer before approving). */
export function cleanLearned(input: { question: string; answer: string }): { question: string; answer: string } | null {
  const question = clean(input.question, 600);
  const answer = clean(input.answer, 1500);
  if (question.length < 2 || answer.length < 2) return null;
  return { question, answer };
}
