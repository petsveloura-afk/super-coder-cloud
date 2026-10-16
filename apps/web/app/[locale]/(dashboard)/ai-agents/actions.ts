"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { limitErrorKey } from "@scc/shared/billing";
import { getOrgContext } from "@/lib/auth";
import { isLocale, LOCALES, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { contactSearchFilter } from "@/lib/search";
import { baseSystem, dataBlock, neutralise } from "@/lib/ai/prompt";
import { runAI } from "@/lib/ai/run";
import { dbErrorKey, formValues, type ActionState } from "@/lib/action-state";

function loc(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

const agentSchema = z.object({
  name: z.string().trim().min(1, "validation.required").max(80, "validation.tooLong"),
  instructions: z.string().trim().max(8000, "validation.tooLong"),
  provider: z.enum(["openai", "anthropic", "gemini"]),
  model: z.string().trim().regex(/^[A-Za-z0-9._:-]{2,80}$/, "validation.invalidId"),
  temperature: z.coerce.number().min(0).max(1),
  language: z.enum(LOCALES),
  enabled: z.boolean(),
  crmLookup: z.boolean(),
  siteBuilder: z.boolean().default(false),
  imageGen: z.boolean().default(false),
  // wave 6 — the agent answers customers automatically on these channels
  autopilot: z.array(z.enum(["web", "telegram", "whatsapp", "whatsapp_qr", "sms", "email", "telegram_user"])).max(7).default([]),
  greeting: z.string().trim().max(500, "validation.tooLong").default(""),
  handoffRules: z.string().trim().max(2000, "validation.tooLong").default(""),
});

const FIELDS = ["name", "instructions", "provider", "model", "temperature", "language"];

export async function saveAgentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const values = formValues(fd, FIELDS);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden", values };
  const parsed = agentSchema.safeParse({
    name: fd.get("name"),
    instructions: fd.get("instructions") ?? "",
    provider: fd.get("provider"),
    model: fd.get("model"),
    temperature: fd.get("temperature") ?? 0.3,
    language: fd.get("language") ?? locale,
    enabled: fd.get("enabled") === "on",
    crmLookup: fd.get("crmLookup") === "on",
    siteBuilder: fd.get("siteBuilder") === "on",
    imageGen: fd.get("imageGen") === "on",
    autopilot: fd.get("autopilotForm") === "1" ? [...new Set(fd.getAll("autopilot").map(String))] : undefined,
    greeting: fd.get("greeting") ?? "",
    handoffRules: fd.get("handoffRules") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const row = {
    name: parsed.data.name,
    instructions: parsed.data.instructions,
    provider: parsed.data.provider,
    model: parsed.data.model,
    temperature: parsed.data.temperature,
    language: parsed.data.language,
    enabled: parsed.data.enabled,
    allowed_tools: [
      ...(parsed.data.crmLookup ? ["crm_lookup"] : []),
      "draft_message",
      ...(parsed.data.siteBuilder ? ["site_builder"] : []),
      ...(parsed.data.imageGen ? ["image_gen"] : []),
    ],
    ...(fd.get("autopilotForm") === "1"
      ? { autopilot_channels: parsed.data.autopilot, greeting: parsed.data.greeting, handoff_rules: parsed.data.handoffRules, ...salesFields(fd) }
      : {}),
  };
  const supabase = await createClient();
  const id = uuidSchema.safeParse(fd.get("id"));
  const { error } = id.success
    ? await supabase.from("ai_agents").update(row).eq("id", id.data).eq("organization_id", ctx.org.id)
    : await supabase.from("ai_agents").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId });
  if (error) return { error: limitErrorKey(error.message) ?? dbErrorKey(error), values };
  revalidatePath(`/${locale}/ai-agents`);
  // keep the Telegram bot's menu / description in sync with the agent
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { configureTelegramBot } = await import("@/lib/channels/telegram-setup");
      await configureTelegramBot(ctx.org.id);
    } catch {
      /* cosmetic */
    }
  }
  return { ok: true, message: "ai.saved" };
}

export async function deleteAgentAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(fd.get("id"));
  if (!id.success || !ctx.can("ai.manage")) return;
  const supabase = await createClient();
  await supabase.from("ai_agents").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  revalidatePath(`/${locale}/ai-agents`);
}

const historySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
  .max(10);

