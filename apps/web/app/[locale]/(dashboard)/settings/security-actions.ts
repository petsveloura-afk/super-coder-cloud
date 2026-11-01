"use server";

import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState } from "@/lib/action-state";

/**
 * Spec I1 / I2 — two-step sign-in (TOTP authenticator app, built into Supabase Auth — free) and session control
 * (sign out every other device). Every change is written to the audit log.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");
const codeSchema = z.string().regex(/^\d{6}$/);

async function audit(action: string, metadata: Record<string, unknown> = {}) {
  try {
    const ctx = await getOrgContext("he");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await createAdminClient().from("audit_logs").insert({ organization_id: ctx.org.id, actor_id: ctx.userId, action, entity_type: "user", entity_id: ctx.userId, metadata });
  } catch {
    /* audit is best effort */
  }
}

export async function mfaStatusAction(): Promise<ActionState<{ factors: { id: string; name: string | null; created_at: string }[]; aal: string | null }>> {
  const supabase = await createClient();
  const [{ data: f }, { data: a }] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
  const factors = (f?.totp ?? []).filter((x) => x.status === "verified").map((x) => ({ id: x.id, name: x.friendly_name ?? null, created_at: x.created_at }));
  return { ok: true, data: { factors, aal: a?.currentLevel ?? null } };
}

export async function mfaEnrollAction(input: { locale: string }): Promise<ActionState<{ factorId: string; qr: string; secret: string }>> {
  loc(input.locale);
  const supabase = await createClient();
  // drop unfinished enrolments first (Supabase allows only a few unverified factors)
  const { data: f } = await supabase.auth.mfa.listFactors();
  for (const x of f?.all ?? []) if (x.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: x.id }).catch(() => undefined);
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Super Coder Cloud ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: "security.enrollFailed" };
  return { ok: true, data: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

export async function mfaVerifyAction(input: { locale: string; factorId: string; code: string }): Promise<ActionState> {
  if (!codeSchema.safeParse(input.code).success || !z.string().uuid().safeParse(input.factorId).success) return { error: "security.badCode" };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: input.factorId, code: input.code });
  if (error) return { error: "security.badCode" };
  await audit("security.mfa_enabled");
  return { ok: true, message: "security.enabled" };
}

export async function mfaDisableAction(input: { locale: string; factorId: string }): Promise<ActionState> {
  if (!z.string().uuid().safeParse(input.factorId).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: input.factorId });
  if (error) return { error: "security.needCode" };
  await audit("security.mfa_disabled");
  return { ok: true, message: "security.disabled" };
}

/** The sign-in second step (the /mfa screen). */
export async function mfaLoginAction(input: { code: string }): Promise<ActionState> {
  if (!codeSchema.safeParse(input.code).success) return { error: "security.badCode" };
  const supabase = await createClient();
  const { data: f } = await supabase.auth.mfa.listFactors();
  const factor = (f?.totp ?? []).find((x) => x.status === "verified");
  if (!factor) return { ok: true };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: input.code });
  if (error) return { error: "security.badCode" };
  return { ok: true };
}

export async function signOutOthersAction(input: { locale: string }): Promise<ActionState> {
  loc(input.locale);
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { error: "errors.generic" };
  await audit("security.signed_out_others");
  return { ok: true, message: "security.othersOut" };
}
