/**
 * Wave A1 — "customer-ready" guard for text an AI wrote and that is about to leave the business (pure, no I/O, unit-tested).
 *
 * Every AI-authored message to a customer (autopilot, follow-ups, team) and every AI-authored social post must be TEXT FOR
 * THE CUSTOMER and nothing else. This module is the last line of defence that decides it:
 *
 *   CLEANED (removed, the rest is the real message)
 *     reasoning_leak  the model's own thinking: <think>…</think>, <thinking>, <reasoning>, … (also an unclosed tag, or a lone
 *                     closing tag that ends a reasoning prefix)
 *     internal_note   a labelled internal section: "Internal note: …", "הערה פנימית: …", "ASSUMPTIONS: …", "ملاحظة داخلية: …"
 *                     (the label line and everything after it are the employee's, not the customer's)
 *     control_line    a leaked "[[LEAD …]]"-style control marker (same rule as the team's outbound gate)
 *
 *   BLOCKING (the text must NOT go out — a person checks it first)
 *     instruction_leak  the prompt itself leaked: "system prompt", "my instructions are", "<kb>", "SECURITY RULES", …
 *     placeholder       "[שם הלקוח]", "{{name}}", "[customer name]", "TODO", "XXX" … never filled in
 *     raw_json          the text is raw data, not a message
 *     draft_intro       "Here is the draft:" / "הנה הטיוטה:" in front of the message
 *     empty             nothing is left after cleaning
 *
 * It never rewrites the words the AI chose. A failure inside the guard must never stop a message: callers wrap it in try/catch
 * and fall back to the text as it was.
 */
import { gateOutbound, type GateReason } from "@/lib/team/output-gate-core";

export type GuardMode = "off" | "clean" | "enforce";

/** OUTBOUND_GUARD: "off" = no check · "clean" = only remove what is never for a customer · "enforce" (default) = clean AND hold unready text */
export function outboundGuardMode(raw: string | null | undefined): GuardMode {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "off" || v === "clean" || v === "enforce" ? v : "enforce";
}

export type CustomerTextReason = "reasoning_leak" | "internal_note" | "control_line" | "instruction_leak" | "placeholder" | "raw_json" | "draft_intro" | "empty";

export interface CustomerTextAssessment {
  /** true = the (cleaned) text may go out */
  ok: boolean;
  /** the text after cleaning — what goes out when ok; the held draft otherwise */
  text: string;
  /** everything that was found (cleaned and blocking) */
  reasons: CustomerTextReason[];
  /** only the reasons that stop the text from going out */
  blocking: CustomerTextReason[];
  /** true when the guard removed something from the text */
  changed: boolean;
}

const REASONING_TAGS = "think|thinking|thought|thoughts|reasoning|analysis|scratchpad|reflection|inner_monologue";
const REASONING_BLOCK = new RegExp(`<\\s*(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>`, "gi");
const REASONING_OPEN_UNCLOSED = new RegExp(`<\\s*(?:${REASONING_TAGS})\\b[^>]*>[\\s\\S]*$`, "i");
const REASONING_LONE_CLOSE = new RegExp(`^[\\s\\S]*?<\\s*/\\s*(?:${REASONING_TAGS})\\s*>`, "i");

