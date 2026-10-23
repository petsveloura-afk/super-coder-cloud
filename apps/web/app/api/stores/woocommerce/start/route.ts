import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { hookHash, storeOrigin } from "@/lib/stores/core";
import { wooAuthorizeUrl } from "@/lib/stores/woocommerce";
import { assertPublicHttpsUrl } from "@/lib/net/safe-url";
import { encryptionReady } from "@/lib/channels/secrets";

export const dynamic = "force-dynamic";

/** GET /api/stores/woocommerce/start?url=https://my-store.co.il&locale=he — wave 19: one WooCommerce approval. */
export async function GET(request: NextRequest) {
  const l = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(l) ? l : "he";
  const back = new URL(`/${locale}/integrations`, request.url);
  back.hash = "stores";
  const fail = (status: string) => {
    back.searchParams.set("store", status);
    return NextResponse.redirect(back);
  };
  const origin = storeOrigin(request.nextUrl.searchParams.get("url") ?? "");
  if (!origin) return fail("bad_url");
  try {
    await assertPublicHttpsUrl(origin);
  } catch {
    return fail("bad_url");
  }
  if (!encryptionReady()) return fail("not_configured");
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return fail("forbidden");
  const hook = randomBytes(24).toString("hex");
  const { saveIntegration } = await import("@/lib/integrations/store");
  const id = await saveIntegration(ctx.org.id, "woocommerce", { origin, hook_hash: hookHash(hook), state: "pending", started_at: new Date().toISOString() }, { hook_token: hook });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await createAdminClient().from("integrations").update({ status: "pending" }).eq("id", id);
  return NextResponse.redirect(wooAuthorizeUrl(origin, id, locale));
}
