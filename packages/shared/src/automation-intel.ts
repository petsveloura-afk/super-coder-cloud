/**
 * Automation intelligence — pure, dependency-free logic shared by the builder UI,
 * the list/overview pages and (later) the AI agents.
 *
 * It NEVER changes how the Postgres engine behaves (migration 0016 and its
 * successors stay the single source of truth for execution). It only *reads* a
 * draft automation and explains it: what it will do, what can go wrong, how
 * healthy it is, and what a smart next step could be.
 *
 * Types are kept structural on purpose (plain strings) so this file has no
 * runtime import from ./automations and can be re-exported from it safely.
 */

/* ------------------------------------------------------------------ shapes */
export interface IntelAction {
  type: string;
  config: Record<string, unknown>;
}
export interface IntelCondition {
  field: string;
  op: string;
  value?: string;
}
export interface IntelDraft {
  name?: string;
  enabled?: boolean;
  trigger_type: string;
  trigger_config?: Record<string, string>;
  conditions?: IntelCondition[];
  actions: IntelAction[];
}

/** An AI agent as seen by the analyzer (read-only context; never required). */
export interface IntelAgent {
  name: string;
  enabled: boolean;
  /** Channels the agent answers on its own (autopilot), e.g. "whatsapp", "telegram", "web". */
  autopilotChannels: readonly string[];
}
export interface IntelContext {
  agents?: readonly IntelAgent[];
}

export type InsightSeverity = "error" | "warning" | "tip" | "ok";
export interface Insight {
  code: string;
  severity: InsightSeverity;
  /** Index of the action / condition the insight is about (for highlighting). */
  actionIndex?: number;
  conditionIndex?: number;
  params?: Record<string, string | number>;
}
export type AutomationGrade = "excellent" | "good" | "needsWork" | "risky";
export interface Analysis {
  insights: Insight[];
  score: number;
  grade: AutomationGrade;
  counts: Record<InsightSeverity, number>;
}

/* --------------------------------------------------------------- categories */
export const TRIGGER_CATEGORIES = {
  crm: ["contact.created", "contact.status_changed", "contact.tagged", "customer.opted_out", "task.completed"],
  sales: ["deal.created", "deal.stage_changed", "deal.won", "deal.lost", "deal.stuck", "quote.viewed", "contract.signed", "lead.hot"],
  marketing: ["form.submitted", "site.behavior", "social.comment", "webhook.inbound"],
  service: ["message.received", "ticket.created", "appointment.booked", "review.received"],
  money: ["invoice.paid", "invoice.overdue", "order.created", "cart.abandoned"],
} as const;
export type TriggerCategory = keyof typeof TRIGGER_CATEGORIES;
export const TRIGGER_CATEGORY_KEYS = Object.keys(TRIGGER_CATEGORIES) as TriggerCategory[];

export function triggerCategory(trigger: string): TriggerCategory {
  for (const k of TRIGGER_CATEGORY_KEYS) if ((TRIGGER_CATEGORIES[k] as readonly string[]).includes(trigger)) return k;
  return "crm";
}

export const ACTION_CATEGORIES = {
  records: ["create_task", "add_tag", "remove_tag", "set_contact_status", "set_deal_stage", "assign_owner", "add_note"],
  team: ["notify"],
  outbound: ["send_email", "send_whatsapp", "send_telegram", "send_sms", "send_webhook"],
} as const;
export type ActionCategory = keyof typeof ACTION_CATEGORIES;
export function actionCategory(type: string): ActionCategory {
  for (const k of Object.keys(ACTION_CATEGORIES) as ActionCategory[]) if ((ACTION_CATEGORIES[k] as readonly string[]).includes(type)) return k;
  return "records";
}

/** Recipe key → gallery category. Unknown/new recipes fall back to the trigger's category. */
export const RECIPE_CATEGORY: Record<string, TriggerCategory> = {
  welcomeLead: "crm",
  dealWon: "sales",
  dealLostFollowUp: "sales",
  pricingVisits: "marketing",
  quoteViewed: "sales",
  hotLead: "sales",
  optedOut: "crm",
  newOrder: "money",
  socialLead: "marketing",
  badReview: "service",
  dealStuck: "sales",
  inboundLead: "marketing",
  formLead: "marketing",
  appointmentPrep: "service",
  invoicePaid: "money",
  invoiceOverdue: "money",
  cartRecovery: "money",
  ticketUrgent: "service",
  contractSigned: "sales",
  newDealQuote: "sales",
};
export function recipeCategory(key: string, trigger: string): TriggerCategory {
  return RECIPE_CATEGORY[key] ?? triggerCategory(trigger);
}

