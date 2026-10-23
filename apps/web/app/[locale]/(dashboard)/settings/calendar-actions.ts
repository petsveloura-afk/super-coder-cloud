"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/** Wave 16 — my calendar connection: options and disconnect (only my own rows). */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function updateCalendarAction(input: { locale: string; id: string; push_events?: boolean; block_busy?: boolean; disconnect?: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const q = admin.from("calendar_connections");
  if (input.disconnect) {
    await admin.from("calendar_busy").delete().eq("connection_id", input.id).eq("user_id", ctx.userId);
    const { error } = await q.delete().eq("id", input.id).eq("user_id", ctx.userId).eq("organization_id", ctx.org.id);
    if (error) return { error: "errors.generic" };
    revalidatePath(`/${locale}/settings`);
    return { ok: true, message: "calendar.disconnected" };
  }
  const patch: Record<string, boolean> = {};
  if (typeof input.push_events === "boolean") patch.push_events = input.push_events;
  if (typeof input.block_busy === "boolean") patch.block_busy = input.block_busy;
  const { error } = await q.update(patch).eq("id", input.id).eq("user_id", ctx.userId).eq("organization_id", ctx.org.id);
  if (error) return { error: "errors.generic" };
  if (patch.block_busy === false) await admin.from("calendar_busy").delete().eq("connection_id", input.id);
  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: "common.saved" };
}
