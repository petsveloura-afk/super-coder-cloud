"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { tightenPlan } from "@/lib/team/owner-control-core";

/**
 * Wave 70 — the owner takes control back. One action only, and it only ever goes towards MORE caution: employees that
 * work on "auto" are moved to "ask me first" and their list of allowed customer / money actions is cleared. Employees on
 * "suggest" or "approve" are never touched, so this can never give anyone more freedom. Needs ai.manage, is scoped to
 * the business, and is written to the append-only team log.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");
const input = z.object({ locale: z.string(), memberId: z.string().uuid().nullish() });

export async function tightenAutonomyAction(raw: { locale: string; memberId?: string | null }): Promise<ActionState<{ changed: number }>> {
  const p = input.safeParse(raw);
  if (!p.success) return { error: "validation.invalid" };
  const locale = loc(p.data.locale);
  try {
    const ctx = await getOrgContext(locale);
    if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" };
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const a = createAdminClient();
    const { data, error } = await a.from("team_members").select("id, autonomy").eq("organization_id", ctx.org.id).limit(200);
    if (error) return { error: "common.error" };
    const ids = tightenPlan((data ?? []) as { id: string; autonomy: string }[], p.data.memberId ?? null);
    if (!ids.length) return { ok: true, message: "aiTeam.control.nothingToTighten", data: { changed: 0 } };
    const { error: upErr } = await a
      .from("team_members")
      .update({ autonomy: "approve", auto_actions: [], updated_at: new Date().toISOString() })
      .eq("organization_id", ctx.org.id)
      .eq("autonomy", "auto")
      .in("id", ids);
    if (upErr) return { error: "common.error" };
    await a
      .from("team_activity")
      .insert({ organization_id: ctx.org.id, actor_user: ctx.userId, phase: "system", summary: `Owner moved ${ids.length} employee(s) back to "ask me first"`, details: { tightened: ids } })
      .then(
        () => undefined,
        () => undefined,
      );
    revalidatePath(`/${locale}/ai-team`);
    return { ok: true, message: "aiTeam.control.tightened", data: { changed: ids.length } };
  } catch (e) {
    console.error("[ai-team] tightenAutonomyAction failed", e);
    return { error: "common.error" };
  }
}
