import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Check, Lock, ShieldCheck } from "lucide-react";
import type { PlanLimits } from "@scc/shared/billing";
import { LIVE_FEATURES } from "@scc/shared/billing";
import { Card } from "@/components/ui/primitives";
import { CardPay } from "@/components/billing/card-pay";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatNumber } from "@/lib/format";
import { paypalSdkConfig } from "@/lib/billing/paypal";
import { cryptoConfigured } from "@/lib/billing/nowpayments";
import { cn } from "@/lib/utils";

/**
 * Wave 14 — checkout on its own page: order summary + card form (or crypto) with
 * room for PayPal's card verification. Opened with a full page load so the page's
 * own security headers (PayPal allowed, pop-ups for 3-D Secure) always apply.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("billing.pay.checkoutTitle"), robots: { index: false } };
}

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ plan?: string; interval?: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const sp = await searchParams;
  const plan = sp.plan === "business" ? "business" : sp.plan === "pro" ? "pro" : null;
  const interval = sp.interval === "year" ? "year" : "month";
  if (!plan || !ctx.can("billing.manage") || ctx.org.is_demo) redirect(`/${locale}/billing`);
  const sdk = paypalSdkConfig();
  if (!sdk) redirect(`/${locale}/billing?error=not_configured`);

  const supabase = await createClient();
  const { data: p } = await supabase.from("plans").select("key, price_monthly, price_yearly, currency, limits, features").eq("key", plan).maybeSingle();
  if (!p) redirect(`/${locale}/billing`);
  const price = Number(interval === "year" ? p.price_yearly : p.price_monthly);
  const monthly = Number(p.price_monthly);
  const saving = interval === "year" && monthly > 0 ? Math.max(0, monthly * 12 - price) : 0;
  const currency = String(p.currency ?? "ILS").toUpperCase();
  const limits = (p.limits ?? {}) as PlanLimits;
  const features = ((p.features ?? []) as string[]).filter((f) => LIVE_FEATURES.has(f));
  const Back = locale === "en" ? ArrowLeft : ArrowRight;

  return (
    <div className="mx-auto max-w-5xl">
      <a href={`/${locale}/billing`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("billing.title")}
      </a>
      <h1 className="mb-1 text-2xl font-bold">{t("billing.pay.checkoutTitle")}</h1>
      <p className="mb-6 text-sm text-muted">{t("billing.pay.checkoutHint")}</p>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        {/* order summary */}
        <Card className="h-fit p-5" data-testid="checkout-summary">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{t(`billing.plans.${plan}.name`)}</h2>
            <div className="inline-flex rounded-xl bg-surface p-1 text-[13px] ring-1 ring-line" role="group" aria-label={t("billing.pay.period")}>
              {(["month", "year"] as const).map((iv) => (
                <a key={iv} href={`/${locale}/billing/checkout?plan=${plan}&interval=${iv}`} aria-current={iv === interval ? "true" : undefined} className={cn("rounded-lg px-3 py-1.5", iv === interval ? "bg-elevated font-semibold shadow-sm ring-1 ring-line" : "text-muted hover:text-fg")}>
                  {t(iv === "year" ? "billing.yearly" : "billing.monthly")}
                </a>
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight" dir="ltr">
              {formatCurrency(locale, price, currency)}
            </span>
            <span className="text-sm text-muted">{t(interval === "year" ? "billing.perYear" : "billing.perMonth")}</span>
          </div>
          {saving > 0 ? <p className="mt-1 text-[13px] font-medium text-success">{t("billing.pay.yearSaving", { amount: formatCurrency(locale, saving, currency) })}</p> : null}
          <ul className="mt-4 space-y-2 text-sm">
            {(["contacts", "members", "ai_credits_monthly", "ai_agents"] as const).map((k) => {
              const v = limits?.[k];
              return (
                <li key={k} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-success" />
                  <span>
                    <b dir="ltr">{v === null || v === undefined ? "∞" : formatNumber(locale, Number(v))}</b> {t(`billing.limitLabels.${k}`)}
                  </span>
                </li>
              );
            })}
            {features.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-success" /> {t(`billing.features.${f}`)}
              </li>
            ))}
          </ul>
          <div className="mt-5 space-y-1.5 border-t border-line pt-4 text-[12.5px] text-muted">
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-success" /> {t("billing.pay.prepaidNote", { period: t(interval === "year" ? "billing.pay.periodYear" : "billing.pay.periodMonth") })}
            </p>
            <p className="flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-success" /> {t("billing.pay.receiptNote")}
            </p>
            <p>{t("billing.vat")}</p>
          </div>
        </Card>

        {/* payment */}
        <Card className="order-first p-5 lg:order-none">
          {/* phones: the payment comes first, with a one-line summary */}
          <div className="mb-4 flex items-baseline justify-between gap-3 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-line lg:hidden" data-testid="checkout-mini">
            <span className="font-semibold">{t(`billing.plans.${plan}.name`)}</span>
            <span>
              <b className="text-lg" dir="ltr">
                {formatCurrency(locale, price, currency)}
              </b>{" "}
              <span className="text-[12.5px] text-muted">{t(interval === "year" ? "billing.perYear" : "billing.perMonth")}</span>
            </span>
          </div>
          <h2 className="mb-1 font-semibold">{t("billing.pay.payment")}</h2>
          <p className="mb-4 text-[12.5px] text-muted">{t("billing.pay.cardDesc")}</p>
          <CardPay plan={plan} interval={interval} currency={currency} clientId={sdk.clientId} sdkUrl={sdk.sdkUrl} crypto={cryptoConfigured()} />
          <p className="mt-4 text-center text-[12px] text-subtle">
            {t("billing.pay.byPaying")}{" "}
            <Link href={`/${locale}/billing`} className="underline">
              {t("billing.pay.changePlan")}
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
