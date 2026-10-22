import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Status of the money connections for the finance settings tab (no secrets). */
export async function moneyConnections(orgId: string): Promise<{ paypal: { connected: boolean; mode: string }; invoicing: { provider: string | null; config: Record<string, unknown>; last_error: string | null; last_success_at: string | null } }> {
  const admin = createAdminClient();
  const [{ data: fs }, { listIntegrations }] = await Promise.all([admin.from("finance_settings").select("paypal_client_id, paypal_secret_enc, paypal_mode").eq("organization_id", orgId).maybeSingle(), import("@/lib/integrations/store")]);
  const list = await listIntegrations(orgId, ["morning", "icount"]);
  const provider = list.morning ? "morning" : list.icount ? "icount" : null;
  const it = provider ? list[provider]! : null;
  return {
    paypal: { connected: Boolean(fs?.paypal_client_id && fs.paypal_secret_enc), mode: (fs?.paypal_mode as string | undefined) ?? "live" },
    invoicing: { provider, config: it?.config ?? {}, last_error: it?.last_error ?? null, last_success_at: it?.last_success_at ?? null },
  };
}
