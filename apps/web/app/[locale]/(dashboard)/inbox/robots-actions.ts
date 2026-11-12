"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { isChannelPlaceholderTitle, isRobotName, isServiceSender } from "@/lib/inbox/robots-core";

/**
 * Close the automatic conversations (service senders: exchanges, platform alerts, login codes, no-reply mailboxes) in one
 * click. Every id is checked again on the server — only conversations that really are automatic are closed; a customer's
 * conversation is never touched. Closing is reversible (the "closed" tab → reopen); nothing is deleted.
 */
const ids = z.array(z.string().uuid()).min(1).max(200);

export async function closeServiceConversationsAction(input: { locale: string; ids: string[] }): Promise<ActionState<{ closed: number }>> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const parsed = ids.safeParse([...new Set(input.ids ?? [])]);
  if (!parsed.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("conversations").select("id, title, last_message_preview, channel").eq("organization_id", ctx.org.id).eq("status", "open").in("id", parsed.data);
  if (error) return { error: dbErrorKey(error) };
  const robots = ((data ?? []) as { id: string; title: string | null; last_message_preview: string | null; channel?: string | null }[]).filter((c) => (isChannelPlaceholderTitle(c.title, c.channel) ? isServiceSender(null, c.last_message_preview) : isRobotName(c.title) || isServiceSender(c.title, c.last_message_preview))).map((c) => c.id);
  if (!robots.length) return { ok: true, message: "inbox.robots.none", data: { closed: 0 } };
  const { data: done, error: upErr } = await supabase.from("conversations").update({ status: "closed" }).eq("organization_id", ctx.org.id).in("id", robots).select("id");
  if (upErr) return { error: dbErrorKey(upErr) };
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "inbox.robots.closed", messageParams: { n: (done ?? []).length }, data: { closed: (done ?? []).length } };
}
