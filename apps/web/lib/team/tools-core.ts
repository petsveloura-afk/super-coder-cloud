/**
 * The digital team — tool catalog (pure). Every tool an employee can use maps to a REAL capability that already
 * exists in the platform (CRM, inbox, social brain, site builder, business agents, reviews, finance…). This file only
 * describes them: what they do, how sensitive they are, which permission they need and how their arguments are
 * validated. The server executors live in lib/team/tools.ts.
 */
import { UPGRADE4_TOOLS } from "./tools-plus-core";
import { UPGRADE7_TOOLS } from "./tools-plus7-core";
import { UPGRADE7C_TOOLS } from "./tools-plus7c-core";
import { UPGRADE8_ORG_TOOLS } from "./tools-org8-core";

export type ToolKind = "read" | "write";
/** internal: only inside the business · customer: visible to customers · money: involves payment · irreversible */
export type Sensitivity = "internal" | "customer" | "money" | "irreversible";

export interface ToolSpec {
  key: string;
  kind: ToolKind;
  sensitivity: Sensitivity;
  /** the app permission the business member needs for this to run in their name */
  permission: string;
  /** argument names → "string" | "number" | "uuid" | "iso" (required when the name ends with "!") */
  args: Record<string, string>;
  /** runs only from a screen (needs the person's session), not in the background */
  interactiveOnly?: boolean;
  /** what the model is told about the tool */
  about: string;
}

export const TOOLS: ToolSpec[] = [
  // ---------------------------------------------------------------- read
  { key: "crm.find_contacts", kind: "read", sensitivity: "internal", permission: "contacts.read", args: { "query!": "string" }, about: "Search the business's contacts by name / phone / email / company (max 8)." },
  { key: "crm.contact_brief", kind: "read", sensitivity: "internal", permission: "contacts.read", args: { "contact_id!": "uuid" }, about: "One contact: status, last messages summary, memories, open deals and tasks." },
  { key: "tasks.open", kind: "read", sensitivity: "internal", permission: "tasks.read", args: {}, about: "Open tasks of the business (title, due, assignee), overdue first." },
  { key: "analytics.day_metrics", kind: "read", sensitivity: "internal", permission: "analytics.read", args: {}, about: "Yesterday vs. the 7-day average: leads, conversations, AI replies, reply time, deals won, revenue." },
  { key: "deals.stuck", kind: "read", sensitivity: "internal", permission: "deals.read", args: { days: "number" }, about: "Open deals with no activity for N days (default 7)." },
  { key: "inbox.unanswered", kind: "read", sensitivity: "internal", permission: "inbox.read", args: { minutes: "number" }, about: "Conversations whose last message is from the customer and unanswered for N minutes (default 30)." },
  { key: "reviews.recent", kind: "read", sensitivity: "internal", permission: "contacts.read", args: { days: "number" }, about: "Reviews of the last N days (default 14) with rating and reply status." },
  { key: "social.performance", kind: "read", sensitivity: "internal", permission: "campaigns.manage", args: {}, about: "Published posts of the last 30 days with engagement + what the social brain learned." },
  { key: "sites.list", kind: "read", sensitivity: "internal", permission: "websites.manage", args: {}, about: "The business's websites (name, status, health score)." },
  { key: "finance.overdue", kind: "read", sensitivity: "internal", permission: "finance.read", args: {}, about: "Overdue invoices (number, customer, balance, days)." },
  // ---------------------------------------------------------------- write — internal
  { key: "crm.add_note", kind: "write", sensitivity: "internal", permission: "contacts.write", args: { "contact_id!": "uuid", "body!": "string" }, about: "Add a note to a contact card." },
  { key: "crm.add_tag", kind: "write", sensitivity: "internal", permission: "contacts.write", args: { "contact_id!": "uuid", "tag!": "string" }, about: "Tag a contact." },
  { key: "crm.remember", kind: "write", sensitivity: "internal", permission: "contacts.write", args: { "contact_id!": "uuid", "fact!": "string" }, about: "Save a lasting fact about a customer (preference, need)." },
  { key: "crm.create_task", kind: "write", sensitivity: "internal", permission: "tasks.write", args: { "title!": "string", description: "string", due_iso: "iso", contact_id: "uuid" }, about: "Create a task for the business's people." },
  { key: "deals.create", kind: "write", sensitivity: "internal", permission: "deals.write", args: { "title!": "string", value: "number", contact_id: "uuid" }, about: "Open a deal in the first stage of the main pipeline." },
  { key: "deals.move", kind: "write", sensitivity: "internal", permission: "deals.write", args: { "deal_id!": "uuid", status: "string", stage_id: "uuid" }, about: "Move a deal to a stage or mark it won / lost / open." },
  { key: "campaigns.draft", kind: "write", sensitivity: "internal", permission: "campaigns.manage", args: { "name!": "string", "channel!": "string", "body!": "string", subject: "string" }, about: "Save a campaign DRAFT (never sends)." },
  { key: "social.draft_post", kind: "write", sensitivity: "internal", permission: "campaigns.manage", args: { topic: "string" }, about: "The social brain writes + illustrates ONE post as a DRAFT for approval (uses the business's knowledge and learning)." },
  { key: "social.plan_week", kind: "write", sensitivity: "internal", permission: "campaigns.manage", args: {}, about: "The social brain plans a week of post drafts." },
  { key: "sites.build", kind: "write", sensitivity: "internal", permission: "websites.manage", args: { "brief!": "string", full: "string" }, interactiveOnly: true, about: "The site agent builds a website DRAFT from a brief (real business facts, photos, quality pass)." },
  { key: "sites.audit", kind: "read", sensitivity: "internal", permission: "websites.manage", args: { "site_id!": "uuid" }, about: "Health audit of a site: score and ordered fixes." },
  { key: "agents.run_analyst", kind: "write", sensitivity: "internal", permission: "ai.use", args: {}, about: "Run the existing analyst agent now (yesterday's brief to the owners)." },
  { key: "agents.run_sales_manager", kind: "write", sensitivity: "internal", permission: "ai.use", args: {}, about: "Run the existing sales-manager agent now (tasks for quiet deals)." },
  { key: "agents.run_marketing", kind: "write", sensitivity: "internal", permission: "ai.use", args: {}, about: "Run the existing marketing agent now (post drafts from the weekly plan)." },
  { key: "agents.run_collections", kind: "write", sensitivity: "money", permission: "finance.write", args: {}, about: "Run the existing collections agent now (reminders for overdue invoices, per its settings)." },
  { key: "reviews.draft_reply", kind: "write", sensitivity: "internal", permission: "contacts.write", args: { "review_id!": "uuid", "text!": "string" }, about: "Save a reply DRAFT on a review (publishing stays with the person)." },
  { key: "team.handoff", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "role!": "string", "title!": "string", brief: "string" }, about: "Hand a sub-task to another employee by role, with full context." },
  { key: "team.ask_user", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "question!": "string" }, about: "Ask the owner ONE focused question when essential information is missing." },
  // ---------------------------------------------------------------- write — customer-facing / money (approval by default)
  { key: "inbox.send_message", kind: "write", sensitivity: "customer", permission: "inbox.reply", args: { "contact_id!": "uuid", "text!": "string", when_iso: "iso" }, about: "Send (schedule) a message to a customer in their latest conversation." },
  { key: "calendar.book", kind: "write", sensitivity: "customer", permission: "appointments.manage", args: { "when_iso!": "iso", title: "string", contact_id: "uuid", minutes: "number" }, about: "Book a meeting (with a customer when contact_id is given)." },
  { key: "social.schedule_post", kind: "write", sensitivity: "customer", permission: "campaigns.manage", args: { "post_id!": "uuid", when_iso: "iso" }, about: "Schedule an existing post draft for publishing." },
  { key: "collections.send_reminder", kind: "write", sensitivity: "money", permission: "finance.write", args: { "contact_id!": "uuid", "text!": "string" }, about: "Send a payment reminder to a customer." },
];

