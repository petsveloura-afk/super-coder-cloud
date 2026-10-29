"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { campaignSchema, CAMPAIGN_CHANNELS } from "@scc/shared/engagement";
import { CONTACT_STATUSES, contactSchema, dealSchema, emailSchema, phoneSchema, taskSchema, uuidSchema } from "@scc/shared/validators";
import { getOrgContext, type OrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { kickJobs } from "@/lib/jobs/kick";
import { getT } from "@/lib/i18n/server";
import { stageLabel } from "@/lib/labels";
import { memberOptions, pipelinesWithStages } from "@/lib/lookups";
import { sanitizeSearch, contactSearchFilter } from "@/lib/search";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { localNowText, matchOption, OP_TOOLS, operatorSystemPrompt, parsePlan, phoneDigits, planRef, runStatus, wallTimeToUtc, type OpTool } from "@/lib/operator/operator-core";

/**
 * Wave 54 — the AI Operator: an instruction in plain language → a plan → the person approves → it is done.
 * Every action runs with the person's own permissions (RLS + ctx.can), is validated with the same schemas as the
 * regular forms, and is written to operator_runs (history). The model never touches the database directly.
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export interface Ref {
  id: string | null;
  label: string;
  sub?: string | null;
  /** "$N" — the contact created by action N of the same plan */
  ref?: number | null;
  candidates: { id: string; label: string; sub?: string | null }[];
}

export interface PlannedAction {
  n: number;
  tool: OpTool;
  args: Record<string, string | number>;
  contact?: Ref;
  deal?: Ref;
  task?: Ref;
  assignee?: { id: string; label: string } | null;
  stage?: { id: string; label: string; pipelineId: string } | null;
  whenIso?: string | null;
  /** i18n keys under operator.warn.* */
  warnings: string[];
}

export interface OperatorPlan {
  runId: string | null;
  reply: string;
  actions: PlannedAction[];
  dropped: number;
}

export interface OpResult {
  n: number;
  tool: OpTool;
  ok: boolean;
  error?: string;
  link?: string;
  label?: string;
}

const NEEDS: Record<OpTool, Parameters<OrgContext["can"]>[0]> = {
  create_contact: "contacts.write",
  update_contact: "contacts.write",
  add_note: "contacts.write",
  add_tag: "contacts.write",
  remember: "contacts.write",
  create_task: "tasks.write",
  complete_task: "tasks.write",
  create_deal: "deals.write",
  move_deal: "deals.write",
  book_meeting: "appointments.manage",
  schedule_message: "inbox.reply",
  draft_campaign: "campaigns.manage",
  draft_post: "campaigns.manage",
};

async function orgTimeZone(orgId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  return ((data as { timezone?: string } | null)?.timezone as string | undefined) || DEFAULT_TIME_ZONE;
}

/* ---------------------------------------------------------------- resolving names → real records */

