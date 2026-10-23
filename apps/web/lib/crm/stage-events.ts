/** Wave 15 — business events that can move a deal into a pipeline stage automatically (mirrors the SQL CHECK). */
export const STAGE_EVENTS = [
  "quote_sent",
  "quote_viewed",
  "quote_accepted",
  "contract_signed",
  "deposit_paid",
  "invoice_paid",
  "appointment_booked",
  "ai_lead",
  "ai_lead_hot",
  "form_submitted",
] as const;
export type StageEvent = (typeof STAGE_EVENTS)[number];

export function isStageEvent(v: unknown): v is StageEvent {
  return typeof v === "string" && (STAGE_EVENTS as readonly string[]).includes(v);
}
