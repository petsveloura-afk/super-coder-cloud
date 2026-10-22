"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

/** Conversation guard — the workspace rules for automated messages (settings.manage). */
export async function saveConversationPolicyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = fd.get("locale") === "en" || fd.get("locale") === "ar" ? String(fd.get("locale")) : "he";
  const ctx = await getOrgContext(locale as "he");
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const num = (k: string) => (fd.get(k) === null || fd.get(k) === "" ? undefined : Number(fd.get(k)));
  const policy = {
    followup_max: num("followup_max"),
    followup_gap_hours: num("followup_gap_hours"),
    min_gap_minutes: num("min_gap_minutes"),
    daily_cap: num("daily_cap"),
    quiet_start: String(fd.get("quiet_start") ?? "") || null,
    quiet_end: String(fd.get("quiet_end") ?? "") || null,
    opt_out_reply: fd.get("opt_out_reply") === "on",
  };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_conversation_policy", { p_org: ctx.org.id, p_policy: policy });
  if (error) return { error: error.code === "42501" ? "errors.forbidden" : "errors.generic" };
  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: "guard.policySaved" };
}
