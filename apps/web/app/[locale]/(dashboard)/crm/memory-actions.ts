"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/** Wave 54 — the team can teach the agents a fact about a customer, or remove a wrong one. */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";
const addSchema = z.object({ contactId: uuidSchema, fact: z.string().trim().min(2).max(300) });

export async function addMemoryAction(input: { locale: string; contactId: string; fact: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden" };
  const p = addSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("contact_memories").insert({ organization_id: ctx.org.id, contact_id: p.data.contactId, fact: p.data.fact.replace(/[<>]/g, " "), kind: "fact", source: "team", created_by: ctx.userId });
  if (error) return { error: error.code === "23505" ? "memory.exists" : dbErrorKey(error) };
  revalidatePath(`/${locale}/crm/${p.data.contactId}`);
  return { ok: true, message: "memory.saved" };
}

export async function deleteMemoryAction(input: { locale: string; id: string; contactId: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("contact_memories").delete().eq("id", input.id).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  if (uuidSchema.safeParse(input.contactId).success) revalidatePath(`/${locale}/crm/${input.contactId}`);
  return { ok: true, message: "memory.removed" };
}