type Sb = Awaited<ReturnType<typeof createClient>>;
const contactLabel = (c: { first_name: string | null; last_name: string | null }) => `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";

async function findContacts(sb: Sb, orgId: string, query: string): Promise<{ id: string; label: string; sub: string | null }[]> {
  const raw = String(query ?? "").trim();
  if (uuidSchema.safeParse(raw).success) {
    const { data } = await sb.from("contacts").select("id, first_name, last_name, email, phone").eq("organization_id", orgId).eq("id", raw).limit(1);
    return ((data ?? []) as { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }[]).map((c) => ({ id: c.id, label: contactLabel(c), sub: c.email ?? c.phone }));
  }
  const s = sanitizeSearch(raw);
  if (!s) return [];
  const sel = "id, first_name, last_name, email, phone, company_name";
  type Row = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; company_name: string | null };
  let rows: Row[] = [];
  if (/@/.test(s)) {
    const { data } = await sb.from("contacts").select(sel).eq("organization_id", orgId).ilike("email", s).limit(5);
    rows = (data ?? []) as Row[];
  } else if (phoneDigits(s).length) {
    const ors = phoneDigits(s).map((d) => `phone.ilike.*${d.slice(-9)}*`).join(",");
    const { data } = await sb.from("contacts").select(sel).eq("organization_id", orgId).or(ors).limit(5);
    rows = (data ?? []) as Row[];
  } else {
    const tokens = s.split(" ").filter(Boolean);
    if (tokens.length >= 2) {
      const { data } = await sb.from("contacts").select(sel).eq("organization_id", orgId).ilike("first_name", `${tokens[0]}%`).ilike("last_name", `${tokens.slice(1).join(" ")}%`).limit(5);
      rows = (data ?? []) as Row[];
    }
    if (!rows.length) {
      const f = contactSearchFilter(tokens[0] ?? s);
      if (f) {
        const { data } = await sb.from("contacts").select(sel).eq("organization_id", orgId).or(f).order("created_at", { ascending: false }).limit(20);
        const all = (data ?? []) as Row[];
        const words = tokens.map((w) => w.toLowerCase());
        rows = all.filter((c) => words.every((w) => `${c.first_name} ${c.last_name} ${c.company_name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(w))).slice(0, 5);
      }
    }
  }
  return rows.map((c) => ({ id: c.id, label: contactLabel(c), sub: c.email ?? c.phone ?? c.company_name }));
}

async function resolveContact(sb: Sb, orgId: string, value: string | number | undefined): Promise<Ref> {
  const ref = planRef(value);
  if (ref !== null) return { id: null, label: `#${ref}`, ref, candidates: [] };
  const list = await findContacts(sb, orgId, String(value ?? ""));
  const exact = list.filter((c) => c.label.toLowerCase() === String(value ?? "").trim().toLowerCase());
  if (list.length === 1 || exact.length === 1) {
    const c = exact.length === 1 ? exact[0]! : list[0]!;
    return { id: c.id, label: c.label, sub: c.sub, candidates: list };
  }
  return { id: null, label: String(value ?? ""), candidates: list };
}

async function resolveDeal(sb: Sb, orgId: string, value: string): Promise<Ref> {
  const s = sanitizeSearch(value);
  if (!s) return { id: null, label: value, candidates: [] };
  type Row = { id: string; title: string; status: string; value: number | string; contact_id: string | null };
  const { data } = await sb.from("deals").select("id, title, status, value, contact_id").eq("organization_id", orgId).ilike("title", `%${s}%`).order("status").order("updated_at", { ascending: false }).limit(5);
  let rows = (data ?? []) as Row[];
  if (!rows.length) {
    // "the Cohen deal" → the open deals of a contact called Cohen
    const people = await findContacts(sb, orgId, s);
    if (people.length) {
      const { data: byContact } = await sb.from("deals").select("id, title, status, value, contact_id").eq("organization_id", orgId).in("contact_id", people.map((p) => p.id)).order("updated_at", { ascending: false }).limit(5);
      rows = (byContact ?? []) as Row[];
    }
  }
  const cands = rows.map((d) => ({ id: d.id, label: d.title, sub: d.status }));
  const open = rows.filter((d) => d.status === "open");
  if (rows.length === 1) return { id: rows[0]!.id, label: rows[0]!.title, sub: rows[0]!.status, candidates: cands };
  if (open.length === 1) return { id: open[0]!.id, label: open[0]!.title, sub: open[0]!.status, candidates: cands };
  return { id: null, label: value, candidates: cands };
}

async function resolveTask(sb: Sb, orgId: string, value: string): Promise<Ref> {
  const s = sanitizeSearch(value);
  if (!s) return { id: null, label: value, candidates: [] };
  const { data } = await sb.from("tasks").select("id, title, due_at").eq("organization_id", orgId).in("status", ["open", "in_progress"]).ilike("title", `%${s}%`).order("due_at", { ascending: true, nullsFirst: false }).limit(5);
  const rows = (data ?? []) as { id: string; title: string; due_at: string | null }[];
  const cands = rows.map((r) => ({ id: r.id, label: r.title, sub: r.due_at }));
  return rows.length === 1 ? { id: rows[0]!.id, label: rows[0]!.title, candidates: cands } : { id: null, label: value, candidates: cands };
}

