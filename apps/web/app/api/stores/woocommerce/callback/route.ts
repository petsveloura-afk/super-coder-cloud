import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { wooCreateWebhooks } from "@/lib/stores/woocommerce";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WooCommerce posts the new REST keys here after the owner approved (wc-auth). user_id is our
 * pending integration id (valid for one hour). The keys are stored encrypted and the order
 * webhooks are created on the store with a per-store signing secret.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  let body: { key_id?: number; user_id?: string; consumer_key?: string; consumer_secret?: string; key_permissions?: string } = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const id = String(body.user_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^ck_[a-z0-9]{20,}$/i.test(body.consumer_key ?? "") || !/^cs_[a-z0-9]{20,}$/i.test(body.consumer_secret ?? "")) return NextResponse.json({ ok: false }, { status: 400 });
  const admin = createAdminClient();
  const { data: integ } = await admin.from("integrations").select("id, organization_id, status, config, created_at, updated_at").eq("id", id).eq("provider", "woocommerce").maybeSingle();
  const cfg = (integ?.config as { origin?: string; state?: string; started_at?: string; hook_hash?: string } | undefined) ?? {};
  if (!integ || cfg.state !== "pending" || !cfg.origin || Date.now() - Date.parse(cfg.started_at ?? "") > 3_600_000) return NextResponse.json({ ok: false }, { status: 404 });
  const { loadIntegration, saveIntegration } = await import("@/lib/integrations/store");
  const full = await loadIntegration(integ.organization_id as string, "woocommerce");
  const hook = full?.secrets.hook_token ?? "";
  if (!hook) return NextResponse.json({ ok: false }, { status: 409 });
  await saveIntegration(integ.organization_id as string, "woocommerce", { ...cfg, state: "connected", connected_at: new Date().toISOString(), permissions: String(body.key_permissions ?? "") }, { hook_token: hook, consumer_key: body.consumer_key!, consumer_secret: body.consumer_secret! });
  const hooks = await wooCreateWebhooks(cfg.origin, body.consumer_key!, body.consumer_secret!, hook);
  if (hooks.failed.length) await admin.from("integrations").update({ last_error: `webhooks: ${hooks.failed.join(", ")}`.slice(0, 500) }).eq("id", integ.id);
  return NextResponse.json({ ok: true });
}
