import { Banknote, Bitcoin, CreditCard, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatCurrency, formatDate } from "@/lib/format";
import { paypalConfigured } from "@/lib/billing/paypal";
import { lemonConfigured } from "@/lib/billing/lemonsqueezy";
import { cryptoConfigured } from "@/lib/billing/nowpayments";
import { stripeConfigured } from "@/lib/billing/stripe";
import type { Locale } from "@/lib/i18n/config";

/** Platform admin: payment providers status, revenue (30 days, per currency) and the latest payments. */
export async function AdminPayments({ locale }: { locale: Locale }) {
  const supabase = await createClient();
  const { t } = await getT(locale);
  const since = new Date(new Date().getTime() - 30 * 86_400_000).toISOString();
  const { data } = await supabase
    .from("billing_payments")
    .select("id, organization_id, provider, plan_key, amount, currency, receipt_number, paid_at, status")
    .gte("paid_at", since)
    .order("paid_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as { id: string; provider: string; plan_key: string | null; amount: number; currency: string; receipt_number: number; paid_at: string; status: string }[];
  const totals = new Map<string, number>();
  for (const r of rows) if (r.status === "paid") totals.set(r.currency.toUpperCase(), (totals.get(r.currency.toUpperCase()) ?? 0) + Number(r.amount));
  const providers = [
    { key: "paypal", icon: Wallet, on: paypalConfigured() },
    { key: "lemonsqueezy", icon: CreditCard, on: lemonConfigured() },
    { key: "nowpayments", icon: Bitcoin, on: cryptoConfigured() },
    { key: "stripe", icon: Banknote, on: stripeConfigured() },
  ];
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface" data-testid="admin-payments">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-semibold">{t("admin.payments.title")}</h2>
        <p className="text-[12.5px] text-muted">{t("admin.payments.subtitle")}</p>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {providers.map((p) => (
          <div key={p.key} className="flex items-center gap-2.5 rounded-xl bg-elevated px-3 py-2.5 text-sm">
            <p.icon className="h-4 w-4 text-accent" />
            <span className="flex-1">{t(`billing.pay.providers.${p.key}`)}</span>
            <span className={p.on ? "text-success" : "text-subtle"}>{t(p.on ? "admin.payments.on" : "admin.payments.off")}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 px-4 pb-3">
        {[...totals.entries()].map(([cur, sum]) => (
          <div key={cur} className="rounded-xl border border-line px-4 py-2">
            <div className="text-[12px] text-muted">{t("admin.payments.revenue30")}</div>
            <div className="text-lg font-bold tabular-nums" dir="ltr">
              {formatCurrency(locale, sum, cur)}
            </div>
          </div>
        ))}
        {totals.size === 0 ? <p className="text-[13px] text-subtle">{t("admin.payments.none")}</p> : null}
      </div>
      {rows.length ? (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto border-t border-line">
          {rows.slice(0, 30).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
              <span className="font-mono text-muted">#{r.receipt_number}</span>
              <span className="text-muted">{formatDate(locale, r.paid_at)}</span>
              <span>{r.plan_key ?? "—"}</span>
              <span className="text-subtle">{t(`billing.pay.providers.${r.provider}`)}</span>
              <span className="ms-auto font-semibold tabular-nums" dir="ltr">
                {formatCurrency(locale, Number(r.amount), r.currency.toUpperCase())}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