/* ---------------------------------------------------------------- plan */

const planSchema = z.object({ text: z.string().trim().min(3).max(2000) });

export async function operatorPlanAction(input: { locale: string; text: string }): Promise<ActionState<OperatorPlan>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.use")) return { error: "errors.forbidden" };
  // wave 55: the AI Operator is a paid feature (plan or free trial)
  if (!(await import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "ai_operator")))) return { error: "plans.locked.ai_operator.title" };
  const p = planSchema.safeParse(input);
  if (!p.success) return { error: "operator.err.tooShort" };
  const { t } = await getT(locale);
  const [tz, members, pipelines] = await Promise.all([orgTimeZone(ctx.org.id), memberOptions(ctx.org.id), pipelinesWithStages(ctx.org.id)]);
  const stageOpts = pipelines.flatMap((pl) => pl.stages.map((s) => ({ id: s.id, label: stageLabel(t, s.name), raw: s.name, pipelineId: pl.id })));
  const me = members.find((m) => m.id === ctx.userId)?.label ?? ctx.profile?.full_name ?? ctx.email;
  const { runAI } = await import("@/lib/ai/run");
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "copilot",
    system: operatorSystemPrompt({
      lang: locale,
      timeZone: tz,
      nowText: localNowText(new Date(), tz),
      me,
      members: members.map((m) => m.label).slice(0, 40),
      stages: [...new Set(stageOpts.map((s) => s.label))].slice(0, 40),
      channels: [...CAMPAIGN_CHANNELS],
      currency: ctx.org.currency || "ILS",
    }),
    messages: [{ role: "user", content: p.data.text }],
    temperature: 0.1,
    maxTokens: 1600,
    json: true,
    // wave 55: a plan may take longer than a chat reply — give the failover chain room to find a free engine
    budgetMs: 45_000,
  });
  if (!out.ok) return { error: out.error };
  const plan = parsePlan(out.text);
  const sb = await createClient();
  const actions: PlannedAction[] = [];
  for (const [i, a] of plan.actions.entries()) {
    const n = i + 1;
    const pa: PlannedAction = { n, tool: a.tool, args: a.args, warnings: [] };
    if (!ctx.can(NEEDS[a.tool])) pa.warnings.push("forbidden");
    if (a.args.contact !== undefined) {
      pa.contact = await resolveContact(sb, ctx.org.id, a.args.contact);
      if (!pa.contact.id && pa.contact.ref == null) pa.warnings.push(pa.contact.candidates.length ? "chooseContact" : "contactNotFound");
      if (pa.contact.ref != null && plan.actions[pa.contact.ref - 1]?.tool !== "create_contact") pa.warnings.push("contactNotFound");
    }
    if (a.tool === "move_deal") {
      pa.deal = await resolveDeal(sb, ctx.org.id, String(a.args.deal));
      if (!pa.deal.id) pa.warnings.push(pa.deal.candidates.length ? "chooseDeal" : "dealNotFound");
    }
    if (a.tool === "complete_task") {
      pa.task = await resolveTask(sb, ctx.org.id, String(a.args.task));
      if (!pa.task.id) pa.warnings.push(pa.task.candidates.length ? "chooseTask" : "taskNotFound");
    }
    const who = a.args.assignee ?? a.args.host;
    if (who !== undefined) {
      const w = String(who).trim();
      const m = /^(?:me|אני|לי|أنا)$/i.test(w) ? members.find((x) => x.id === ctx.userId) ?? null : matchOption(members, w).match;
      pa.assignee = m ? { id: m.id, label: m.label } : null;
      if (!m) pa.warnings.push("memberNotFound");
    }
    if (a.args.stage !== undefined) {
      const byLabel = matchOption(stageOpts, String(a.args.stage)).match ?? matchOption(stageOpts.map((s) => ({ ...s, label: s.raw })), String(a.args.stage)).match;
      pa.stage = byLabel ? { id: byLabel.id, label: stageLabel(t, byLabel.raw ?? byLabel.label), pipelineId: byLabel.pipelineId } : null;
      if (!byLabel) pa.warnings.push("stageNotFound");
    }
    const whenRaw = a.args.due ?? a.args.start ?? a.args.at ?? a.args.when;
    if (whenRaw !== undefined) {
      pa.whenIso = wallTimeToUtc(String(whenRaw), tz);
      if (!pa.whenIso) pa.warnings.push("badTime");
      else if (new Date(pa.whenIso).getTime() < Date.now() - 60_000 && a.tool !== "create_task") pa.warnings.push("pastTime");
    }
    if (a.tool === "create_contact" && !a.args.phone && !a.args.email) pa.warnings.push("needPhoneOrEmail");
    actions.push(pa);
  }
  // history (planned) — ignored when the migration has not run yet
  const { data: run } = await sb
    .from("operator_runs")
    .insert({ organization_id: ctx.org.id, user_id: ctx.userId, instruction: p.data.text, plan: { reply: plan.reply, actions: actions.map(({ n, tool, args }) => ({ n, tool, args })) } })
    .select("id")
    .maybeSingle();
  return { ok: true, data: { runId: (run as { id?: string } | null)?.id ?? null, reply: plan.reply, actions, dropped: plan.dropped } };
}

