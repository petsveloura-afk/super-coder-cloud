"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

/**
 * Conversation guard — team controls in the inbox: schedule a message (Blueticks-style,
 * optionally canceled when the customer answers first), cancel a planned item,
 * mark the customer as opted out / back in.
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

function errKey(message: string | undefined, code: string | undefined): string {
  if (code === "42501") return "errors.forbidden";
  if (message?.includes("invalid_time")) return "guard.badTime";
  if (message?.includes("invalid_body")) return "validation.required";
  if (message?.includes("too_many")) return "guard.tooMany";
  return "errors.generic";
}

export async function scheduleMessageAction(input: { locale: string; conversationId: string; body: string; runAt: string; cancelOnReply: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  const when = new Date(input.runAt);
  if (Number.isNaN(when.getTime())) return { error: "guard.badTime" };
  const body = String(input.body ?? "").trim().slice(0, 4000);
  if (!body) return { error: "validation.required" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("schedule_conversation_message", { p_conversation: id.data, p_body: body, p_run_at: when.toISOString(), p_cancel_on_reply: Boolean(input.cancelOnReply) });
  if (error) return { error: errKey(error.message, error.code) };
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "guard.scheduled" };
}

export async function cancelScheduleAction(input: { locale: string; id: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_conversation_schedule", { p_id: input.id });
  if (error) return { error: errKey(error.message, error.code) };
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "guard.canceled" };
}

export async function setOptOutAction(input: { locale: string; conversationId: string; optOut: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_conversation_opt_out", { p_conversation: id.data, p_opt_out: Boolean(input.optOut) });
  if (error) return { error: errKey(error.message, error.code) };
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: input.optOut ? "guard.markedOut" : "guard.markedIn" };
}
