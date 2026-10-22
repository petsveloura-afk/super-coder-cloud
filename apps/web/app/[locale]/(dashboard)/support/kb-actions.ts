"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, pick, str } from "@/lib/form";

/** Wave 16 — knowledge base (help-center articles the AI agent answers from). */
const articleSchema = z.object({
  title: z.string().trim().min(2, { message: "validation.required" }).max(200, { message: "validation.tooLong" }),
  body: z.string().trim().min(1, { message: "validation.required" }).max(30000, { message: "validation.tooLong" }),
  category: z.string().trim().max(80).optional().default(""),
});

export async function saveArticleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["title", "body", "category"]);
  if (!ctx.can("tickets.write")) return { error: "errors.forbidden", values };
  const p = articleSchema.safeParse(values);
  if (!p.success) return { fieldErrors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])), values };
  const row = { title: p.data.title, body: p.data.body, category: p.data.category || null, published: fd.get("published") === "on" };
  const supabase = await createClient();
  const id = str(fd, "id");
  const { error } = id
    ? uuidSchema.safeParse(id).success
      ? await supabase.from("kb_articles").update(row).eq("id", id).eq("organization_id", ctx.org.id)
      : { error: { code: "PGRST116", message: "bad id" } }
    : await supabase.from("kb_articles").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId });
  if (error) return { error: dbErrorKey(error), values };
  revalidatePath(`/${locale}/support/kb`);
  return { ok: true, message: "kb.saved" };
}

export async function deleteArticleAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("tickets.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("kb_articles").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/support/kb`);
  return { ok: true, message: "kb.deleted" };
}
