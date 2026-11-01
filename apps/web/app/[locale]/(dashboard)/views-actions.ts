"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState } from "@/lib/action-state";
import { cleanViewFilters, VIEW_ENTITIES } from "@/lib/views-core";

/** Spec B4 — saved views: the current filters of a list, saved personally or shared with the team. */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");
const path: Record<string, string> = { contacts: "crm", companies: "companies", deals: "pipelines", tasks: "tasks", conversations: "inbox" };

const saveSchema = z.object({ entity: z.enum(VIEW_ENTITIES), name: z.string().trim().min(1).max(60), filters: z.record(z.string(), z.string()), shared: z.boolean() });

export async function saveViewAction(input: { locale: string } & z.infer<typeof saveSchema>): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const p = saveSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const supabase = await createClient();
  const { count } = await supabase.from("saved_views").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).eq("entity", p.data.entity);
  if ((count ?? 0) >= 20) return { error: "views.tooMany" };
  const { error } = await supabase.from("saved_views").insert({ organization_id: ctx.org.id, user_id: ctx.userId, entity: p.data.entity, name: p.data.name, filters: cleanViewFilters(p.data.filters), shared: p.data.shared });
  if (error) return { error: "errors.generic" };
  revalidatePath(`/${locale}/${path[p.data.entity]}`);
  return { ok: true, message: "views.saved" };
}

export async function deleteViewAction(input: { locale: string; id: string; entity: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("saved_views").delete().eq("id", input.id).eq("organization_id", ctx.org.id).eq("user_id", ctx.userId);
  if (error) return { error: "errors.generic" };
  revalidatePath(`/${locale}/${path[input.entity] ?? "crm"}`);
  return { ok: true, message: "views.deleted" };
}
