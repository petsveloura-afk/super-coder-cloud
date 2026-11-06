import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n/config";
import type { BillingHealthRow } from "@/lib/billing/integrity-core";
import { AdminBillingHealthClient } from "./admin-billing-health-client";

/** Platform admin: billing integrity + one client file per business (payments, receipts, packs, usage, plan history). */
export async function AdminBillingHealth({ locale }: { locale: Locale }) {
  const supabase = await createClient();
  const now = new Date().getTime();
  const { data, error } = await supabase.rpc("platform_billing_health", { p_search: null, p_limit: 300 });
  // the migration may not be applied yet — the card simply does not show
  if (error) return null;
  const rows = ((data ?? []) as BillingHealthRow[]).map((r) => ({ ...r, paid_total: Number(r.paid_total), payments: Number(r.payments), credits_month: Number(r.credits_month), monthly_limit: r.monthly_limit === null ? null : Number(r.monthly_limit), pack_balance: Number(r.pack_balance) }));
  return <AdminBillingHealthClient locale={locale} rows={rows} now={now} />;
}