/* ------------------------------------------------- what a trigger carries */
/**
 * Which records the engine context (automation_context) carries per trigger.
 *  - "always": the event is about a contact (entity_type = contact)
 *  - "maybe":  the contact is resolved from the payload / deal and can be null
 */
type Presence = "always" | "maybe";
const CONTACT_ALWAYS = new Set([
  "contact.created",
  "contact.status_changed",
  "contact.tagged",
  "customer.opted_out",
  "message.received",
  "quote.viewed",
  "contract.signed",
  "lead.hot",
  "site.behavior",
]);
const DEAL_TRIGGERS = new Set(["deal.created", "deal.stage_changed", "deal.won", "deal.lost", "deal.stuck"]);
/** Triggers whose payload may reference a deal (tasks, invoices, quotes). */
const DEAL_MAYBE = new Set(["task.completed", "quote.viewed", "contract.signed", "invoice.paid", "invoice.overdue", "lead.hot"]);

export function contactPresence(trigger: string): Presence {
  return CONTACT_ALWAYS.has(trigger) ? "always" : "maybe";
}
export function dealPresence(trigger: string): "always" | "maybe" | "never" {
  if (DEAL_TRIGGERS.has(trigger)) return "always";
  return DEAL_MAYBE.has(trigger) ? "maybe" : "never";
}

const PAYLOAD_VARS: Record<string, string[]> = {
  "contact.tagged": ["payload.tag"],
  "order.created": ["payload.total", "payload.currency"],
  "social.comment": ["payload.author", "payload.text"],
  "review.received": ["payload.rating", "payload.author", "payload.text"],
  "deal.stuck": ["payload.quiet_days"],
  "webhook.inbound": ["payload.body.utm_source"],
};

const CONTACT_VARS = ["contact.first_name", "contact.last_name", "contact.email", "contact.phone", "contact.company_name"];
const DEAL_VARS = ["deal.title", "deal.value", "deal.currency"];

/** The {{variables}} that make sense for a trigger (drives the builder's chips). */
export function variablesForTrigger(trigger: string): string[] {
  const out = [...CONTACT_VARS];
  if (dealPresence(trigger) !== "never") out.push(...DEAL_VARS);
  out.push("org.name", ...(PAYLOAD_VARS[trigger] ?? []));
  return out;
}

/* ------------------------------------------------------------ small helpers */
const MSG_ACTIONS = new Set(["send_whatsapp", "send_telegram", "send_sms"]);
/** Which autopilot channels an automation message action would share with an agent. */
const ACTION_AGENT_CHANNELS: Record<string, readonly string[]> = {
  send_whatsapp: ["whatsapp", "whatsapp_qr"],
  send_telegram: ["telegram"],
  send_sms: ["sms"],
  send_email: ["email"],
};
const CONTACT_ACTIONS = new Set(["add_tag", "remove_tag", "set_contact_status", "send_whatsapp", "send_telegram", "send_sms"]);
/** Fields that are mandatory per action (mirrors the zod schema, but never throws). */
const REQUIRED: Record<string, string[]> = {
  create_task: ["title"],
  add_tag: ["tag"],
  remove_tag: ["tag"],
  set_deal_stage: ["stage_id"],
  assign_owner: ["user_id"],
  add_note: ["body"],
  notify: ["text"],
  send_email: ["subject", "body"],
  send_webhook: ["url"],
  send_whatsapp: ["text"],
  send_telegram: ["text"],
  send_sms: ["text"],
};
const NOISY_TRIGGERS = new Set(["message.received", "social.comment", "site.behavior", "form.submitted"]);
const KNOWN_ROOTS = new Set(["contact", "deal", "org", "payload", "event"]);

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

