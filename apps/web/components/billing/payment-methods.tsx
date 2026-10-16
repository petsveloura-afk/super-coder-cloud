import Link from "next/link";
import { Bitcoin, CreditCard, Receipt, Wallet } from "lucide-react";
import { startPaymentAction } from "@/app/[locale]/(dashboard)/billing/actions";
import { getT } from "@/lib/i18n/server";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";

/** Pay buttons for a plan: PayPal (PayPal or card), Lemon Squeezy (card / Apple Pay / PayPal), crypto. */
export async function PaymentMethods({ locale, plan, interval, methods, withDivider }: { locale: Locale; plan: string; interval: "month" | "year"; methods: ("paypal" | "lemonsqueezy" | "crypto" | "paypal_card")[]; withDivider?: boolean }) {
  const { t } = await getT(locale);
  const meta = {
    paypal_card: { icon: CreditCard, label: t("billing.pay.paypalCard"), sub: t("billing.pay.paypalCardSub"), cls: "bg-[#0f172a] text-white ring-1 ring-white/10 hover:brightness-125" },
    paypal: { icon: Wallet, label: t("billing.pay.paypal"), sub: t("billing.pay.paypalSub"), cls: "bg-[#FFC439] text-[#111] hover:brightness-95" },
    lemonsqueezy: { icon: CreditCard, label: t("billing.pay.card"), sub: t("billing.pay.cardSub"), cls: "bg-accent-solid text-white hover:bg-accent-solid-hover" },
    crypto: { icon: Bitcoin, label: t("billing.pay.crypto"), sub: t("billing.pay.cryptoSub"), cls: "border border-line-strong bg-surface hover:bg-surface-hover" },
  } as const;
  return (
    <div className="mt-2 space-y-2" data-testid={`pay-${plan}`}>
      {withDivider ? <div className="text-center text-[11px] text-subtle">{t("billing.pay.or")}</div> : null}
      {methods.map((m) => {
        const M = meta[m];
        return (
          <form key={m} action={startPaymentAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="plan" value={plan} />
            <input type="hidden" name="interval" value={interval} />
            <input type="hidden" name="method" value={m} />
            <button type="submit" data-method={m} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${M.cls}`}>
              <M.icon className="h-4 w-4 shrink-0" />
              <span className="flex flex-col items-center leading-tight">
                <span>{M.label}</span>
                <span className="text-[10.5px] font-normal opacity-80">{M.sub}</span>
              </span>
            </button>
          </form>
        );
      })}
    </div>
  );
}

export interface PaymentRow {
  id: string;
  provider: string;
  plan_key: string | null;
  billing_interval: string | null;
  amount: number;
  currency: string;
  status: string;
  receipt_number: number;
  paid_at: string;
}

export async function PaymentHistory({ locale, rows }: { locale: Locale; rows: PaymentRow[] }) {
  const { t } = await getT(locale);
  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface" data-testid="payment-history">
      <header className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Receipt className="h-5 w-5 text-accent" />
        <h2 className="font-semibold">{t("billing.pay.history")}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-subtle">{t("billing.pay.noPayments")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="font-mono text-[12.5px] text-muted">#{r.receipt_number}</span>
              <span className="text-muted">{formatDate(locale, r.paid_at)}</span>
              <span className="font-medium">{r.plan_key ? t(`billing.plans.${r.plan_key}.name`) : "—"}</span>
              <span className="text-[12px] text-subtle">{t(`billing.pay.providers.${r.provider}`)}</span>
              <span className="ms-auto font-semibold tabular-nums" dir="ltr">
                {formatCurrency(locale, Number(r.amount), r.currency.toUpperCase())}
              </span>
              <Link href={`/${locale}/receipt/${r.id}`} className="text-[13px] font-medium text-accent hover:underline">
                {t("billing.pay.receipt")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
