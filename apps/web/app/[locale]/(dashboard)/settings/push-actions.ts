"use server";

import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/** Wave 17 — this browser / phone receives the member's notifications (Web Push). */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";
const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
  auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/),
});

export async function subscribePushAction(input: { locale: string; sub: unknown; userAgent?: string }): Promise<ActionState> {
  const ctx = await getOrgContext(loc(input.locale));
  const p = subSchema.safeParse(input.sub);
  if (!p.success) return { error: "push.invalid" };
  const { isPushEndpoint, vapidReady } = await import("@/lib/push/webpush-core");
  if (!vapidReady()) return { error: "push.notConfigured" };
  if (!isPushEndpoint(p.data.endpoint)) return { error: "push.invalid" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { count } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
  if ((count ?? 0) >= 10) await admin.from("push_subscriptions").delete().eq("user_id", ctx.userId).order("created_at", { ascending: true }).limit(1);
  const { error } = await admin
    .from("push_subscriptions")
    .upsert({ organization_id: ctx.org.id, user_id: ctx.userId, endpoint: p.data.endpoint, p256dh: p.data.p256dh, auth: p.data.auth, user_agent: (input.userAgent ?? "").slice(0, 300) || null }, { onConflict: "endpoint" });
  if (error) return { error: "errors.generic" };
  return { ok: true, message: "push.enabled" };
}

export async function unsubscribePushAction(input: { locale: string; endpoint: string }): Promise<ActionState> {
  const ctx = await getOrgContext(loc(input.locale));
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await createAdminClient().from("push_subscriptions").delete().eq("user_id", ctx.userId).eq("endpoint", String(input.endpoint ?? "").slice(0, 1000));
  return { ok: true, message: "push.disabled" };
}

/** A test notification to this member's devices. */
export async function testPushAction(input: { locale: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `push-test:${ctx.userId}`, p_limit: 5, p_window_seconds: 600 });
  if (allowed === false) return { error: "errors.rateLimited" };
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", ctx.userId).limit(10);
  if (!subs?.length) return { error: "push.noDevices" };
  const { pushPayload } = await import("@/lib/push/webpush-core");
  const { sendPush } = await import("@/lib/push/send");
  const { getT } = await import("@/lib/i18n/server");
  const { t } = await getT(locale);
  const payload = pushPayload({ title: ctx.org.name as string, body: t("push.testBody"), url: `/${locale}/settings`, locale });
  let ok = 0;
  for (const s of subs as { endpoint: string; p256dh: string; auth: string }[]) if ((await sendPush(s, payload)).ok) ok++;
  return ok ? { ok: true, message: "push.testSent" } : { error: "push.testFailed" };
}