/** Every {{variable}} used in an action's text fields (same grammar as render_template). */
export function templateVariables(config: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const v of Object.values(config)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(/\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g)) found.add(m[1]!);
  }
  return [...found];
}
/** Raw `{{ … }}` blocks that the engine will NOT understand (typos like {{Contact.Name}}). */
function malformedTemplates(config: Record<string, unknown>): number {
  let n = 0;
  for (const v of Object.values(config)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(/\{\{([^}]*)\}\}/g)) if (!/^\s*[a-z_]+(?:\.[a-z_]+)*\s*$/.test(m[1]!)) n++;
  }
  return n;
}
const delayOf = (a: IntelAction): number => {
  const n = Number(a.config?.delay_minutes ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const stable = (v: unknown): string => JSON.stringify(v, Object.keys((v ?? {}) as object).sort());

/* ---------------------------------------------------------------- analyzer */
/**
 * Reads a draft and returns human-meaningful findings. Pure: same input → same
 * output, no I/O. Messages live in the UI layer (keyed by `code`).
 */
export function analyzeAutomation(d: IntelDraft, ctx: IntelContext = {}): Analysis {
  const insights: Insight[] = [];
  const add = (i: Insight) => insights.push(i);
  const actions = d.actions ?? [];
  const conditions = d.conditions ?? [];
  const tc = d.trigger_config ?? {};
  const trig = d.trigger_type;
  const hasContact = contactPresence(trig);
  const hasDeal = dealPresence(trig);

  if (actions.length === 0) add({ code: "noActions", severity: "error" });

  // 1) required fields
  actions.forEach((a, i) => {
    for (const f of REQUIRED[a.type] ?? []) {
      if (!str(a.config?.[f])) add({ code: "emptyField", severity: "error", actionIndex: i, params: { field: f, n: i + 1 } });
    }
    if (a.type === "send_email") {
      const to = str(a.config?.to) || "contact";
      if (to !== "contact" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) add({ code: "badEmail", severity: "error", actionIndex: i, params: { n: i + 1 } });
    }
    if (a.type === "send_webhook" && str(a.config?.url) && !/^https:\/\/\S+$/.test(str(a.config?.url))) add({ code: "badUrl", severity: "error", actionIndex: i, params: { n: i + 1 } });
  });

  // 2) record availability (these steps would be skipped by the engine with no_contact / no_deal)
  actions.forEach((a, i) => {
    const needsContact = CONTACT_ACTIONS.has(a.type) || (a.type === "send_email" && (str(a.config?.to) || "contact") === "contact");
    if (needsContact && hasContact === "maybe") add({ code: "contactMaybe", severity: "tip", actionIndex: i, params: { n: i + 1 } });
    if (a.type === "set_deal_stage") {
      if (hasDeal === "never") add({ code: "dealUnavailable", severity: "warning", actionIndex: i, params: { n: i + 1 } });
      else if (hasDeal === "maybe") add({ code: "dealMaybe", severity: "tip", actionIndex: i, params: { n: i + 1 } });
    }
  });

  // 3) variables
  actions.forEach((a, i) => {
    const used = templateVariables(a.config ?? {});
    const unknown = used.filter((v) => !KNOWN_ROOTS.has(v.split(".")[0]!));
    if (unknown.length) add({ code: "varUnknown", severity: "warning", actionIndex: i, params: { n: i + 1, vars: unknown.slice(0, 3).join(", ") } });
    if (malformedTemplates(a.config ?? {}) > 0) add({ code: "varMalformed", severity: "warning", actionIndex: i, params: { n: i + 1 } });
    if (hasDeal === "never" && used.some((v) => v.startsWith("deal."))) add({ code: "varDealUnavailable", severity: "warning", actionIndex: i, params: { n: i + 1 } });
    const payloadVars = used.filter((v) => v.startsWith("payload."));
    const known = PAYLOAD_VARS[trig] ?? [];
    const stray = payloadVars.filter((v) => !known.some((k) => v === k || v.startsWith(`${k}.`)) && !v.startsWith("payload.body."));
    if (stray.length && known.length) add({ code: "varPayloadUnlikely", severity: "tip", actionIndex: i, params: { n: i + 1, vars: stray.slice(0, 3).join(", ") } });
  });

  // 4) conditions
  conditions.forEach((c, i) => {
    const needsValue = !["empty", "not_empty"].includes(c.op);
    if (needsValue && !str(c.value)) add({ code: "emptyConditionValue", severity: "warning", conditionIndex: i, params: { n: i + 1 } });
    if (c.field.startsWith("deal.") && hasDeal === "never") add({ code: "conditionDealUnavailable", severity: "warning", conditionIndex: i, params: { n: i + 1 } });
    if (["gt", "lt"].includes(c.op) && str(c.value) && !/^-?\d+(\.\d+)?$/.test(str(c.value))) add({ code: "numericOnly", severity: "warning", conditionIndex: i, params: { n: i + 1 } });
  });
  const seenCond = new Set<string>();
  conditions.forEach((c, i) => {
    const key = `${c.field}|${c.op}|${str(c.value).toLowerCase()}`;
    if (seenCond.has(key)) add({ code: "duplicateCondition", severity: "tip", conditionIndex: i, params: { n: i + 1 } });
    seenCond.add(key);
  });

  // 5) loops / self-triggering (the engine has a depth guard — this warns before it has to kick in)
  const tagged = str(tc.tag);
  if (trig === "contact.tagged") {
    actions.forEach((a, i) => {
      if (a.type === "add_tag" && (!tagged || str(a.config?.tag) === tagged)) add({ code: "loopTag", severity: "warning", actionIndex: i, params: { n: i + 1 } });
    });
  }
  if (trig === "contact.status_changed") {
    actions.forEach((a, i) => {
      if (a.type === "set_contact_status" && (!str(tc.to) || str(a.config?.status) === str(tc.to))) add({ code: "loopStatus", severity: "warning", actionIndex: i, params: { n: i + 1 } });
    });
  }
  if (trig === "deal.stage_changed") {
    actions.forEach((a, i) => {
      if (a.type === "set_deal_stage" && (!str(tc.stage_id) || str(a.config?.stage_id) === str(tc.stage_id))) add({ code: "loopStage", severity: "warning", actionIndex: i, params: { n: i + 1 } });
    });
  }

  // 6) action hygiene
  const seenAction = new Map<string, number>();
  actions.forEach((a, i) => {
    const key = `${a.type}|${stable(a.config ?? {})}`;
    const first = seenAction.get(key);
    if (first != null) add({ code: "duplicateAction", severity: "warning", actionIndex: i, params: { n: i + 1, first: first + 1 } });
    else seenAction.set(key, i);
  });
  const added = new Map<string, number>();
  actions.forEach((a, i) => {
    if (a.type === "add_tag" && str(a.config?.tag)) added.set(str(a.config.tag), i);
  });
  actions.forEach((a, i) => {
    const t = a.type === "remove_tag" ? str(a.config?.tag) : "";
    if (t && added.has(t)) add({ code: "tagConflict", severity: "warning", actionIndex: i, params: { n: i + 1, tag: t } });
  });
  const messages = actions.filter((a) => MSG_ACTIONS.has(a.type) || a.type === "send_email");
  if (messages.length >= 4) add({ code: "manyMessages", severity: "warning", params: { count: messages.length } });
  if (messages.length > 0 && !conditions.length && NOISY_TRIGGERS.has(trig)) add({ code: "broadOutbound", severity: "warning" });
  actions.forEach((a, i) => {
    if (a.type === "notify" && (str(a.config?.to) || "admins") === "all" && NOISY_TRIGGERS.has(trig)) add({ code: "noisyNotify", severity: "tip", actionIndex: i, params: { n: i + 1 } });
    if (MSG_ACTIONS.has(a.type)) add({ code: "consentReminder", severity: "tip", actionIndex: i, params: { n: i + 1 } });
    if (a.type === "send_email" && a.config?.marketing !== true && /(unsubscribe|promo|sale|discount|הנחה|מבצע|הסרה מרשימת|عرض|خصم)/i.test(`${str(a.config?.subject)} ${str(a.config?.body)}`)) {
      add({ code: "marketingFlag", severity: "tip", actionIndex: i, params: { n: i + 1 } });
    }
  });

  // 7) timing
  const delays = actions.map(delayOf);
  for (let i = 1; i < actions.length; i++) {
    if (delays[i]! === 0 && delays[i - 1]! > 0) {
      add({ code: "delayOrder", severity: "tip", actionIndex: i, params: { n: i + 1 } });
      break;
    }
  }
  const longest = Math.max(0, ...delays);
  if (longest >= 43_200) add({ code: "longDelay", severity: "tip", params: { days: Math.round(longest / 1440) } });

  // 8) trigger specifics
  if (trig === "site.behavior" && !str(tc.path_contains) && !str(tc.min_visits) && !str(tc.min_seconds)) add({ code: "behaviorUnfiltered", severity: "warning" });
  if (trig === "webhook.inbound") add({ code: "inboundInfo", severity: "tip" });
  if (d.enabled === false) add({ code: "disabled", severity: "tip" });

  // 8b) AI agents: when an agent already answers customers on a channel by itself, an automation that
  // reacts to an incoming message on that same channel sends a SECOND reply (the customer may get two answers).
  if (trig === "message.received") {
    const live = (ctx.agents ?? []).filter((g) => g.enabled && g.autopilotChannels.length > 0);
    if (live.length > 0) {
      actions.forEach((a, i) => {
        const chans = ACTION_AGENT_CHANNELS[a.type];
        if (!chans) return;
        const agent = live.find((g) => g.autopilotChannels.some((c) => chans.includes(c)));
        if (agent) add({ code: "agentDoubleReply", severity: conditions.length > 0 ? "tip" : "warning", actionIndex: i, params: { n: i + 1, agent: agent.name } });
      });
    }
  }

  // 9) positives
  if (conditions.length > 0 && !insights.some((i) => i.severity === "error")) add({ code: "hasConditions", severity: "ok" });
  if (actions.some((a) => a.type === "notify") && actions.some((a) => actionCategory(a.type) === "records")) add({ code: "teamLoop", severity: "ok" });
  if (!insights.some((i) => i.severity === "error" || i.severity === "warning")) add({ code: "allGood", severity: "ok" });

  // de-duplicate identical consent reminders across channels
  const seen = new Set<string>();
  const deduped = insights.filter((i) => {
    const k = i.code === "consentReminder" ? "consentReminder" : `${i.code}|${i.actionIndex ?? ""}|${i.conditionIndex ?? ""}|${JSON.stringify(i.params ?? {})}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const counts: Record<InsightSeverity, number> = { error: 0, warning: 0, tip: 0, ok: 0 };
  for (const i of deduped) counts[i.severity]++;
  const score = Math.max(0, Math.min(100, 100 - counts.error * 25 - counts.warning * 10 - Math.min(counts.tip, 5) * 2));
  const grade: AutomationGrade = counts.error > 0 ? "risky" : score >= 92 ? "excellent" : score >= 75 ? "good" : score >= 55 ? "needsWork" : "risky";
  const order: Record<InsightSeverity, number> = { error: 0, warning: 1, tip: 2, ok: 3 };
  deduped.sort((a, b) => order[a.severity] - order[b.severity]);
  return { insights: deduped, score, grade, counts };
}

/* ------------------------------------------------------------ flow preview */
export type FlowNode =
  | { kind: "trigger"; trigger: string; config: Record<string, string> }
  | { kind: "condition"; index: number; field: string; op: string; value: string }
  | { kind: "action"; index: number; type: string; delayMinutes: number; cumulativeMinutes: number; category: ActionCategory };

/** Linear, timeline-style description of a draft: trigger → conditions → actions (with cumulative delay). */
export function describeFlow(d: IntelDraft): FlowNode[] {
  const nodes: FlowNode[] = [{ kind: "trigger", trigger: d.trigger_type, config: d.trigger_config ?? {} }];
  (d.conditions ?? []).forEach((c, index) => nodes.push({ kind: "condition", index, field: c.field, op: c.op, value: str(c.value) }));
  // Delays in the engine are relative to the EVENT, not to the previous step.
  (d.actions ?? []).forEach((a, index) => {
    const delayMinutes = delayOf(a);
    nodes.push({ kind: "action", index, type: a.type, delayMinutes, cumulativeMinutes: delayMinutes, category: actionCategory(a.type) });
  });
  return nodes;
}

export interface DelayParts {
  value: number;
  unit: "now" | "minutes" | "hours" | "days" | "weeks";
}
export function delayParts(minutes: number): DelayParts {
  const m = Math.max(0, Math.floor(minutes));
  if (m === 0) return { value: 0, unit: "now" };
  if (m < 60) return { value: m, unit: "minutes" };
  if (m < 1440) return { value: Math.round(m / 60), unit: "hours" };
  if (m < 10080) return { value: Math.round(m / 1440), unit: "days" };
  return { value: Math.round(m / 10080), unit: "weeks" };
}

/* ------------------------------------------------------- smart suggestions */
export interface Suggestion {
  code: string;
  action: IntelAction;
}
/**
 * One-click additions that fit the trigger and what the automation already does.
 * Every suggested action is a valid action (passes automationActionSchema).
 */
export function suggestActions(d: IntelDraft): Suggestion[] {
  const out: Suggestion[] = [];
  const types = new Set((d.actions ?? []).map((a) => a.type));
  const trig = d.trigger_type;
  const cat = triggerCategory(trig);
  const who = "{{contact.first_name}} {{contact.last_name}}";
  const hasDeal = dealPresence(trig) !== "never";
  const subject = hasDeal ? "{{deal.title}}" : who;

  if (!types.has("notify") && ["sales", "money", "service"].includes(cat)) {
    out.push({ code: "addNotify", action: { type: "notify", config: { to: "admins", text: `🔔 ${subject}` } } });
  }
  if (!types.has("create_task") && contactPresence(trig) === "always") {
    out.push({ code: "addFollowUp", action: { type: "create_task", config: { title: `📞 ${who}`, due_in_days: 1, assignee: "owner" } } });
  }
  if (!types.has("add_note") && ["sales", "service", "marketing"].includes(cat)) {
    out.push({ code: "addNote", action: { type: "add_note", config: { body: `🤖 ${trig} — ${subject}` } } });
  }
  if (!types.has("add_tag") && contactPresence(trig) === "always") {
    out.push({ code: "addTag", action: { type: "add_tag", config: { tag: trig.replace(/\./g, "-") } } });
  }
  if (!types.has("create_task") && (trig === "cart.abandoned" || trig === "invoice.overdue" || trig === "deal.stuck")) {
    out.push({ code: "addDelayedCheck", action: { type: "create_task", config: { title: `⏰ ${subject}`, due_in_days: 2, assignee: "owner", delay_minutes: 1440 } } });
  }
  return out.slice(0, 3);
}

/* ------------------------------------------------------ run statistics */
export interface RunLike {
  status: string;
  created_at: string;
}
export interface RunSummary {
  total: number;
  success: number;
  partial: number;
  failed: number;
  skipped: number;
  /** Executed runs only (skipped = conditions not met, not an execution). */
  executed: number;
  /** 0–100, null when nothing executed yet. */
  successRate: number | null;
  lastRunAt: string | null;
}
export function summarizeRuns(runs: readonly RunLike[]): RunSummary {
  const s: RunSummary = { total: runs.length, success: 0, partial: 0, failed: 0, skipped: 0, executed: 0, successRate: null, lastRunAt: null };
  let last = -Infinity;
  for (const r of runs) {
    if (r.status === "success") s.success++;
    else if (r.status === "partial") s.partial++;
    else if (r.status === "failed") s.failed++;
    else if (r.status === "skipped") s.skipped++;
    const ts = Date.parse(r.created_at);
    if (Number.isFinite(ts) && ts > last) {
      last = ts;
      s.lastRunAt = r.created_at;
    }
  }
  s.executed = s.success + s.partial + s.failed;
  s.successRate = s.executed ? Math.round(((s.success + s.partial * 0.5) / s.executed) * 100) : null;
  return s;
}

/** Per-day counts for the last `days` days (oldest → newest), used by the sparkline. */
export function dailyBuckets(runs: readonly RunLike[], days: number, nowMs: number): { day: string; ok: number; bad: number }[] {
  const DAY = 86_400_000;
  const startOfToday = Math.floor(nowMs / DAY) * DAY;
  const out = Array.from({ length: days }, (_, i) => ({ day: new Date(startOfToday - (days - 1 - i) * DAY).toISOString().slice(0, 10), ok: 0, bad: 0 }));
  const index = new Map(out.map((b, i) => [b.day, i]));
  for (const r of runs) {
    if (r.status === "skipped") continue;
    const ts = Date.parse(r.created_at);
    if (!Number.isFinite(ts)) continue;
    const i = index.get(new Date(ts).toISOString().slice(0, 10));
    if (i == null) continue;
    if (r.status === "success") out[i]!.ok++;
    else out[i]!.bad++;
  }
  return out;
}

export type AutomationHealth = "disabled" | "idle" | "healthy" | "attention" | "failing";
/** One word for the list view: how is this automation doing right now? */
export function automationHealth(enabled: boolean, summary: RunSummary): AutomationHealth {
  if (!enabled) return "disabled";
  if (summary.executed === 0) return "idle";
  if (summary.successRate != null && summary.successRate < 50) return "failing";
  if (summary.successRate != null && summary.successRate < 85) return "attention";
  return "healthy";
}

/* ------------------------------------------------------------- list helper */
/** Plain-text search used by the list view (name, description, trigger label text). */
export function matchesQuery(haystack: readonly (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).every((part) => haystack.some((h) => (h ?? "").toLowerCase().includes(part)));
}
