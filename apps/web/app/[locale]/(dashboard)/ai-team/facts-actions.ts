"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { FACT_KINDS } from "@/lib/team/business-facts-core";

/**
 * Upgrade 7 / stage B — the owner's actions on business facts. Only the owner side (ai.manage) can state a fact in its own
 * name (source "owner", confirmed) or decide a proposal. Everything is validated again here and scoped to the business.
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

const errKey = (code: string): string => (code === "migration_not_applied" ? "aiTeam.facts.err.migration" : code === "not_found" || code === "not_proposed" ? "errors.notFound" : code === "write_failed" ? "common.error" : "validation.invalid");

async function audit(orgId: string, userId: string, summary: string, details: Record<string, unknown>) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await createAdminClient().from("team_activity").insert({ organization_id: orgId, actor_user: userId, phase: "system", summary: summary.slice(0, 1000), details }).then(
    () => undefined,
    () => undefined,
  );
}

export async function saveFactAction(input: { locale: string; label: string; value: string; kind: string; unit?: string; validTo?: string }): Promise<ActionState<{ line: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ label: z.string().trim().min(2).max(120), value: z.string().trim().min(1).max(600), kind: z.enum(FACT_KINDS), unit: z.string().trim().max(30).optional(), validTo: z.string().trim().max(40).optional() }).safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { recordFact } = await import("@/lib/team/business-facts");
  const r = await recordFact(g.ctx.org.id, { label: p.data.label, value: p.data.value, kind: p.data.kind, unit: p.data.unit, source: "owner", valid_to: p.data.validTo || undefined }, { decidedBy: g.ctx.userId, lang: locale });
  if (!r.ok) return { error: errKey(r.error) };
  await audit(g.ctx.org.id, g.ctx.userId, `Fact: ${r.line}`, { label: p.data.label, kind: p.data.kind, outcome: r.outcome.kind });
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved", data: { line: r.line } };
}

export async function decideFactAction(input: { locale: string; id: string; accept: boolean }): Promise<ActionState<{ line: string }>> {
  const locale = loc(input.locale);
  const g = await gate(locale);
  if ("error" in g) return { error: g.error };
  const p = z.object({ id: z.string().uuid(), accept: z.boolean() }).safeParse(input);
  if (!p.success) return { error: "validation.invalidId" };
  const { decideFact } = await import("@/lib/team/business-facts");
  const r = await decideFact(g.ctx.org.id, p.data.id, p.data.accept, g.ctx.userId, locale);
  if (!r.ok) return { error: errKey(r.error) };
  await audit(g.ctx.org.id, g.ctx.userId, `Fact: ${r.line}`, { id: p.data.id, accept: p.data.accept });
  revalidatePath(`/${locale}/ai-team`);
  return { ok: true, message: "common.saved", data: { line: r.line } };
}