// upgrade 4: additional tools (market intelligence) are appended; nothing above is changed
TOOLS.push(...UPGRADE4_TOOLS);
TOOLS.push(...UPGRADE7_TOOLS);
TOOLS.push(...UPGRADE7C_TOOLS);
TOOLS.push(...UPGRADE8_ORG_TOOLS);

export const TOOL_MAP: Record<string, ToolSpec> = Object.fromEntries(TOOLS.map((t) => [t.key, t]));

export function isTool(v: unknown): v is string {
  return typeof v === "string" && v in TOOL_MAP;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates and cleans a tool call coming from the model (server-side validation — never trust the model).
 * Unknown argument names are dropped; strings are trimmed and capped; required arguments must be present.
 */
export function validateArgs(tool: string, raw: unknown): { ok: true; args: Record<string, string | number> } | { ok: false; error: string } {
  const spec = TOOL_MAP[tool];
  if (!spec) return { ok: false, error: "unknown_tool" };
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string | number> = {};
  for (const [name0, type] of Object.entries(spec.args)) {
    const required = name0.endsWith("!");
    const name = required ? name0.slice(0, -1) : name0;
    const v = src[name];
    if (v === undefined || v === null || v === "") {
      if (required) return { ok: false, error: `missing:${name}` };
      continue;
    }
    if (type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, error: `bad:${name}` };
      out[name] = Math.max(-1e9, Math.min(1e9, n));
    } else if (type === "uuid") {
      if (!UUID.test(String(v))) return { ok: false, error: `bad:${name}` };
      out[name] = String(v).toLowerCase();
    } else if (type === "iso") {
      const t = Date.parse(String(v));
      if (Number.isNaN(t)) return { ok: false, error: `bad:${name}` };
      out[name] = new Date(t).toISOString();
    } else {
      const s = String(v).replace(/\s+/g, " ").trim().slice(0, name === "body" || name === "text" || name === "brief" ? 4000 : 400);
      if (!s && required) return { ok: false, error: `missing:${name}` };
      if (s) out[name] = s;
    }
  }
  return { ok: true, args: out };
}

/** the tool list as the model sees it (only the employee's tools) */
export function toolsPrompt(allowed: string[]): string {
  const rows = TOOLS.filter((t) => allowed.includes(t.key)).map((t) => {
    const args = Object.entries(t.args).map(([n, ty]) => `${n.replace(/!$/, "")}${n.endsWith("!") ? "" : "?"}: ${ty}`).join(", ");
    return `- ${t.key}(${args}) — ${t.about}${t.sensitivity !== "internal" ? ` [${t.sensitivity.toUpperCase()}: needs the owner's approval unless explicitly allowed]` : ""}`;
  });
  return rows.length ? `Your tools (use ONLY these):\n${rows.join("\n")}` : "You have no tools — answer from the context only.";
}