/** a heading line that opens the employee's own internal section (explicit "internal" wording only — "הנחה:" is a discount and stays) */
const INTERNAL_NOTE_LINE =
  /^\s*[#>*_\-•\s]*(?:הערה\s+פנימית|הערות\s+פנימיות|הערה\s+(?:ל(?:צוות|מנהל|בעלים|עצמי)|למערכת)|הנחת\s+עבודה|הנחות\s+עבודה|internal\s+notes?|note\s+to\s+(?:self|team|owner|manager|editor)|notes?\s+for\s+(?:the\s+)?(?:team|owner|manager|editor)|assumptions?|reasoning|chain\s+of\s+thought|ملاحظة\s+داخلية|ملاحظات\s+داخلية|ملاحظة\s+للفريق|افتراضات)\s*[*_]{0,2}\s*[:：]/i;

/** the prompt itself leaked into the answer */
const INSTRUCTION_LEAK =
  /(?:system\s+prompt|my\s+(?:system\s+)?instructions\s+(?:are|say|state|tell)|i\s+(?:was|am)\s+(?:instructed|told|programmed)\s+to|business\s+instructions|crm_data|<\/?kb>|SECURITY\s+RULES|ROLE\s+PLAYBOOK|הוראות\s*המערכת|הפרומפט\s*שלי|ההנחיות\s*שקיבלתי|הוראות\s*שקיבלתי\s*(?:הן|אומרות)|تعليمات\s*النظام|التعليمات\s*التي\s*تلقيتها)/i;

/** a draft introduction the team's gate does not know (conservative: only DRAFT wording, never a natural "here is the answer") */
const DRAFT_INTRO_EXTRA = /(?:^|\n)\s*[#>*_\s]*(?:הנה\s+(?:ה)?(?:טיוטה|נוסח)|טיוטת\s+(?:ה)?(?:הודעה|תשובה)|here(?:'s|\s+is)\s+(?:a\s+|the\s+|my\s+)?(?:draft|proposed\s+(?:reply|message|response))|إليك\s+المسودة|هذه\s+هي\s+المسودة|مسودة\s+(?:الرسالة|الرد))[^\n]{0,40}[:：]/i;

const REASON_MAP: Record<GateReason, CustomerTextReason> = {
  placeholder: "placeholder",
  control_line: "control_line",
  raw_json: "raw_json",
  draft_text: "draft_intro",
  empty: "empty",
};

/** Removes the model's own thinking (<think>…</think> and friends, an unclosed tag, a lone closing tag). Pure; normal text comes back trimmed. */
export function stripReasoning(textRaw: string): string {
  let text = String(textRaw ?? "").replace(REASONING_BLOCK, "");
  text = text.replace(REASONING_OPEN_UNCLOSED, "");
  text = text.replace(REASONING_LONE_CLOSE, "");
  return text.trim();
}

/** Cleans and judges one customer-facing text. Pure. */
export function assessCustomerText(textRaw: string): CustomerTextAssessment {
  const original = String(textRaw ?? "");
  const reasons: CustomerTextReason[] = [];
  let text = original.replace(/\r\n?/g, "\n");

  // 1) the model's own thinking
  const noThinking = stripReasoning(text);
  if (noThinking !== text.trim()) reasons.push("reasoning_leak");
  text = noThinking;

  // 2) an internal section (the label line and everything after it)
  const lines = text.split("\n");
  const cut = lines.findIndex((l) => INTERNAL_NOTE_LINE.test(l));
  if (cut >= 0) {
    reasons.push("internal_note");
    text = lines.slice(0, cut).join("\n").trim();
  }

  // 3) leaked control lines, placeholders, raw JSON, a draft introduction (the team's outbound gate, reused as is)
  const g = gateOutbound(text);
  for (const r of g.reasons) {
    const mapped = REASON_MAP[r];
    if (!reasons.includes(mapped)) reasons.push(mapped);
  }
  text = g.text;
  if (DRAFT_INTRO_EXTRA.test(text) && !reasons.includes("draft_intro")) reasons.push("draft_intro");

  // 4) a leaked prompt is never fixed by cutting a word: the whole answer is held
  if (INSTRUCTION_LEAK.test(text) && !reasons.includes("instruction_leak")) reasons.push("instruction_leak");

  if (!text.trim() && !reasons.includes("empty")) reasons.push("empty");

  const blocking = reasons.filter((r) => r !== "reasoning_leak" && r !== "internal_note" && r !== "control_line");
  return { ok: blocking.length === 0, text: text.trim(), reasons, blocking, changed: text.trim() !== original.trim() };
}

/** What is stored next to a held message / post so a person can see why and what was written (the draft is cut). */
export function heldRecord(a: CustomerTextAssessment, draft: string): { held: true; reasons: CustomerTextReason[]; draft: string } {
  return { held: true, reasons: a.blocking.length ? a.blocking : a.reasons, draft: String(draft ?? "").slice(0, 1500) };
}

/** Short English reason for logs / the health screen (the UI shows its own translated text). */
export const CUSTOMER_TEXT_REASON_TEXT: Record<CustomerTextReason, string> = {
  reasoning_leak: "the model's own thinking was removed",
  internal_note: "an internal note section was removed",
  control_line: "an internal control line was removed",
  instruction_leak: "the text reveals the agent's instructions",
  placeholder: "the text still contains a placeholder that was never filled in",
  raw_json: "the text looks like raw data, not a message",
  draft_intro: "the text looks like a draft with an introduction, not the final message",
  empty: "nothing is left of the text",
};
