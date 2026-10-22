"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { baseSystem, dataBlock, neutralise } from "@/lib/ai/prompt";
import { runAI } from "@/lib/ai/run";
import type { ActionState } from "@/lib/action-state";

/**
 * Wave 16 — AI co-pilot for the team in the inbox (the human writes, the AI helps):
 *  - suggestRepliesAction: 3 ready answers in the business's voice (click → edit → send)
 *  - summarizeConversationAction: summary + details found in the chat → update the contact
 *  - startVideoCallAction: one-click video room link sent to the customer
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

async function conversationData(orgId: string, conversationId: string) {
  const supabase = await createClient();
  const { data: conv } = await supabase.from("conversations").select("id, channel, contact_id, title, summary").eq("id", conversationId).eq("organization_id", orgId).maybeSingle();
  if (!conv) return null;
  const [{ data: msgs }, { data: agents }] = await Promise.all([
    supabase.from("messages").select("direction, body, created_at, ai_agent_id, meta").eq("organization_id", orgId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(30),
    supabase.from("ai_agents").select("name, instructions, profile, autopilot_channels, enabled").eq("organization_id", orgId).eq("enabled", true).limit(10),
  ]);
  const list = (agents ?? []) as { name: string; instructions: string; profile: Record<string, unknown> | null; autopilot_channels: string[] | null }[];
  const agent = list.find((a) => (a.autopilot_channels ?? []).includes(conv.channel as string)) ?? list[0] ?? null;
  const transcript = ((msgs ?? []) as { direction: string; body: string; created_at: string; ai_agent_id: string | null; meta: Record<string, unknown> | null }[])
    .reverse()
    .map((m) => {
      const extra = typeof m.meta?.transcript === "string" ? ` [voice: ${m.meta.transcript}]` : typeof m.meta?.vision === "string" ? ` [image: ${m.meta.vision}]` : "";
      return `${m.direction === "in" ? "customer" : m.ai_agent_id ? "agent(AI)" : "business"}: ${(m.body || "").replace(/\s+/g, " ").slice(0, 500)}${extra}`;
    })
    .join("\n");
  const p = (agent?.profile ?? {}) as Record<string, unknown>;
  const business = dataBlock({
    business: String(p.business ?? ""),
    services_and_prices: String(p.services ?? ""),
    pricing_policy: String(p.pricing ?? ""),
    hours: String(p.hours ?? ""),
    location: String(p.location ?? ""),
    faq: String(p.faq ?? ""),
    instructions: agent?.instructions ?? "",
  });
  return { conv, transcript, business };
}

const repliesSchema = z.object({ replies: z.array(z.string().trim().min(1).max(1200)).min(1).max(5) });

export async function suggestRepliesAction(input: { locale: string; conversationId: string }): Promise<ActionState<{ replies: string[] }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!ctx.can("inbox.reply") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const d = await conversationData(ctx.org.id, id.data);
  if (!d) return { error: "errors.notFound" };
  if (!d.transcript) return { error: "copilot.noMessages" };
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "copilot",
    system: baseSystem(locale, "You help a salesperson/support agent answer a customer. Reply with JSON only."),
    messages: [
      {
        role: "user",
        content: [
          'Write 3 different replies the business could send NOW to the customer\'s last message. Answer with ONE JSON object: {"replies": ["…", "…", "…"]}.',
          "Reply 1: short and direct. Reply 2: warmer, asks one good question to move the sale forward. Reply 3: proposes a concrete next step (meeting / price / link).",
          "Use only facts from the business data; never invent prices, dates or promises. Match the customer's language and the chat style (short, human).",
          d.business,
          `<crm_data>\nconversation (oldest first):\n${neutralise(d.transcript.slice(-7000), 7000)}\n</crm_data>`,
        ].join("\n\n"),
      },
    ],
    temperature: 0.6,
    maxTokens: 700,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const { extractJsonObject } = await import("@/lib/crm/insights-core");
  const parsed = repliesSchema.safeParse(extractJsonObject(out.text));
  if (!parsed.success) return { error: "copilot.badAnswer" };
  return { ok: true, data: { replies: parsed.data.replies.slice(0, 3) } };
}

export interface ExtractedFields {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  company?: string;
  need?: string;
  budget?: string;
}

const summarySchema = z.object({
  summary: z.string().trim().max(1500).default(""),
  next_step: z.string().trim().max(400).optional().default(""),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  fields: z
    .object({
      first_name: z.string().trim().max(80).optional(),
      last_name: z.string().trim().max(80).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().max(254).optional(),
      company: z.string().trim().max(160).optional(),
      need: z.string().trim().max(300).optional(),
      budget: z.string().trim().max(80).optional(),
    })
    .partial()
    .default({}),
});

export async function summarizeConversationAction(input: { locale: string; conversationId: string }): Promise<ActionState<{ summary: string; next_step: string; sentiment: string | null; fields: ExtractedFields; contactId: string | null }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!ctx.can("inbox.read") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const d = await conversationData(ctx.org.id, id.data);
  if (!d) return { error: "errors.notFound" };
  if (!d.transcript) return { error: "copilot.noMessages" };
  const out = await runAI({
    orgId: ctx.org.id,
    feature: "copilot",
    system: baseSystem(locale, "You summarise customer conversations for a CRM. Reply with JSON only."),
    messages: [
      {
        role: "user",
        content: [
          "Summarise this conversation for the team and extract the customer's details. Answer with ONE JSON object:",
          '{"summary": "3-5 short sentences", "next_step": "what the team should do next", "sentiment": "positive|neutral|negative",',
          ' "fields": {"first_name": "", "last_name": "", "phone": "", "email": "", "company": "", "need": "", "budget": ""}}',
          "Only fill fields the customer actually said; leave unknown ones empty. Never guess.",
          `<crm_data>\nconversation (oldest first):\n${neutralise(d.transcript.slice(-8000), 8000)}\n</crm_data>`,
        ].join("\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: 700,
    json: true,
  });
  if (!out.ok) return { error: out.error };
  const { extractJsonObject } = await import("@/lib/crm/insights-core");
  const parsed = summarySchema.safeParse(extractJsonObject(out.text));
  if (!parsed.success) return { error: "copilot.badAnswer" };
  const fields = Object.fromEntries(Object.entries(parsed.data.fields).filter(([, v]) => typeof v === "string" && v.trim())) as ExtractedFields;
  // keep the summary on the conversation (shown in the inbox header)
  const supabase = await createClient();
  if (parsed.data.summary) await supabase.from("conversations").update({ summary: parsed.data.summary.slice(0, 2000) }).eq("id", id.data).eq("organization_id", ctx.org.id);
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, data: { summary: parsed.data.summary, next_step: parsed.data.next_step, sentiment: parsed.data.sentiment ?? null, fields, contactId: (d.conv.contact_id as string | null) ?? null } };
}

/** Writes the chosen extracted details to the contact (empty contact fields only, unless "overwrite"). */
export async function applyExtractedFieldsAction(input: { locale: string; contactId: string; fields: ExtractedFields; summary?: string; overwrite?: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(input.contactId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contacts").select("first_name, last_name, phone, email, company_name").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!c) return { error: "errors.notFound" };
  const f = input.fields ?? {};
  const patch: Record<string, string> = {};
  const take = (col: string, v: string | undefined, current: unknown, valid: (x: string) => boolean = () => true) => {
    if (!v || !valid(v)) return;
    if (input.overwrite || !current || (col === "first_name" && /^\+?\d+$/.test(String(current)))) patch[col] = v;
  };
  const { toE164 } = await import("@/lib/channels/secrets");
  take("first_name", f.first_name?.slice(0, 80), c.first_name);
  take("last_name", f.last_name?.slice(0, 80), c.last_name);
  const phone = toE164(f.phone ?? null);
  take("phone", phone ?? undefined, c.phone);
  take("email", f.email?.toLowerCase(), c.email, (x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  take("company_name", f.company?.slice(0, 160), c.company_name);
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("contacts").update(patch).eq("id", id.data).eq("organization_id", ctx.org.id);
    if (error) return { error: error.code === "23505" ? "copilot.emailTaken" : "errors.generic" };
  }
  const extra = [f.need ? `• ${f.need}` : "", f.budget ? `• ${f.budget}` : ""].filter(Boolean).join("\n");
  if (input.summary || extra) {
    await supabase.from("notes").insert({ organization_id: ctx.org.id, contact_id: id.data, body: [`🤖 ${input.summary ?? ""}`.trim(), extra].filter(Boolean).join("\n").slice(0, 10000), created_by: ctx.userId });
  }
  revalidatePath(`/${locale}/crm/${id.data}`);
  return { ok: true, message: "copilot.applied" };
}

/** Video call: a private meeting room link (Jitsi by default, or VIDEO_MEET_BASE) sent to the customer. */
export async function startVideoCallAction(input: { locale: string; conversationId: string }): Promise<ActionState<{ url: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const { videoRoomUrl } = await import("@/lib/video");
  const url = videoRoomUrl(ctx.org.slug, randomBytes(9).toString("base64url"));
  const text = { he: `🎥 בואו נדבר בווידאו, לוחצים על הקישור (בלי להתקין כלום):\n${url}`, ar: `🎥 لنتحدث بالفيديو — اضغط على الرابط (بدون تثبيت أي شيء):\n${url}`, en: `🎥 Let's talk on video — just open the link (nothing to install):\n${url}` }[locale];
  const { sendToConversation } = await import("@/lib/channels/send-message");
  const r = await sendToConversation(ctx.org.id, id.data, text, ctx.userId);
  revalidatePath(`/${locale}/inbox`);
  if (!r.ok && r.error === "not_found") return { error: "errors.notFound" };
  return { ok: true, message: r.ok ? "video.sent" : "video.createdNotSent", data: { url } };
}
