"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/**
 * Upgrade 8 / stage B — the owner's actions on the organisation layer. Only the owner side (ai.manage); validated again and scoped to the
 * business; every write goes through the data layer, which refuses a member of another business. B5: the job description of one employee
 * (wording only — it grants no tool and loosens no approval rule).
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

async function gate(locale: "he" | "en" | "ar") {
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" as const };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" as const };
  const { teamFlagOn } = await import("@/lib/team/runner");
  if (!(await teamFlagOn(ctx.org.id))) return { error: "aiTeam.err.flagOff" as const };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "ai_team"))) return { error: "plans.locked.ai_team.title" as const };
  return { ctx };
}
const errKey = (code: string) => (code === "migration_not_applied" ? "aiTeam.org8.card.migration" : code === "not_found" ? "errors.notFound" : code === "write_failed" ? "common.error" : "validation.invalid");

const lines = z.array(z.string().trim().max(200)).max(8);

export async function saveJobProfileAction(input: { locale: string; memberId: string; responsibilities: string[]; authority: string[]; forbiddenExtra: string[] }): Promise<ActionState> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ memberId: z.string().uuid(), responsibilities: lines, authority: lines, forbiddenExtra: lines }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { saveProfileOverride } = await import("@/lib/team/org8-profiles-data");
  const r = await saveProfileOverride(g.ctx.org.id, { member_id: p.data.memberId, responsibilities: p.data.responsibilities.filter(Boolean), authority: p.data.authority.filter(Boolean), forbidden_extra: p.data.forbiddenExtra.filter(Boolean) }, g.ctx.userId ?? null);
  if (!r.ok) return { error: errKey(r.error) };
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved" };
}