/* ---------------------------------------------------------------- execute */

const execItem = z.object({
  n: z.number().int().min(1).max(20),
  tool: z.enum(OP_TOOLS),
  args: z.record(z.string().max(40), z.union([z.string().max(4000), z.number()])),
  contactId: z.string().optional(),
  contactRef: z.number().int().min(1).max(20).nullable().optional(),
  dealId: z.string().optional(),
  taskId: z.string().optional(),
  assigneeId: z.string().optional(),
  stageId: z.string().optional(),
  pipelineId: z.string().optional(),
  whenIso: z.string().optional(),
});
const execSchema = z.object({ runId: z.string().nullable().optional(), actions: z.array(execItem).min(1).max(10) });

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export async function operatorExecuteAction(input: { locale: string; runId?: string | null; actions: z.input<typeof execItem>[] }): Promise<ActionState<{ results: OpResult[] }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.use")) return { error: "errors.forbidden" };
  if (!(await import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "ai_operator")))) return { error: "plans.locked.ai_operator.title" };
  const p = execSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const sb = await createClient();
  const tz = await orgTimeZone(ctx.org.id);
  const members = await memberOptions(ctx.org.id);
  const memberIds = new Set(members.map((m) => m.id));
  const pipelines = await pipelinesWithStages(ctx.org.id);
  const created = new Map<number, string>();
  const results: OpResult[] = [];
  const touched = new Set<string>();

  for (const a of p.data.actions) {
    const r: OpResult = { n: a.n, tool: a.tool, ok: false };
    try {
      if (!ctx.can(NEEDS[a.tool])) throw new Error("errors.forbidden");
      const contactId = a.contactRef ? created.get(a.contactRef) : a.contactId && uuidSchema.safeParse(a.contactId).success ? a.contactId : undefined;
      const assignee = a.assigneeId && memberIds.has(a.assigneeId) ? a.assigneeId : ctx.userId;
      const when = a.whenIso && !Number.isNaN(Date.parse(a.whenIso)) ? new Date(a.whenIso) : null;
      const needContact = () => {
        if (!contactId) throw new Error("operator.err.noContact");
        return contactId;
      };
      switch (a.tool) {
        case "create_contact": {
          const c = contactSchema.safeParse({
            firstName: str(a.args.first_name),
            lastName: str(a.args.last_name),
            email: str(a.args.email),
            phone: str(a.args.phone),
            companyName: str(a.args.company),
            status: (CONTACT_STATUSES as readonly string[]).includes(str(a.args.status)) ? str(a.args.status) : undefined,
            source: "manual",
            notes: str(a.args.note),
          });
          if (!c.success) throw new Error(c.error.issues[0]?.message ?? "validation.invalid");
          const { data, error } = await sb
            .from("contacts")
            .insert({ first_name: c.data.firstName, last_name: c.data.lastName, email: c.data.email || null, phone: c.data.phone || null, company_name: c.data.companyName || null, status: c.data.status, source: c.data.source, organization_id: ctx.org.id, created_by: ctx.userId, owner_id: ctx.userId })
            .select("id")
            .single();
          if (error) throw new Error(error.code === "23505" ? "crm.duplicateEmail" : dbErrorKey(error));
          created.set(a.n, data.id as string);
          if (c.data.notes) await sb.from("notes").insert({ organization_id: ctx.org.id, contact_id: data.id, body: c.data.notes, created_by: ctx.userId });
          r.link = `/crm/${data.id}`;
          r.label = `${c.data.firstName} ${c.data.lastName}`.trim();
          touched.add("crm");
          break;
        }
        case "update_contact": {
          const id = needContact();
          const patch: Record<string, unknown> = {};
          if ((CONTACT_STATUSES as readonly string[]).includes(str(a.args.status))) patch.status = str(a.args.status);
          if (str(a.args.phone)) {
            const ph = phoneSchema.safeParse(str(a.args.phone));
            if (!ph.success) throw new Error("validation.phone");
            patch.phone = ph.data;
          }
          if (str(a.args.email)) {
            const em = emailSchema.safeParse(str(a.args.email));
            if (!em.success) throw new Error("validation.email");
            patch.email = em.data;
          }
          if (str(a.args.company)) patch.company_name = str(a.args.company).slice(0, 160);
          if (str(a.args.job_title)) patch.job_title = str(a.args.job_title).slice(0, 120);
          if (!Object.keys(patch).length) throw new Error("operator.err.nothingToChange");
          const { data, error } = await sb.from("contacts").update(patch).eq("id", id).eq("organization_id", ctx.org.id).select("id");
          if (error) throw new Error(dbErrorKey(error));
          if (!data?.length) throw new Error("errors.notFound");
          r.link = `/crm/${id}`;
          touched.add("crm");
          break;
        }
        case "add_note": {
          const id = needContact();
          const body = str(a.args.body).slice(0, 10000);
          if (!body) throw new Error("validation.required");
          const { error } = await sb.from("notes").insert({ organization_id: ctx.org.id, contact_id: id, body, created_by: ctx.userId });
          if (error) throw new Error(dbErrorKey(error));
          r.link = `/crm/${id}`;
          break;
        }
        case "add_tag": {
          const id = needContact();
          const name = str(a.args.tag).replace(/^#/, "").slice(0, 40);
          if (!name) throw new Error("validation.required");
          await sb.from("tags").upsert({ organization_id: ctx.org.id, name }, { onConflict: "organization_id,name", ignoreDuplicates: true });
          const { data: tag } = await sb.from("tags").select("id").eq("organization_id", ctx.org.id).eq("name", name).maybeSingle();
          if (!tag) throw new Error("errors.generic");
          const { error } = await sb.from("contact_tags").insert({ organization_id: ctx.org.id, contact_id: id, tag_id: tag.id });
          if (error && error.code !== "23505") throw new Error(dbErrorKey(error));
          r.link = `/crm/${id}`;
          r.label = `#${name}`;
          break;
        }
        case "remember": {
          const id = needContact();
          const fact = str(a.args.fact).slice(0, 300);
          if (fact.length < 2) throw new Error("validation.required");
          const { error } = await sb.from("contact_memories").insert({ organization_id: ctx.org.id, contact_id: id, fact, kind: "fact", source: "operator", created_by: ctx.userId });
          if (error && error.code !== "23505") throw new Error(dbErrorKey(error));
          r.link = `/crm/${id}`;
          break;
        }
        case "create_task": {
          const tk = taskSchema.safeParse({ title: str(a.args.title), description: str(a.args.description), status: "open", dueAt: when?.toISOString() ?? "", assigneeId: assignee, contactId: contactId ?? "" });
          if (!tk.success) throw new Error(tk.error.issues[0]?.message ?? "validation.invalid");
          const { error } = await sb.from("tasks").insert({
            organization_id: ctx.org.id,
            title: tk.data.title,
            description: tk.data.description || null,
            status: "open",
            due_at: tk.data.dueAt ? new Date(tk.data.dueAt).toISOString() : null,
            assignee_id: tk.data.assigneeId ?? null,
            contact_id: tk.data.contactId ?? null,
            created_by: ctx.userId,
          });
          if (error) throw new Error(dbErrorKey(error));
          r.link = "/tasks";
          r.label = tk.data.title;
          touched.add("tasks");
          break;
        }
        case "complete_task": {
          if (!a.taskId || !uuidSchema.safeParse(a.taskId).success) throw new Error("operator.err.noTask");
          const { data, error } = await sb.from("tasks").update({ status: "done" }).eq("id", a.taskId).eq("organization_id", ctx.org.id).select("id, title");
          if (error) throw new Error(dbErrorKey(error));
          if (!data?.length) throw new Error("errors.notFound");
          r.link = "/tasks";
          r.label = String((data[0] as { title?: string }).title ?? "");
          touched.add("tasks");
          break;
        }
        case "create_deal": {
          const pipe = pipelines.find((pl) => pl.id === a.pipelineId) ?? pipelines[0];
          if (!pipe || !pipe.stages.length) throw new Error("operator.err.noPipeline");
          const stage = pipe.stages.find((s) => s.id === a.stageId) ?? pipelines.flatMap((pl) => pl.stages).find((s) => s.id === a.stageId) ?? pipe.stages[0]!;
          const d = dealSchema.safeParse({ title: str(a.args.title), value: Number(a.args.value ?? 0) || 0, currency: ctx.org.currency || "ILS", pipelineId: stage.pipeline_id, stageId: stage.id, contactId: contactId ?? "", ownerId: ctx.userId });
          if (!d.success) throw new Error(d.error.issues[0]?.message ?? "validation.invalid");
          const { data, error } = await sb
            .from("deals")
            .insert({ title: d.data.title, value: d.data.value, currency: d.data.currency, pipeline_id: d.data.pipelineId, stage_id: d.data.stageId, contact_id: d.data.contactId ?? null, owner_id: d.data.ownerId ?? null, organization_id: ctx.org.id, created_by: ctx.userId })
            .select("id")
            .single();
          if (error) throw new Error(error.message?.includes("stage_not_in_pipeline") ? "deals.stageMismatch" : dbErrorKey(error));
          r.link = "/pipelines";
          r.label = d.data.title;
          void data;
          touched.add("deals");
          break;
        }
        case "move_deal": {
          if (!a.dealId || !uuidSchema.safeParse(a.dealId).success) throw new Error("operator.err.noDeal");
          const status = str(a.args.status);
          const patch: Record<string, unknown> = {};
          if (a.stageId && uuidSchema.safeParse(a.stageId).success) patch.stage_id = a.stageId;
          if (status === "won" || status === "lost" || status === "open") {
            patch.status = status;
            patch.lost_reason = status === "lost" ? str(a.args.lost_reason).slice(0, 500) || null : null;
          }
          if (!Object.keys(patch).length) throw new Error("operator.err.nothingToChange");
          const { data, error } = await sb.from("deals").update(patch).eq("id", a.dealId).eq("organization_id", ctx.org.id).select("id, title");
          if (error) throw new Error(error.message?.includes("stage_not_in_pipeline") ? "deals.stageMismatch" : dbErrorKey(error));
          if (!data?.length) throw new Error("errors.notFound");
          r.link = "/pipelines";
          r.label = String((data[0] as { title?: string }).title ?? "");
          touched.add("deals");
          break;
        }
        case "book_meeting": {
          if (!when) throw new Error("operator.err.noTime");
          const minutes = Math.max(5, Math.min(480, Math.round(Number(a.args.duration_min ?? 30)) || 30));
          const title = (str(a.args.title) || (contactId ? "Meeting" : "")).slice(0, 200) || "Meeting";
          const { error } = await sb.from("appointments").insert({
            organization_id: ctx.org.id,
            title,
            starts_at: when.toISOString(),
            ends_at: new Date(when.getTime() + minutes * 60_000).toISOString(),
            contact_id: contactId ?? null,
            host_id: assignee,
            location: str(a.args.location).slice(0, 300) || null,
            status: "confirmed",
            created_by: ctx.userId,
          });
          if (error) throw new Error(error.message.includes("appointments_no_overlap") ? "booking.taken" : dbErrorKey(error));
          r.link = "/appointments";
          r.label = title;
          touched.add("appointments");
          break;
        }
        case "schedule_message": {
          const id = needContact();
          const text = str(a.args.text).slice(0, 4000);
          if (!text) throw new Error("validation.required");
          const { data: conv } = await sb.from("conversations").select("id").eq("organization_id", ctx.org.id).eq("contact_id", id).neq("channel", "web").order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
          if (!conv) throw new Error("operator.err.noConversation");
          const runAt = when && when.getTime() > Date.now() ? when : new Date(Date.now() + 2 * 60_000);
          const { error } = await sb.rpc("schedule_conversation_message", { p_conversation: conv.id, p_body: text, p_run_at: runAt.toISOString(), p_cancel_on_reply: false });
          if (error) throw new Error(error.message?.includes("invalid_time") ? "guard.badTime" : error.code === "42501" ? "errors.forbidden" : "errors.generic");
          r.link = "/inbox";
          touched.add("inbox");
          break;
        }
        case "draft_campaign": {
          const tags = str(a.args.tags)
            .split(",")
            .map((x) => x.trim().replace(/^#/, ""))
            .filter(Boolean)
            .slice(0, 20);
          const status = str(a.args.status);
          const c = campaignSchema.safeParse({
            name: str(a.args.name),
            channel: str(a.args.channel),
            subject: str(a.args.subject),
            body: str(a.args.body),
            audience: { ...((CONTACT_STATUSES as readonly string[]).includes(status) ? { status } : {}), ...(tags.length ? { tags } : {}) },
          });
          if (!c.success) throw new Error(c.error.issues[0]?.message ?? "campaigns.invalid");
          const { data, error } = await sb
            .from("campaigns")
            .insert({ name: c.data.name, channel: c.data.channel, subject: c.data.subject || null, body: c.data.body, audience: c.data.audience, organization_id: ctx.org.id, created_by: ctx.userId })
            .select("id")
            .single();
          if (error) throw new Error(dbErrorKey(error));
          r.link = `/campaigns/${data.id}`;
          r.label = c.data.name;
          touched.add("campaigns");
          break;
        }
        case "draft_post": {
          const body = str(a.args.body).slice(0, 5000);
          if (!body) throw new Error("validation.required");
          // Instagram needs a picture — a text draft goes to Facebook (the image can be added in the editor)
          const platforms = ["facebook"];
          const at = when && when.getTime() > Date.now() ? when : new Date(wallTimeToUtc(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) + "T10:00", tz) ?? Date.now() + 86_400_000);
          const { error } = await sb.from("social_posts").insert({ organization_id: ctx.org.id, platforms, body, scheduled_at: at.toISOString(), status: "draft", source: "manual", created_by: ctx.userId });
          if (error) throw new Error(dbErrorKey(error));
          r.link = "/social";
          touched.add("social");
          break;
        }
      }
      r.ok = true;
    } catch (e) {
      const msg = (e as Error).message ?? "errors.generic";
      r.error = /^[a-z]+(\.[A-Za-z_]+)+$/.test(msg) ? msg : "errors.generic";
    }
    results.push(r);
  }

  if (p.data.runId && uuidSchema.safeParse(p.data.runId).success) {
    await sb.from("operator_runs").update({ results, status: runStatus(results), executed_at: new Date().toISOString() }).eq("id", p.data.runId).eq("user_id", ctx.userId);
  }
  for (const page of touched) revalidatePath(`/${locale}/${page === "deals" ? "pipelines" : page}`);
  revalidatePath(`/${locale}/overview`);
  revalidatePath(`/${locale}/operator`);
  kickJobs();
  return { ok: true, data: { results } };
}
