/**
 * Wave 63 — quality gate for text the team sends OUT of the business (pure, unit-tested).
 * Catches what must never reach a customer: a placeholder that was never filled ("[שם הלקוח]",
 * "{{name}}"), an internal control line that leaked, raw JSON, and unfinished drafts.
 * It only ever HOLDS a message for the owner's approval (the existing approval flow); it never edits the
 * words the employee chose, except removing a leaked control line.
 */
export type GateReason = "placeholder" | "control_line" | "raw_json" | "draft_text" | "empty";

export interface GateResult {
  ok: boolean;
  text: string;
  reasons: GateReason[];
}

const PLACEHOLDER = /\[(?:שם|לקוח|תאריך|סכום|מחיר|קישור|לינק|כתובת|טלפון|חברה|עסק)[^\]\n]{0,25}\]|\[(?:name|customer|first\s*name|last\s*name|date|amount|price|link|url|address|phone|company|business)[^\]\n]{0,25}\]|\{\{\s*[\w .-]+\s*\}\}|<(?:name|שם|customer|link|date)>|\bXXX+\b|\b(?:TODO|FIXME)\b|\blorem ipsum\b/i;
const CONTROL_LINE = /^\s*\[\[[^\]]*(?:\]\])?\s*$/gm;
const CONTROL_INLINE = /\[\[\s*(?:LEAD|BUTTONS|HANDOFF|TASK|TAG|FOLLOWUP|FOLLOW-UP|REMEMBER|BOOK|PAY)\b[^\]]*\]\]/gi;
const RAW_JSON = /^\s*[\[{][\s\S]*"[\w-]+"\s*:\s*[\s\S]*[\]}]\s*$/;
const DRAFT_TEXT = /(?:^|\n)\s*(?:טיוטה|draft|להלן\s*(?:ה)?(?:טיוטה|הודעה)|here(?:'s| is) (?:a |the )?(?:draft|message)|הנה\s*(?:ה)?הודעה)\s*[:：]/i;

export function gateOutbound(textRaw: string): GateResult {
  const reasons: GateReason[] = [];
  let text = String(textRaw ?? "");
  // a leaked control line is removed (the rest of the message is the employee's real text)
  const stripped = text.replace(CONTROL_INLINE, "").replace(CONTROL_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
  if (stripped !== text.trim()) {
    reasons.push("control_line");
    text = stripped;
  }
  if (!text.trim()) return { ok: false, text, reasons: [...reasons, "empty"] };
  if (PLACEHOLDER.test(text)) reasons.push("placeholder");
  if (RAW_JSON.test(text)) reasons.push("raw_json");
  if (DRAFT_TEXT.test(text)) reasons.push("draft_text");
  // a removed control line alone is fixed, not held: the message is clean now
  const blocking = reasons.filter((r) => r !== "control_line");
  return { ok: blocking.length === 0, text, reasons };
}

export const GATE_REASON_TEXT: Record<GateReason, string> = {
  placeholder: "the text still contains a placeholder that was never filled in",
  control_line: "an internal control line was removed from the text",
  raw_json: "the text looks like raw data, not a message",
  draft_text: "the text looks like a draft with an introduction, not the final message",
  empty: "the text is empty",
};
