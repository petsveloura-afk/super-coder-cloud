"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/**
 * Round 13 — one click for tasks held by the daily credit cap: raise the cap (× 1.5, at least today's use + room) and put the
 * held tasks back to work NOW instead of waiting for the 24-hour window. Only people who manage the team; audited. The cap
 * can still be set to any number in the team settings, exactly as before.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

export async function raiseDayCapAction(input: { locale: string }): Promise<ActionState<{ cap: number; resumed: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const a = createAdminClient();
  const runner = await import("@/lib/team/runner");
  if (!(await runner.teamFlagOn(ctx.org.id))) return { error: "aiTeam.err.flagOff" };
  const settings = await runner.loadSettings(ctx.org.id);
  const used = await runner.dayCredits(ctx.org.id).catch(() => 0);
  const { suggestedCap } = await import("@/lib/team/cap-relief-core");
  const cap = suggestedCap(settings.daily_credit_cap, used);
  const { error } = await a.from("team_settings").upsert({ organization_id: ctx.org.id, daily_credit_cap: cap, updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) return { error: "common.error" };
  const resumed = await runner.resumeHeldTasks(ctx.org.id).catch(() => 0);
  await a
    .from("team_activity")
    .insert({ organization_id: ctx.org.id, actor_user: ctx.userId, phase: "system", summary: `Daily credit cap raised by a manager: ${settings.daily_credit_cap} → ${cap}; ${resumed} held task(s) back to work.`, details: { from: settings.daily_credit_cap, to: cap, resumed } })
    .then(
      () => undefined,
      () => undefined,
    );
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "aiTeam.cap.raised", messageParams: { cap, n: resumed }, data: { cap, resumed } };
}
