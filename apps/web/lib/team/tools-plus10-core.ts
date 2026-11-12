/**
 * Upgrade 10 — more real capabilities for the digital team (pure data, additive). Merged into the catalog by tools-core
 * (TOOLS.push) and into an employee's allowed tools by withRoleExtras10 (a SEPARATE function; never removes anything).
 *
 * Reads close gaps where an employee had to guess:
 *   • crm.recent_leads       who came in lately (source, status) — sales / service start from real people
 *   • inbox.thread           the actual last messages with a customer — never reply or follow up blind
 *   • deals.pipeline         the pipeline by stage (count + value) and won / lost in 30 days
 *   • appointments.upcoming  the meetings of the next days (no double booking, prepare the day)
 * Writes stay INTERNAL (nothing reaches a customer, nothing costs money):
 *   • tasks.complete         close a task the employee actually finished (with a note)
 *   • crm.set_status         lead → qualified → customer → inactive (only those four values)
 *   • social.update_draft    improve an existing post DRAFT in place (only drafts; same hygiene as social.save_draft)
 */
import type { ToolSpec } from "./tools-core";

export const UPGRADE10_TOOLS: ToolSpec[] = [
  { key: "crm.recent_leads", kind: "read", sensitivity: "internal", permission: "contacts.read", args: { days: "number" }, about: "Contacts created in the last N days (default 7, max 60): id, name, status, source, phone / email present. Use it to start from REAL people." },
  { key: "inbox.thread", kind: "read", sensitivity: "internal", permission: "inbox.read", args: { "contact_id!": "uuid" }, about: "The last 20 messages of the contact's latest conversation (who wrote, when, the text). Read it BEFORE writing to or about a customer." },
  { key: "deals.pipeline", kind: "read", sensitivity: "internal", permission: "deals.read", args: {}, about: "Open deals per stage of the main pipeline (count + total value) and deals won / lost in the last 30 days." },
  { key: "appointments.upcoming", kind: "read", sensitivity: "internal", permission: "appointments.read", args: { days: "number" }, about: "Scheduled / confirmed meetings of the next N days (default 7, max 30): when, title, contact. Check it before booking." },
  { key: "tasks.complete", kind: "write", sensitivity: "internal", permission: "tasks.write", args: { "task_id!": "uuid", note: "string" }, about: "Mark ONE task as done after the work really happened (optional short note is added to the description)." },
  { key: "crm.set_status", kind: "write", sensitivity: "internal", permission: "contacts.write", args: { "contact_id!": "uuid", "status!": "string" }, about: "Set a contact's status: lead | qualified | customer | inactive. Only when the conversation clearly shows it." },
  { key: "social.update_draft", kind: "write", sensitivity: "internal", permission: "campaigns.manage", args: { "post_id!": "uuid", "text!": "string" }, about: "Replace the text of an existing post DRAFT (status draft only) with an improved version. text = only the customer-facing post. Never publishes." },
];

export const CONTACT_STATUSES = ["lead", "qualified", "customer", "inactive"] as const;

export function validContactStatus(v: unknown): (typeof CONTACT_STATUSES)[number] | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (CONTACT_STATUSES as readonly string[]).includes(s) ? (s as (typeof CONTACT_STATUSES)[number]) : null;
}

export const ROLE_EXTRA_TOOLS10: Record<string, string[]> = {
  manager: ["crm.recent_leads", "inbox.thread", "deals.pipeline", "appointments.upcoming"],
  team_lead: ["crm.recent_leads", "inbox.thread", "deals.pipeline", "appointments.upcoming", "tasks.complete"],
  sales: ["crm.recent_leads", "inbox.thread", "deals.pipeline", "appointments.upcoming", "tasks.complete", "crm.set_status"],
  customer_service: ["crm.recent_leads", "inbox.thread", "appointments.upcoming", "tasks.complete"],
  marketing: ["crm.recent_leads", "social.update_draft"],
  content_writer: ["social.update_draft"],
  quality_control: ["social.update_draft", "inbox.thread"],
  analyst: ["crm.recent_leads", "deals.pipeline", "appointments.upcoming"],
  project_coordinator: ["appointments.upcoming", "deals.pipeline", "tasks.complete"],
  collections: ["inbox.thread"],
  reputation: ["inbox.thread"],
};

/** union, order-preserving, never removes anything the member already has (applied after withRoleExtras9) */
export function withRoleExtras10(role: string, tools: string[]): string[] {
  return [...new Set([...(tools ?? []), ...(ROLE_EXTRA_TOOLS10[role] ?? [])])];
}

/** a readable one-line summary of a thread for the model (newest last, customer / business marked) */
export function threadSummary(rows: { direction: string; body: string | null; created_at: string }[], max = 2600): string {
  if (!rows.length) return "no messages with this contact";
  return rows
    .map((m) => `[${m.created_at.slice(0, 16).replace("T", " ")} ${m.direction === "in" ? "customer" : "business"}] ${String(m.body ?? "").replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n")
    .slice(-max);
}

/** stages ordered by position → "Stage: n deals, value" lines */
export function pipelineSummary(stages: { id: string; name: string; position: number }[], deals: { stage_id: string; value: number | string | null }[]): { lines: string[]; openCount: number; openValue: number } {
  const by = new Map<string, { n: number; v: number }>();
  for (const d of deals) {
    const cur = by.get(d.stage_id) ?? { n: 0, v: 0 };
    cur.n++;
    cur.v += Number(d.value) || 0;
    by.set(d.stage_id, cur);
  }
  const lines = [...stages].sort((a, b) => a.position - b.position).map((s) => `${s.name}: ${by.get(s.id)?.n ?? 0} deals, ${Math.round(by.get(s.id)?.v ?? 0)}`);
  return { lines, openCount: deals.length, openValue: Math.round(deals.reduce((a, d) => a + (Number(d.value) || 0), 0)) };
}
