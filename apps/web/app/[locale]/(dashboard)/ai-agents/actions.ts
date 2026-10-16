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
    allowed_tools: parsed.data.crmLookup ? ["crm_lookup", "draft_message"] : ["draft_message"],
  };
  const supabase = await createClient();
  const id = uuidSchema.safeParse(fd.get("id"));
  const { error } = id.success
    ? await supabase.from("ai_agents").update(row).eq("id", id.data).eq("organization_id", ctx.org.id)
    : await supabase.from("ai_agents").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId });
  if (error) return { error: limitErrorKey(error.message) ?? dbErrorKey(error), values };
  revalidatePath(`/${locale}/ai-agents`);
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