export async function agentChatAction(
  _prev: ActionState<{ reply: string; history: { role: "user" | "assistant"; content: string }[] }>,
  fd: FormData,
): Promise<ActionState<{ reply: string; history: { role: "user" | "assistant"; content: string }[] }>> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const agentId = uuidSchema.safeParse(fd.get("agentId"));
  const message = z.string().trim().min(1).max(2000).safeParse(fd.get("message"));
  let history: z.infer<typeof historySchema> = [];
  try {
    const h = historySchema.safeParse(JSON.parse(String(fd.get("history") ?? "[]")));
    if (h.success) history = h.data;
  } catch {
    history = [];
  }
  if (!agentId.success || !message.success) return { error: "validation.required", data: { reply: "", history } };

  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("ai_agents")
    .select("id, name, instructions, provider, model, temperature, language, enabled, allowed_tools")
    .eq("id", agentId.data)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!agent) return { error: "errors.notFound", data: { reply: "", history } };
  if (!agent.enabled) return { error: "ai.agentDisabled", data: { reply: "", history } };

  // Tool: CRM lookup — RLS-scoped search of this organization's contacts only.
  let context = "";
  if ((agent.allowed_tools as string[]).includes("crm_lookup")) {
    const filter = contactSearchFilter(message.data);
    if (filter) {
      const { data: hits } = await supabase
        .from("contacts")
        .select("first_name, last_name, company_name, status, source, created_at")
        .eq("organization_id", ctx.org.id)
        .or(filter)
        .limit(5);
      if (hits?.length) {
        context =
          "\n\nRelevant CRM records:\n" +
          hits
            .map((h) => dataBlock({ name: `${h.first_name} ${h.last_name ?? ""}`, company: h.company_name, status: h.status, source: h.source, created_at: h.created_at }))
            .join("\n");
      }
    }
  }

  const agentLocale = (isLocale(agent.language) ? agent.language : locale) as Locale;
  const system = baseSystem(
    agentLocale,
    `You are "${neutralise(agent.name, 80)}", an AI agent configured by the business. Business instructions:\n${neutralise(agent.instructions, 8000)}`,
  );
  const messages = [...history, { role: "user" as const, content: message.data + context }];
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "agent_chat",
    agentId: agent.id,
    provider: agent.provider as "openai" | "anthropic" | "gemini",
    model: agent.model,
    system,
    messages,
    temperature: Number(agent.temperature),
    maxTokens: 700,
  });
  if (!out.ok) return { error: out.error, data: { reply: "", history } };
  const full = [
    ...history,
    { role: "user" as const, content: message.data },
    { role: "assistant" as const, content: out.text.slice(0, 2000) },
  ].slice(-10);
  return { ok: true, data: { reply: out.text, history: full } };
}

