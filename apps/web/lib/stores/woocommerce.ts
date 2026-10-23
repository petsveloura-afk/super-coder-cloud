import "server-only";
import { publicEnv } from "@/lib/env";

/**
 * Wave 19 — WooCommerce in one approval: the business types its store address, WooCommerce
 * asks "allow Super Coder?" → keys arrive at our callback → order webhooks are created for it.
 * No platform setup needed (WooCommerce's built-in app authentication).
 */
const appUrl = () => publicEnv.appUrl.replace(/\/$/, "");

export function wooAuthorizeUrl(origin: string, integrationId: string, locale: string): string {
  const u = new URL(`${origin}/wc-auth/v1/authorize`);
  u.search = new URLSearchParams({
    app_name: "Super Coder Cloud",
    scope: "read_write",
    user_id: integrationId,
    return_url: `${appUrl()}/${locale}/integrations?store=woocommerce`,
    callback_url: `${appUrl()}/api/stores/woocommerce/callback`,
  }).toString();
  return u.toString();
}

export async function wooCreateWebhooks(origin: string, key: string, secret: string, hookToken: string): Promise<{ ok: number; failed: string[] }> {
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  let ok = 0;
  const failed: string[] = [];
  for (const topic of ["order.created", "order.updated"]) {
    try {
      const res = await fetch(`${origin}/wp-json/wc/v3/webhooks`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Super Coder · ${topic}`, topic, status: "active", delivery_url: `${appUrl()}/api/stores/woocommerce/webhook?h=${hookToken}`, secret: hookToken }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (res.ok) ok++;
      else failed.push(`${topic}:${res.status}`);
    } catch (e) {
      failed.push(`${topic}:${(e as Error).message}`);
    }
  }
  return { ok, failed };
}
