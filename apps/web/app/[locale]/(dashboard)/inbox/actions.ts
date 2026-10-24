"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { sendToContact, sendToConversation } from "@/lib/channels/send-message";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");
const textSchema = z.string().trim().min(1, { message: "validation.required" }).max(4000, { message: "validation.tooLong" });

function sendError(error: string | undefined) {
  if (!error) return "inbox.sendFailed";
  if (error.includes("channel_not_connected")) return "inbox.channelNotConnected";
  if (error.includes("encryption_key_missing")) return "integrations.channels.encryptionMissing";
  return "inbox.sendFailed";
}

export async function replyAction(input: { locale: string; conversationId: string; text: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.conversationId);
  const text = textSchema.safeParse(input.text);
  if (!id.success) return { error: "validation.invalidId" };
  if (!text.success) return { error: text.error.issues[0]?.message ?? "validation.required" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "inbox.serverKeyMissing" };
  // authorization: the conversation must be visible to this user through RLS
  const supabase = await createClient();
  const { data: conv } = await supabase.from("conversations").select("id").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!conv) return { error: "errors.notFound" };
  const r = await sendToConversation(ctx.org.id, id.data, text.data, ctx.userId);
  await supabase.from("conversations").update({ unread_count: 0 }).eq("id", id.data);
  // first responder takes ownership of an unassigned conversation
  await supabase.from("conversations").update({ assignee_id: ctx.userId }).eq("id", id.data).is("assignee_id", null);
  // a person answered → the AI agent steps back in this conversation (can be switched back from the inbox)
  if (r.ok) await supabase.from("conversations").update({ ai_mode: "human" }).eq("id", id.data).eq("ai_mode", "auto");
  revalidatePath(`/${locale}/inbox`);
  return r.ok ? { ok: true, message: "inbox.sent" } : { error: sendError(r.error), messageParams: { detail: r.error ?? "" } };
}

export async function startConversationAction(input: { locale: string; contactId: string; channel: string; text: string }): Promise<ActionState<{ conversationId?: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.contactId);
  const text = textSchema.safeParse(input.text);
  if (!id.success || !["whatsapp", "telegram", "sms"].includes(input.channel)) return { error: "validation.invalidId" };
  if (!text.success) return { error: "validation.required" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "inbox.serverKeyMissing" };
  const supabase = await createClient();
  const { data: contact } = await supabase.from("contacts").select("id").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!contact) return { error: "errors.notFound" };
  const r = await sendToContact(input.channel as "whatsapp" | "telegram" | "sms", ctx.org.id, id.data, text.data);
  revalidatePath(`/${locale}/inbox`);
  revalidatePath(`/${locale}/crm/${id.data}`);
  if (!r.ok) {
    if (r.error === "contact_has_no_phone") return { error: "inbox.noPhone" };
    if (r.error === "contact_has_no_telegram_chat") return { error: "inbox.noTelegram" };
    return { error: sendError(r.error), messageParams: { detail: r.error ?? "" } };
  }
  return { ok: true, message: "inbox.sent" };
}

export async function markReadAction(input: { locale: string; conversationId: string }): Promise<ActionState> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("inbox.reply")) return { ok: true };
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  await supabase.from("conversations").update({ unread_count: 0 }).eq("id", id.data).eq("organization_id", ctx.org.id).gt("unread_count", 0);
  return { ok: true };
}

export async function updateConversationAction(input: { locale: string; conversationId: string; status?: "open" | "closed"; assigneeId?: string | null }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  const patch: Record<string, unknown> = {};
  if (input.status) patch.status = input.status;
  if (input.assigneeId !== undefined) {
    if (input.assigneeId && !uuidSchema.safeParse(input.assigneeId).success) return { error: "validation.invalidId" };
    patch.assignee_id = input.assigneeId || null;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("conversations").update(patch).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: input.status === "closed" ? "inbox.closed" : input.status === "open" ? "inbox.reopened" : "inbox.assigned" };
}

/** Wave 6 — switch a conversation between the AI agent (auto) and the team (human). */
export async function setAiModeAction(input: { locale: string; conversationId: string; mode: "auto" | "human" }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success || !["auto", "human"].includes(input.mode)) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ ai_mode: input.mode, ...(input.mode === "auto" ? { handoff_at: null } : {}) })
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  if (input.mode === "auto") {
    // wave 21: back to the agent → the take-over clock and note are cleared, and a customer message
    // that is still waiting gets its answer right away (no need to wait for the customer to write again)
    await supabase.from("conversations").update({ owner_takeover_at: null, ai_note: null, ai_note_at: null }).eq("id", id.data).eq("organization_id", ctx.org.id).then(() => undefined, () => undefined);
    const { data: last } = await supabase.from("messages").select("id, direction").eq("conversation_id", id.data).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.direction === "in" && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { scheduleAutopilot } = await import("@/lib/ai/autopilot");
      await scheduleAutopilot({ conversationId: id.data, messageId: last.id as string });
    }
  }
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: input.mode === "auto" ? "inbox.aiResumed" : "inbox.aiPaused" };
}
