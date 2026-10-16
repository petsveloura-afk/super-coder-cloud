import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { uuidSchema } from "@scc/shared/validators";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/format";
import { businessDetails } from "@/lib/billing/receipts";
import { PrintButton } from "@/components/billing/print-button";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("billing.pay.receiptTitle"), robots: { index: false } };
}

/** Printable receipt of a plan payment (members with billing access only — RLS). */
export default async function ReceiptPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { t } = await getT(locale);
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("billing_payments")
    .select("id, organization_id, provider, plan_key, billing_interval, amount, currency, status, receipt_number, payer_email, payer_name, period_end, paid_at, meta")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();
  const { data: org } = await supabase.from("organizations").select("name").eq("id", r.organization_id).maybeSingle();
  const b = businessDetails();
  const rows: [string, string][] = [
    [t("billing.pay.receiptNo"), `#${r.receipt_number}`],
    [t("billing.pay.date"), formatDate(locale, r.paid_at as string)],
    [t("billing.pay.customer"), [org?.name, r.payer_name, r.payer_email].filter(Boolean).join(" · ") || "—"],
    [t("billing.pay.item"), `${r.plan_key ? t(`billing.plans.${r.plan_key}.name`) : "—"}${r.billing_interval ? ` · ${t(r.billing_interval === "year" ? "billing.yearly" : "billing.monthly")}` : ""}`],
    [t("billing.pay.method"), t(`billing.pay.providers.${r.provider}`)],
    ...(r.period_end ? ([[t("billing.pay.validUntil"), formatDate(locale, r.period_end as string)]] as [string, string][]) : []),
  ];
  const receiptUrl = (r.meta as { receipt_url?: string } | null)?.receipt_url;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 print:py-0" data-testid="receipt">
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link href={`/${locale}/billing`} className="text-sm text-accent hover:underline">
          {t("billing.pay.backToBilling")}
        </Link>
        <PrintButton label={t("billing.pay.print")} />
      </div>
      <article className="overflow-hidden rounded-3xl border border-line bg-white text-[#1d2433] shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 bg-[#3366E6] px-6 py-5 text-white">
          <div>
            <div className="text-lg font-bold">{b.name}</div>
            {b.id ? <div className="text-[12.5px] opacity-90">{b.id}</div> : null}
            {b.address ? <div className="text-[12.5px] opacity-90">{b.address}</div> : null}
            {b.email ? <div className="text-[12.5px] opacity-90" dir="ltr">{b.email}</div> : null}
          </div>
          <div className="text-end">
            <div className="text-xs uppercase tracking-wide opacity-80">{t("billing.pay.receiptTitle")}</div>
            <div className="text-2xl font-black">#{r.receipt_number}</div>
          </div>
        </header>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-[#eef0f6]">
                <td className="w-40 px-6 py-3 text-[#667085]">{k}</td>
                <td className="px-6 py-3 font-medium">{v}</td>
              </tr>
            ))}
            <tr>
              <td className="px-6 py-4 text-base font-semibold">{t("billing.pay.total")}</td>
              <td className="px-6 py-4 text-xl font-black" dir="ltr">
                {formatCurrency(locale, Number(r.amount), String(r.currency).toUpperCase())}
              </td>
            </tr>
          </tbody>
        </table>
        <footer className="space-y-1 bg-[#f7f8fc] px-6 py-4 text-[12px] text-[#667085]">
          <p>{t(r.status === "refunded" ? "billing.pay.refunded" : "billing.pay.paidNote")}</p>
          <p>{t("billing.pay.legalNote")}</p>
          {receiptUrl ? (
            <p>
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[#3366E6] underline">
                {t("billing.pay.providerReceipt")}
              </a>
            </p>
          ) : null}
        </footer>
      </article>
    </main>
  );
}
