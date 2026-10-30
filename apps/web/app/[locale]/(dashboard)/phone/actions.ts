"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/** Wave 57 — the phone agent in one place: get a number, wire an own number, transfer number, test call. */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

async function voicePlan(orgId: string) {
  const { orgHasFeature } = await import("@/lib/billing/features");
  return orgHasFeature(orgId, "voice_ai");
}

/** One click: a phone number for the AI agent from the platform (the business never touches Twilio). */
export async function getPhoneNumberAction(input: { locale: string }): Promise<ActionState<{ phone: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (ctx.org.is_demo) return { error: "trial.demo" };
  if (!(await voicePlan(ctx.org.id))) return { error: "plans.locked.voice_ai.title" };
  const { provisionForOrg } = await import("@/lib/voice/platform-phone");
  const r = await provisionForOrg(ctx.org.id, ctx.org.name);
  revalidatePath(`/${locale}/phone`);
  if (!r.ok) return { error: r.error };
  return { ok: true, message: "phone.gotNumber", data: { phone: r.phone } };
}

export async function releasePhoneNumberAction(input: { locale: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const { releaseForOrg } = await import("@/lib/voice/platform-phone");
  const ok = await releaseForOrg(ctx.org.id);
  revalidatePath(`/${locale}/phone`);
  return ok ? { ok: true, message: "phone.released" } : { error: "errors.generic" };
}

/** The business's own Twilio number: point it at the platform automatically (what used to be pasted by hand). */
export async function wireOwnNumberAction(input: { locale: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const { loadAccount } = await import("@/lib/channels/accounts");
  const acc = await loadAccount(ctx.org.id, "sms");
  if (!acc?.config.account_sid || !acc.secrets.auth_token || !acc.config.from_number) return { error: "voice.notConnected" };
  const { autoWireOwnNumber } = await import("@/lib/voice/platform-phone");
  const ok = await autoWireOwnNumber({ sid: acc.config.account_sid, token: acc.secrets.auth_token, phone: acc.config.from_number, webhookToken: acc.webhook_token });
  revalidatePath(`/${locale}/phone`);
  return ok ? { ok: true, message: "phone.wired" } : { error: "phone.wireFailed" };
}

/** Who gets the call when a customer asks for a person (and urgent calls). */
export async function setTransferNumberAction(input: { locale: string; phone: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const { toE164 } = await import("@/lib/channels/secrets");
  const target = toE164(input.phone);
  if (!target) return { error: "notify.badPhone" };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("notify_recipients").select("id").eq("organization_id", ctx.org.id).eq("kind", "call").is("user_id", null).order("created_at").limit(1).maybeSingle();
  const { error } = existing
    ? await supabase.from("notify_recipients").update({ target, enabled: true }).eq("id", existing.id).eq("organization_id", ctx.org.id)
    : await supabase.from("notify_recipients").insert({ organization_id: ctx.org.id, kind: "call", target, label: "phone-transfer", events: ["escalation", "handoff"], verified_at: new Date().toISOString(), created_by: ctx.userId });
  if (error) return { error: error.message.includes("plan_limit:notify_recipients") ? "notify.tooMany" : dbErrorKey(error) };
  revalidatePath(`/${locale}/phone`);
  return { ok: true, message: "phone.transferSaved" };
}

/** "Call me now": hear the agent on your own phone before customers do. */
export async function testCallAction(input: { locale: string; phone: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: allowed } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `phone-test:${ctx.org.id}`, p_limit: 3, p_window_seconds: 600 });
  if (allowed === false) return { error: "phone.tooMany" };
  const { testCallTo } = await import("@/lib/voice/test-call");
  const r = await testCallTo(ctx.org.id, input.phone);
  revalidatePath(`/${locale}/phone`);
  return r.ok ? { ok: true, message: "phone.calling" } : { error: r.error ?? "voice.callFailed" };
}
