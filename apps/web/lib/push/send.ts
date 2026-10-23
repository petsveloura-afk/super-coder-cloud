import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPayload, isPushEndpoint, pushPayload, vapidAuthHeader, vapidReady } from "./webpush-core";

/**
 * Wave 17 — job "push": an in-app notification is also shown on the member's phone /
 * desktop (every browser where he turned on notifications). Expired subscriptions
 * (404 / 410) are removed.
 */
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: Buffer): Promise<{ ok: boolean; status: number; gone: boolean }> {
  const testBase = process.env.PUSH_TEST_ENDPOINT_BASE;
  if (!isPushEndpoint(sub.endpoint) && !(testBase && sub.endpoint.startsWith(testBase))) return { ok: false, status: 0, gone: true };
  const body = encryptPayload(sub, payload);
  const auth = vapidAuthHeader(sub.endpoint, { publicKey: process.env.VAPID_PUBLIC_KEY ?? "", privateKey: process.env.VAPID_PRIVATE_KEY ?? "", subject: process.env.VAPID_SUBJECT || "mailto:support@supercoder.cloud" });
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: auth, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}

export async function runPushJob(orgId: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; permanent?: boolean }> {
  if (!vapidReady()) return { ok: true }; // push not configured on this deployment: nothing to do
  const admin = createAdminClient();
  const { data: n } = await admin.from("notifications").select("id, user_id, title_key, params, link, read_at").eq("id", String(payload.notification_id ?? "")).eq("organization_id", orgId).maybeSingle();
  if (!n || n.read_at) return { ok: true };
  const [{ data: subs }, { data: org }] = await Promise.all([
    admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id).eq("organization_id", orgId).limit(10),
    admin.from("organizations").select("name, locale").eq("id", orgId).maybeSingle(),
  ]);
  if (!subs?.length) return { ok: true };
  const locale = (org?.locale === "en" || org?.locale === "ar" ? org.locale : "he") as "he" | "en" | "ar";
  const { getT } = await import("@/lib/i18n/server");
  const { t } = await getT(locale);
  const title = t(n.title_key as string, (n.params ?? {}) as Record<string, string>);
  const body = pushPayload({ title: String(org?.name ?? "SUPER CODER CLOUD"), body: title, url: n.link ? `/${locale}${n.link as string}` : `/${locale}/overview`, tag: String(n.id).slice(0, 36), locale });
  let ok = 0;
  for (const s of subs as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    const r = await sendPush(s, body);
    if (r.gone) await admin.from("push_subscriptions").delete().eq("id", s.id);
    else if (r.ok) {
      ok++;
      await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
    }
  }
  return ok > 0 || subs.length === 0 ? { ok: true } : { ok: false, error: "push_failed" };
}
