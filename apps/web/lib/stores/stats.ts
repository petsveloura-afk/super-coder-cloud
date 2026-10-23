import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Wave 19 — orders and revenue of one store source in the last N days (integrations card). */
export async function storeStats(orgId: string, source: "shopify" | "woocommerce", days = 30): Promise<{ orders: number; revenue: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { orders: 0, revenue: 0 };
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await createAdminClient().from("store_orders").select("total").eq("organization_id", orgId).eq("source", source).gte("placed_at", since).limit(5000);
  const rows = (data ?? []) as { total: number }[];
  return { orders: rows.length, revenue: rows.reduce((a, r) => a + Number(r.total ?? 0), 0) };
}
