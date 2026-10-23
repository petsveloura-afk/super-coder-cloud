import { z } from "zod";
import { CONTACT_STATUSES } from "./validators";

/**
 * Automation catalogue shared by the builder UI, server validation and the
 * Postgres engine (migration 0016). Keep in sync with the SQL CHECK and
 * execute_automation_action().
 */
export const AUTOMATION_TRIGGERS = [
  "contact.created",
  "contact.status_changed",
  "contact.tagged",
  "deal.created",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "task.completed",
  "webhook.inbound",
  "form.submitted",
  "message.received",
  "appointment.booked",
  "ticket.created",
  "invoice.paid",
  // wave 17 — behavior & sales signals
  "site.behavior",
  "quote.viewed",
  "contract.signed",
  "lead.hot",
  "customer.opted_out",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const ACTION_TYPES = [
  "create_task",
  "add_tag",
  "remove_tag",
  "set_contact_status",
  "set_deal_stage",
  "assign_owner",
  "add_note",
  "notify",
  "send_email",
  "send_webhook",
  "send_whatsapp",
  "send_telegram",
  "send_sms",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const CONDITION_OPS = ["eq", "neq", "contains", "not_contains", "empty", "not_empty", "gt", "lt"] as const;

/** Fields offered in the condition builder (paths into the engine context). */
export const CONDITION_FIELDS = [
  "contact.status",
  "contact.source",
  "contact.email",
  "contact.phone",
  "contact.company_name",
  "contact.job_title",
  "contact.marketing_consent",
  "deal.title",
  "deal.value",
  "deal.currency",
  "deal.status",
  "payload.tag",
  "payload.body.utm_source",
] as const;

const text = (max: number) => z.string().trim().max(max, { message: "validation.tooLong" });
const delay = z.coerce.number().int().min(0).max(525_600).optional();

const actionConfig = {
  create_task: z.object({ title: text(200).min(1, { message: "validation.required" }), description: text(5000).optional(), due_in_days: z.coerce.number().int().min(0).max(3650).optional(), assignee: z.string().max(40).optional(), delay_minutes: delay }),
  add_tag: z.object({ tag: text(40).min(1, { message: "validation.required" }), delay_minutes: delay }),
  remove_tag: z.object({ tag: text(40).min(1, { message: "validation.required" }), delay_minutes: delay }),
  set_contact_status: z.object({ status: z.enum(CONTACT_STATUSES), delay_minutes: delay }),
  set_deal_stage: z.object({ stage_id: z.uuid({ message: "validation.invalidId" }), delay_minutes: delay }),
  assign_owner: z.object({ user_id: z.uuid({ message: "validation.invalidId" }), delay_minutes: delay }),
  add_note: z.object({ body: text(10000).min(1, { message: "validation.required" }), delay_minutes: delay }),
  notify: z.object({ to: z.string().max(40).default("admins"), text: text(300).min(1, { message: "validation.required" }), delay_minutes: delay }),
  send_email: z.object({ to: z.string().trim().max(254).default("contact").refine((v) => v === "contact" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: "validation.email" }), subject: text(200).min(1, { message: "validation.required" }), body: text(20000).min(1, { message: "validation.required" }), marketing: z.boolean().optional(), delay_minutes: delay }),
  send_webhook: z.object({ url: z.string().trim().max(2000).regex(/^https:\/\/\S+$/, { message: "validation.httpsUrl" }), delay_minutes: delay }),
  send_whatsapp: z.object({ text: text(4000).min(1, { message: "validation.required" }), delay_minutes: delay }),
  send_telegram: z.object({ text: text(4000).min(1, { message: "validation.required" }), delay_minutes: delay }),
  send_sms: z.object({ text: text(1600).min(1, { message: "validation.required" }), delay_minutes: delay }),
} satisfies Record<ActionType, z.ZodType>;

export const automationActionSchema = z.discriminatedUnion(
  "type",
  ACTION_TYPES.map((type) => z.object({ type: z.literal(type), config: actionConfig[type] })) as unknown as [z.ZodObject<{ type: z.ZodLiteral<ActionType> }>, ...z.ZodObject<{ type: z.ZodLiteral<ActionType> }>[]],
);

export const automationConditionSchema = z.object({
  field: z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/, { message: "validation.invalidId" }).max(80),
  op: z.enum(CONDITION_OPS),
  value: z.string().max(500).optional().default(""),
});

export const automationSchema = z.object({
  name: text(120).min(1, { message: "validation.required" }),
  description: text(500).optional().default(""),
  enabled: z.boolean().default(true),
  trigger_type: z.enum(AUTOMATION_TRIGGERS),
  trigger_config: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.string().max(200)).default({}),
  conditions: z.array(automationConditionSchema).max(20, { message: "validation.tooMany" }).default([]),
  actions: z.array(automationActionSchema).min(1, { message: "automations.needAction" }).max(20, { message: "validation.tooMany" }),
});
export type AutomationInput = z.infer<typeof automationSchema>;

/** Ready-made recipes for the "templates" gallery. Names/texts are i18n keys resolved by the UI. */
export const AUTOMATION_RECIPES: { key: string; trigger_type: AutomationTrigger; trigger_config?: Record<string, string>; conditions?: { field: string; op: (typeof CONDITION_OPS)[number]; value?: string }[]; actions: { type: ActionType; config: Record<string, unknown> }[] }[] = [
  {
    key: "welcomeLead",
    trigger_type: "contact.created",
    actions: [
      { type: "create_task", config: { title: "📞 {{contact.first_name}} {{contact.last_name}}", due_in_days: 1, assignee: "owner" } },
      { type: "add_tag", config: { tag: "new-lead" } },
    ],
  },
  {
    key: "dealWon",
    trigger_type: "deal.won",
    actions: [
      { type: "set_contact_status", config: { status: "customer" } },
      { type: "notify", config: { to: "all", text: "🏆 {{deal.title}} — {{deal.value}} {{deal.currency}}" } },
    ],
  },
  {
    key: "dealLostFollowUp",
    trigger_type: "deal.lost",
    actions: [{ type: "create_task", config: { title: "↩️ {{deal.title}}", due_in_days: 90, assignee: "owner" } }],
  },
  // wave 17 — behavior & sales signals
  {
    key: "pricingVisits",
    trigger_type: "site.behavior",
    trigger_config: { path_contains: "pric", min_visits: "3" },
    actions: [
      { type: "create_task", config: { title: "🔥 {{contact.first_name}} {{contact.last_name}} — 3× /pricing", due_in_days: 0, assignee: "owner" } },
      { type: "add_tag", config: { tag: "hot-intent" } },
    ],
  },
  {
    key: "quoteViewed",
    trigger_type: "quote.viewed",
    actions: [{ type: "create_task", config: { title: "👀 {{contact.first_name}} {{contact.last_name}}", due_in_days: 0, assignee: "owner" } }],
  },
  {
    key: "hotLead",
    trigger_type: "lead.hot",
    actions: [{ type: "notify", config: { to: "admins", text: "🔥 {{contact.first_name}} {{contact.last_name}} {{contact.phone}}" } }],
  },
  {
    key: "optedOut",
    trigger_type: "customer.opted_out",
    actions: [{ type: "add_tag", config: { tag: "opted-out" } }],
  },
  {
    key: "inboundLead",
    trigger_type: "webhook.inbound",
    actions: [
      { type: "add_tag", config: { tag: "inbound" } },
      { type: "notify", config: { to: "admins", text: "🔔 {{contact.first_name}} {{contact.email}}" } },
    ],
  },
];