/** Wave 6 — one-click "sales & service" agent that answers customers on every connected channel. */
export async function createQuickAgentAction(input: {
  locale: string;
  provider: "openai" | "anthropic" | "gemini";
  model: string;
  name: string;
  instructions: string;
  greeting: string;
}): Promise<ActionState> {
  const locale: Locale = isLocale(input.locale) ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const provider = (["openai", "anthropic", "gemini"] as const).includes(input.provider) ? input.provider : "gemini";
  const model = /^[A-Za-z0-9._:-]{2,80}$/.test(input.model) ? input.model : "gemini-3.8-flash";
  const supabase = await createClient();
  const { error } = await supabase.from("ai_agents").insert({
    organization_id: ctx.org.id,
    created_by: ctx.userId,
    name: input.name.trim().slice(0, 80) || "AI",
    instructions: input.instructions.slice(0, 8000),
    greeting: input.greeting.slice(0, 500),
    provider,
    model,
    temperature: 0.4,
    language: locale,
    enabled: true,
    allowed_tools: ["crm_lookup", "draft_message", "site_builder", "image_gen"],
    autopilot_channels: ["web", "whatsapp", "whatsapp_qr", "telegram", "telegram_user", "email"],
    lead_goal: "lead",
    followup_hours: 3,
  });
  if (error) return { error: limitErrorKey(error.message) ?? dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents`);
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "ai.quickCreated" };
}

/** Wave 7 — business profile, goal and follow-up delay from the agent form. */
const PROFILE_KEYS = ["business", "services", "hours", "location", "phone", "website", "faq"] as const;
function salesFields(fd: FormData) {
  const profile: Record<string, string> = {};
  for (const k of PROFILE_KEYS) {
    const v = String(fd.get(`profile_${k}`) ?? "").trim().slice(0, k === "services" || k === "faq" || k === "business" ? 3000 : 300);
    if (v) profile[k] = v;
  }
  const tone = String(fd.get("profile_tone") ?? "");
  if (["friendly", "professional", "luxury", "casual"].includes(tone)) profile.tone = tone;
  const goal = String(fd.get("leadGoal") ?? "lead");
  const hours = Number(fd.get("followupHours") ?? 0);
  return {
    profile,
    lead_goal: ["lead", "booking", "sale", "support"].includes(goal) ? goal : "lead",
    followup_hours: Number.isFinite(hours) ? Math.max(0, Math.min(168, Math.round(hours))) : 0,
  };
}

/* ------------------------------------------ wave 8: conversation setup (script, knowledge, media) ---- */

/** gallery images: any https URL, or this project's own Storage (local / self-hosted Supabase over http) */
function isMediaUrl(u: string) {
  if (/^https:\/\/\S{8,1000}$/.test(u)) return true;
  const own = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return Boolean(own) && u.startsWith(`${own}/storage/v1/object/public/`) && !/\s/.test(u);
}

const setupSchema = z.object({
  id: uuidSchema,
  flow: z.array(z.string().trim().min(1).max(300)).max(15),
  fields: z.array(z.string().trim().min(1).max(120)).max(15),
  pricing: z.string().trim().max(3000),
  links: z.array(z.string().trim().min(3).max(400)).max(20),
  menu: z.array(z.string().trim().min(1).max(30)).max(8),
  media: z
    .array(z.object({ title: z.string().trim().min(1).max(80), url: z.string().trim().max(1000).refine(isMediaUrl), caption: z.string().trim().max(300).optional().default("") }))
    .max(20),
  // wave 12: opening hours, owner take-over, industry
  schedule: z
    .object({
      enabled: z.boolean(),
      tz: z.string().trim().max(60).optional(),
      days: z.partialRecord(z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]), z.array(z.object({ open: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/), close: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/) })).max(2)).optional(),
      closed_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional(),
      after_hours: z.enum(["book_next", "closed_message", "answer_normally"]).optional(),
      closed_note: z.string().trim().max(300).optional(),
    })
    .nullable()
    .optional(),
  resume_after_minutes: z.number().int().min(0).max(1440).optional(),
  industry: z.string().trim().max(40).optional(),
});

/** Saves the agent's conversation script, required details, pricing policy, links, menu and gallery. */
export async function saveAgentSetupAction(input: {
  locale: string;
  id: string;
  flow: string[];
  fields: string[];
  pricing: string;
  links: string[];
  menu: string[];
  media: { title: string; url: string; caption?: string }[];
  schedule?: import("@/lib/ai/schedule").BusinessSchedule | null;
  resume_after_minutes?: number;
  industry?: string;
}): Promise<ActionState> {
  const locale: Locale = isLocale(input.locale) ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { error: "validation.required" };
  const supabase = await createClient();
  const { data: agent } = await supabase.from("ai_agents").select("profile").eq("id", parsed.data.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!agent) return { error: "errors.notFound" };
  const profile = {
    ...((agent.profile as Record<string, unknown> | null) ?? {}),
    flow: parsed.data.flow,
    fields: parsed.data.fields,
    pricing: parsed.data.pricing,
    links: parsed.data.links,
    menu: parsed.data.menu,
    media: parsed.data.media,
    ...(parsed.data.schedule !== undefined ? { schedule: parsed.data.schedule ? (parsed.data.schedule.enabled ? (await import("@/lib/ai/schedule")).normalizeSchedule(parsed.data.schedule) : { ...parsed.data.schedule, enabled: false }) : null } : {}),
    ...(parsed.data.resume_after_minutes !== undefined ? { resume_after_minutes: parsed.data.resume_after_minutes } : {}),
    ...(parsed.data.industry !== undefined ? { industry: parsed.data.industry } : {}),
  };
  const { error } = await supabase.from("ai_agents").update({ profile }).eq("id", parsed.data.id).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents`);
  revalidatePath(`/${locale}/ai-agents/${parsed.data.id}/setup`);
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { configureTelegramBot } = await import("@/lib/channels/telegram-setup");
      await configureTelegramBot(ctx.org.id);
    } catch {
      /* cosmetic */
    }
  }
  return { ok: true, message: "ai.saved" };
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Uploads an example / portfolio image for the agent (public URL the agent can send to customers). */
export async function uploadAgentMediaAction(fd: FormData): Promise<ActionState<{ url: string }>> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(fd.get("id"));
  const file = fd.get("file");
  if (!id.success || !(file instanceof File)) return { error: "validation.required" };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { error: "ai.setup.badImage" };
  if (file.size > 5 * 1024 * 1024) return { error: "ai.setup.tooBig" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "inbox.serverKeyMissing" };
  const supabase = await createClient();
  const { data: agent } = await supabase.from("ai_agents").select("id").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!agent) return { error: "errors.notFound" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const path = `${ctx.org.id}/agents/${id.data}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from("site-assets").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { error: "ai.setup.uploadFailed" };
  const { data } = admin.storage.from("site-assets").getPublicUrl(path);
  return { ok: true, data: { url: data.publicUrl } };
}
