"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { isSalesState } from "@/lib/ai/sales-state-core";

/** Wave 55 — the team moves a conversation to another sales funnel state (logged, RLS + permission checked in Postgres). */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function setSalesStateAction(input: { locale: string; conversationId: string; state: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.conversationId);
  if (!id.success) return { error: "validation.invalidId" };
  if (!isSalesState(input.state)) return { error: "sales.invalidState" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_sales_state", { p_conv: id.data, p_state: input.state, p_reason: "manual" });
  if (error) return { error: dbErrorKey(error) };
  const r = (data ?? {}) as { ok?: boolean; error?: string };
  if (!r.ok) return { error: r.error ?? "errors.generic" };
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "sales.saved" };
}
