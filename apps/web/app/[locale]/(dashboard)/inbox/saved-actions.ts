"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { normalizeShortcut, STARTER_REPLIES, type SavedReply } from "@/lib/inbox/saved-replies-core";

/** Wave 24 — saved replies: list, add, delete, and count a use. RLS decides who may write. */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");
const schema = z.object({
  title: z.string().trim().min(1, { message: "validation.required" }).max(80, { message: "validation.tooLong" }),
  body: z.string().trim().min(1, { message: "validation.required" }).max(4000, { message: "validation.tooLong" }),
  shortcut: z.string().trim().max(25).optional(),
});

export async function listSavedRepliesAction(input: { locale: string }): Promise<ActionState<SavedReply[]>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("inbox.read")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("saved_replies").select("id, title, body, shortcut, use_count").eq("organization_id", ctx.org.id).order("use_count", { ascending: false }).limit(100);
  if (error) return { ok: true, data: [] }; // before the migration ran: no saved replies yet
  return { ok: true, data: (data ?? []) as SavedReply[] };
}

export async function createSavedReplyAction(input: { locale: string; title: string; body: string; shortcut?: string }): Promise<ActionState<SavedReply>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const p = schema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "validation.required" };
  const shortcut = p.data.shortcut ? normalizeShortcut(p.data.shortcut) : null;
  if (p.data.shortcut && !shortcut) return { error: "inbox.saved.badShortcut" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_replies")
    .insert({ organization_id: ctx.org.id, title: p.data.title, body: p.data.body, shortcut, created_by: ctx.userId })
    .select("id, title, body, shortcut, use_count")
    .single();
  if (error) return { error: error.code === "23505" ? "inbox.saved.shortcutTaken" : dbErrorKey(error) };
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "inbox.saved.added", data: data as SavedReply };
}

export async function deleteSavedReplyAction(input: { locale: string; id: string }): Promise<ActionState> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.id);
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("saved_replies").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  return error ? { error: dbErrorKey(error) } : { ok: true, message: "common.deleted" };
}

export async function countSavedReplyUseAction(input: { id: string }): Promise<void> {
  const id = uuidSchema.safeParse(input.id);
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.rpc("use_saved_reply", { p_id: id.data });
}

/** One click: the starter answers for a business that has none yet. */
export async function addStarterRepliesAction(input: { locale: string }): Promise<ActionState<SavedReply[]>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { count } = await supabase.from("saved_replies").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id);
  if ((count ?? 0) > 0) return listSavedRepliesAction({ locale });
  const { data, error } = await supabase
    .from("saved_replies")
    .insert(STARTER_REPLIES.map((r) => ({ ...r, organization_id: ctx.org.id, created_by: ctx.userId })))
    .select("id, title, body, shortcut, use_count");
  if (error) return { error: dbErrorKey(error) };
  return { ok: true, message: "inbox.saved.added", data: (data ?? []) as SavedReply[] };
}
