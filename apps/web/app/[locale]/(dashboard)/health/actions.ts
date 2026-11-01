"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import { type ActionState } from "@/lib/action-state";

/** Mission Control actions: retry / cancel a failed delivery, send a test email, survey settings, resolve an error. */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

async function admin() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function audit(orgId: string, userId: string, action: string, entityId: string | null, metadata: Record<string, unknown>) {
  await (await admin()).from("audit_logs").insert({ organization_id: orgId, actor_id: userId, action, entity_type: "ops", entity_id: entityId, metadata }).then(() => undefined, () => undefined);
}

export async function retryDeliveryAction(input: { locale: string; id: number; cancel?: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  if (!Number.isInteger(input.id) || input.id <= 0) return { error: "validation.invalidId" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const patch = input.cancel ? { status: "canceled", finished_at: new Date().toISOString() } : { status: "queued", attempts: 0, run_after: new Date().toISOString(), locked_at: null, last_error: null };
  const { error } = await (await admin()).from("jobs").update(patch).eq("id", input.id).eq("organization_id", ctx.org.id).in("status", ["failed", "dead"]);
  if (error) return { error: "errors.generic" };
  await audit(ctx.org.id, ctx.userId, input.cancel ? "delivery.canceled" : "delivery.retried", null, { job: input.id });
  if (!input.cancel) {
    const { kickJobs } = await import("@/lib/jobs/kick").catch(() => ({ kickJobs: () => undefined }));
    kickJobs();
  }
  revalidatePath(`/${locale}/health`);
  return { ok: true, message: input.cancel ? "ops.canceled" : "ops.retried" };
}

export async function retryAllDeliveriesAction(input: { locale: string }): Promise<ActionState<{ count: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { data, error } = await (await admin())
    .from("jobs")
    .update({ status: "queued", attempts: 0, run_after: new Date().toISOString(), locked_at: null, last_error: null })
    .eq("organization_id", ctx.org.id)
    .in("status", ["failed", "dead"])
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .select("id");
  if (error) return { error: "errors.generic" };
  await audit(ctx.org.id, ctx.userId, "delivery.retried_all", null, { count: data?.length ?? 0 });
  const { kickJobs } = await import("@/lib/jobs/kick").catch(() => ({ kickJobs: () => undefined }));
  kickJobs();
  revalidatePath(`/${locale}/health`);
  return { ok: true, data: { count: data?.length ?? 0 }, message: "ops.retriedAll", messageParams: { count: data?.length ?? 0 } };
}

export async function testEmailAction(input: { locale: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const a = await admin();
  const { data: allowed } = await a.rpc("public_rate_limit", { p_bucket: `ops-test-email:${ctx.org.id}`, p_limit: 5, p_window_seconds: 600 });
  if (allowed === false) return { error: "errors.rateLimited" };
  const { data: u } = await a.auth.admin.getUserById(ctx.userId);
  const to = u?.user?.email;
  if (!to) return { error: "errors.generic" };
  const { sendEmail } = await import("@/lib/email/send");
  const { renderEmailHtml } = await import("@/lib/channels/email-core");
  // a real, well-formed message (greeting, sentences, signature, no emoji / link-only body) — short emoji-only test
  // mails are what spam filters flag first
  const T = {
    he: { subject: `בדיקת שליחת מיילים — ${ctx.org.name}`, body: `שלום,\n\nזו הודעת בדיקה ממערכת Super Coder Cloud של ${ctx.org.name}.\nאם ההודעה הגיעה לתיבת הדואר הנכנס — המיילים של העסק נשלחים כמו שצריך.\nאם היא הגיעה לספאם, סמנו אותה "לא ספאם" כדי שהבאות יגיעו לתיבה.\n\nבברכה,\n${ctx.org.name}` },
    en: { subject: `Email delivery check — ${ctx.org.name}`, body: `Hello,\n\nThis is a test message from the Super Coder Cloud system of ${ctx.org.name}.\nIf it reached your inbox, your business emails are being delivered correctly.\nIf it landed in spam, mark it "Not spam" so the next ones reach the inbox.\n\nBest regards,\n${ctx.org.name}` },
    ar: { subject: `فحص إرسال البريد — ${ctx.org.name}`, body: `مرحبًا،\n\nهذه رسالة اختبار من نظام Super Coder Cloud الخاص بـ ${ctx.org.name}.\nإذا وصلت إلى البريد الوارد فإن رسائل عملك تُرسل بشكل صحيح.\nإذا وصلت إلى الرسائل المزعجة، علّمها "ليست مزعجة" لتصل الرسائل التالية إلى الوارد.\n\nمع التحية،\n${ctx.org.name}` },
  }[locale];
  const r = await sendEmail({ to, subject: T.subject, html: renderEmailHtml(T.body, { brand: ctx.org.name }), text: T.body, orgId: ctx.org.id });
  return r.sent ? { ok: true, message: "ops.testSent", messageParams: { to } } : { error: "ops.testFailed" };
}

const surveySchema = z.object({ enabled: z.boolean(), kind: z.enum(["nps", "csat", "ces"]), delay_minutes: z.number().int().min(0).max(10080), cooldown_days: z.number().int().min(1).max(365), question: z.string().trim().max(300) });

export async function saveSurveySettingsAction(input: { locale: string } & z.infer<typeof surveySchema>): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const p = surveySchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { error } = await supabase.from("survey_settings").upsert({ organization_id: ctx.org.id, ...p.data, question: p.data.question || null, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) return { error: "errors.generic" };
  await audit(ctx.org.id, ctx.userId, "surveys.settings", null, { enabled: p.data.enabled, kind: p.data.kind });
  revalidatePath(`/${locale}/health`);
  return { ok: true, message: "common.saved" };
}

export async function resolveErrorAction(input: { locale: string; id: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  if (!z.string().uuid().safeParse(input.id).success) return { error: "validation.invalidId" };
  await (await admin()).from("app_errors").update({ resolved: true }).eq("id", input.id);
  revalidatePath(`/${locale}/health`);
  return { ok: true, message: "ops.resolved" };
}
