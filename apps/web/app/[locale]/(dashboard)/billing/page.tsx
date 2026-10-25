import Link from "next/link";
import { CreditPacksCard } from "@/components/billing/credit-packs";
import { creditPacks } from "@/lib/billing/packs-core";
import type { Metadata } from "next";
import { Check, Clock, CreditCard, Crown, ShieldCheck, Sparkles } from "lucide-react";
import { LIVE_FEATURES, type PlanLimits } from "@scc/shared/billing";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { UsageMeter } from "@/components/billing/usage-meter";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { stripeConfigured, priceIdFor } from "@/lib/billing/stripe";
import { cn } from "@/lib/utils";
import { cancelPayPalAction, openPortalAction, startCheckoutAction } from "./actions";
import { PaymentMethods, PaymentHistory, type PaymentRow } from "@/components/billing/payment-methods";
import { paypalConfigured, paypalSdkConfig } from "@/lib/billing/paypal";
import { lemonConfigured, lemonVariant } from "@/lib/billing/lemonsqueezy";
import { cryptoConfigured } from "@/lib/billing/nowpayments";
import { daysLeft, planAdvice, yearlySavings } from "@/lib/billing/advisor";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("billing.title") };
}

interface PlanRow {
  key: "free" | "pro" | "business" | "enterprise";
  price_monthly: number;
  price_yearly: number;
  currency: string;
  limits: PlanLimits;
  features: string[];
  contact_sales: boolean;
}

interface Entitlements {
  plan_key: string;
  limits: PlanLimits;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  contacts_used: number;
  members_used: number;
  ai_credits_used: number;
  ai_agents_used: number;
}

const ERROR_KEYS: Record<string, string> = {
  forbidden: "errors.forbidden",
  demo: "billing.demoBlocked",
  not_configured: "billing.notConfigured",
  provider: "billing.providerError",
  rate_limited: "ai.rateLimited",
  no_customer: "billing.noCustomer",
  invalid: "errors.generic",
  // wave 11: exact reasons
  paypal_auth: "billing.pay.err.paypal_auth",
  paypal_currency: "billing.pay.err.paypal_currency",
  paypal_permission: "billing.pay.err.paypal_permission",
  paypal_request: "billing.pay.err.paypal_request",
  paypal_down: "billing.pay.err.paypal_down",
  no_price: "billing.pay.err.no_price",
  capture_failed: "billing.pay.err.capture_failed",
};

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ interval?: string; checkout?: string; error?: string; pack?: string }>;
}) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const sp = await searchParams;
  const interval = sp.interval === "year" ? "year" : "month";
  const supabase = await createClient();

  const [{ data: entRows }, { data: plansData }, { data: sub }] = await Promise.all([
    supabase.rpc("org_entitlements", { org: ctx.org.id }),
    supabase.from("plans").select("key, price_monthly, price_yearly, currency, limits, features, contact_sales").order("sort"),
    supabase.from("subscriptions").select("provider, provider_customer_id, provider_subscription_id").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  // wave 8 — more ways to pay + payment history with receipts
  const { data: payRows } = ctx.can("billing.manage")
    ? await supabase.from("billing_payments").select("id, provider, plan_key, billing_interval, amount, currency, status, receipt_number, paid_at").eq("organization_id", ctx.org.id).order("paid_at", { ascending: false }).limit(50)
    : { data: [] };
  const methodFor = (plan: string) => [
    // wave 12: card first; the PayPal recurring-subscription button only when PAYPAL_SHOW_SUBSCRIPTION=true
    ...(paypalConfigured() ? (["paypal_card"] as const) : []),
    ...(paypalConfigured() && process.env.PAYPAL_SHOW_SUBSCRIPTION === "true" ? (["paypal"] as const) : []),
    ...(lemonConfigured() && lemonVariant(plan, interval) ? (["lemonsqueezy"] as const) : []),
    ...(cryptoConfigured() ? (["crypto"] as const) : []),
  ];
  const anyExtra = paypalConfigured() || lemonConfigured() || cryptoConfigured();
  const sdk = paypalSdkConfig();
  const ent = ((entRows ?? []) as Entitlements[])[0];
  const plans = (plansData ?? []) as PlanRow[];
  const current = ent?.plan_key ?? "free";
  const canManage = ctx.can("billing.manage");
  const payments = stripeConfigured();
  const salesEmail = process.env.NEXT_PUBLIC_SALES_EMAIL;
  const n = (v: unknown) => Number(v ?? 0);
  // wave 18: limits after the platform admin's overrides + AI credit packs + custom prices
  const [effRes, balRes, ovRes] = await Promise.all([
    supabase.rpc("effective_limits", { org: ctx.org.id }),
    supabase.rpc("org_credit_balance", { org: ctx.org.id }),
    supabase.from("organizations").select("price_overrides").eq("id", ctx.org.id).maybeSingle(),
  ]);
  const effective = !effRes.error && effRes.data ? (effRes.data as Record<string, number | null>) : null;
  const packBalance = !balRes.error ? Number(balRes.data ?? 0) : null;
  const priceOverrides = !ovRes.error ? ((ovRes.data?.price_overrides ?? {}) as Record<string, Record<string, number>>) : {};
  const lim = (k: keyof PlanLimits) => {
    if (effective && k in effective) {
      const ev = effective[k];
      return ev === null || ev === undefined ? null : Number(ev);
    }
    const v = ent?.limits?.[k];
    return v === null || v === undefined ? null : Number(v);
  };

  const meters = [
    { key: "contacts" as const, label: t("billing.contacts"), used: n(ent?.contacts_used) },
    { key: "members" as const, label: t("billing.members"), used: n(ent?.members_used) },
    { key: "ai_credits_monthly" as const, label: t("billing.aiCredits"), used: n(ent?.ai_credits_used) },
    { key: "ai_agents" as const, label: t("billing.aiAgents"), used: n(ent?.ai_agents_used) },
  ];

  // wave 24: plan advisor (usage ≥ 80 %), renewal countdown, yearly savings, comparison table
  const advice = planAdvice(
    meters.map((m) => ({ key: m.key, used: m.used, limit: lim(m.key) })),
    current,
    plans.map((p) => ({ key: p.key, limits: p.limits as unknown as Record<string, number | null> })),
  );
  const renewIn = daysLeft(ent?.current_period_end);
  const allFeatures = [...new Set(plans.flatMap((p) => p.features))];
  return (
    <>
      <PageHeader title={t("billing.title")} description={t("billing.subtitle")} />

      {sp.checkout === "success" ? (
        <div role="status" className="mb-4 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">{t("billing.success")}</div>
      ) : null}
      {sp.checkout === "pending" ? (
        <div role="status" className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">{t("billing.pay.pending")}</div>
      ) : null}
      {sp.checkout === "canceled" ? (
        <div role="status" className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">{t("billing.canceled")}</div>
      ) : null}
      {sp.error && ERROR_KEYS[sp.error] ? (
        <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{t(ERROR_KEYS[sp.error]!)}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title={t("billing.currentPlan")} />
          <div className="space-y-3 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold-soft text-gold">
                <Crown className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xl font-bold">{t(`billing.plans.${current}.name`)}</div>
                <div className="text-sm text-muted">{t(`billing.plans.${current}.desc`)}</div>
              </div>
            </div>
            {ent?.subscription_status ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={ent.subscription_status === "active" || ent.subscription_status === "trialing" ? "success" : "warning"}>
                  {t(`billing.statuses.${ent.subscription_status}`)}
                </Badge>
                {ent.current_period_end ? (
                  <span className="text-muted">
                    {t(ent.cancel_at_period_end ? "billing.cancelsAt" : "billing.renews", { date: formatDate(locale, ent.current_period_end) })}
                  </span>
                ) : null}
                {renewIn !== null && renewIn >= 0 ? (
                  <span data-testid="renew-countdown" className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", renewIn <= 3 ? "bg-warning-soft text-warning" : "bg-surface-hover text-muted")}>
                    {t("billing.advisor.daysLeft", { days: String(renewIn) })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {canManage && sub?.provider === "paypal" && sub.provider_subscription_id && ent?.subscription_status === "active" ? (
              <form action={cancelPayPalAction}>
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
                  <CreditCard className="h-4 w-4" /> {t("billing.pay.cancelPaypal")}
                </button>
              </form>
            ) : null}
            {canManage && sub?.provider === "lemonsqueezy" ? (
              <a href="https://app.lemonsqueezy.com/my-orders" target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
                <CreditCard className="h-4 w-4" /> {t("billing.manage")}
              </a>
            ) : null}
            {canManage && payments && sub?.provider === "stripe" && sub.provider_customer_id ? (
              <form action={openPortalAction}>
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
                  <CreditCard className="h-4 w-4" /> {t("billing.manage")}
                </button>
              </form>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("billing.usage")} />
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            {meters.map((m) => {
              const l = lim(m.key);
              return (
                <UsageMeter
                  key={m.key}
                  label={m.label}
                  used={m.used}
                  limit={l}
                  unlimitedLabel={t("billing.unlimited")}
                  ofLabel={l === null ? "" : `${formatNumber(locale, m.used)} / ${formatNumber(locale, l)}`}
                />
              );
            })}
          </div>
        </Card>
      </div>

      {/* wave 24: plan advisor */}
      <div data-testid="plan-advisor" className={cn("mt-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center", advice.level === "over" ? "border-danger/30 bg-danger-soft" : advice.level === "near" ? "border-warning/30 bg-warning-soft" : "border-success/30 bg-success-soft")}>
        <span className="text-2xl" aria-hidden>{advice.level === "over" ? "🚦" : advice.level === "near" ? "📈" : "✅"}</span>
        <div className="flex-1 text-sm">
          <p className="font-semibold">{t(`billing.advisor.${advice.level}`)}</p>
          {advice.hot.length ? (
            <p className="mt-0.5 text-[13px] text-muted">
              {advice.hot.map((h) => `${t(`billing.limitLabels.${h.key as "contacts"}`)} ${h.pct}%`).join(" · ")}
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] text-muted">{t("billing.advisor.okSub")}</p>
          )}
        </div>
        {advice.suggest && advice.suggest !== current ? (
          <a href={advice.suggest === "enterprise" ? "#plans" : `#plan-${advice.suggest}`} className="inline-flex h-10 items-center justify-center rounded-xl bg-accent-solid px-4 text-sm font-semibold text-white hover:bg-accent-solid-hover" data-testid="advisor-suggest">
            {t("billing.advisor.suggest", { plan: t(`billing.plans.${advice.suggest}.name`) })}
          </a>
        ) : null}
      </div>

      {/* wave 18: AI credit packs */}
      {packBalance !== null ? (
        <div className="mt-4">
          <CreditPacksCard
            balance={packBalance}
            packs={creditPacks()}
            canBuy={canManage && !ctx.org.is_demo}
            methods={{ paypal: paypalConfigured(), crypto: cryptoConfigured() }}
            status={typeof sp.pack === "string" ? sp.pack : null}
          />
        </div>
      ) : null}

      {!payments && !anyExtra ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" /> {t("billing.notConfigured")}
        </div>
      ) : null}

      <div id="plans" className="mb-4 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold">{t("billing.choosePlan")}</h2>
        <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label={t("billing.interval")}>
          {(["month", "year"] as const).map((iv) => (
            <Link
              key={iv}
              href={`/${locale}/billing${iv === "year" ? "?interval=year" : ""}`}
              role="tab"
              aria-selected={interval === iv}
              className={cn("rounded-lg px-4 py-1.5 text-sm", interval === iv ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-fg")}
            >
              {t(iv === "month" ? "billing.monthly" : "billing.yearly")}
              {iv === "year" ? <span className="ms-1.5 text-[11px] text-success">{t("billing.save")}</span> : null}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const isCurrent = p.key === current;
          const listPrice = interval === "year" ? Number(p.price_yearly) : Number(p.price_monthly);
          // wave 18: a custom price agreed for this organization
          const custom = Number(priceOverrides[p.key]?.[interval]);
          const price = Number.isFinite(custom) && custom > 0 ? custom : listPrice;
          const purchasable = (p.key === "pro" || p.key === "business") && canManage && payments && !ctx.org.is_demo && Boolean(priceIdFor(p.key, interval));
          return (
            <Card key={p.key} id={`plan-${p.key}`} className={cn("flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-lg", p.key === "pro" && "ring-2 ring-brand/60", advice.suggest === p.key && p.key !== current && "ring-2 ring-success/70")}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{t(`billing.plans.${p.key}.name`)}</h3>
                {p.key === "pro" ? (
                  <Badge tone="accent">
                    <Sparkles className="h-3 w-3" /> {t("billing.popular")}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 min-h-10 text-sm text-muted">{t(`billing.plans.${p.key}.desc`)}</p>
              <div className="mt-4 min-h-14">
                {p.contact_sales ? (
                  <div className="text-2xl font-bold">{t("billing.custom")}</div>
                ) : price === 0 ? (
                  <div className="text-3xl font-black tracking-tight">{t("billing.freeForever")}</div>
                ) : (
                  <>
                    <span className="text-3xl font-black tracking-tight" dir="ltr">{formatCurrency(locale, price, p.currency)}</span>
                    <span className="ms-1 text-sm text-muted">{t(interval === "year" ? "billing.perYear" : "billing.perMonth")}</span>
                    {price !== listPrice ? <span className="ms-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">{t("billing.customPrice")}</span> : null}
                    {(() => {
                      const sv = yearlySavings(Number(p.price_monthly), Number(p.price_yearly));
                      if (!sv || sv.saved <= 0) return null;
                      return (
                        <p className="mt-1 text-[12px] text-success" data-testid={`yearly-save-${p.key}`}>
                          {interval === "year"
                            ? t("billing.advisor.yearlyEq", { perMonth: formatCurrency(locale, sv.perMonth, p.currency), saved: formatCurrency(locale, sv.saved, p.currency) })
                            : t("billing.advisor.yearlyHint", { pct: String(sv.pct) })}
                        </p>
                      );
                    })()}
                  </>
                )}
              </div>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {(["contacts", "members", "ai_credits_monthly", "ai_agents"] as const).map((k) => {
                  const v = p.limits?.[k];
                  return (
                    <li key={k} className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-success" />
                      <span>
                        <b dir="ltr">{v === null || v === undefined ? "∞" : formatNumber(locale, Number(v))}</b> {t(`billing.limitLabels.${k}`)}
                      </span>
                    </li>
                  );
                })}
                {p.features.map((f) => (
                  <li key={f} className={cn("flex items-center gap-2", !LIVE_FEATURES.has(f) && "text-subtle")}>
                    {LIVE_FEATURES.has(f) ? <Check className="h-4 w-4 shrink-0 text-success" /> : <Clock className="h-4 w-4 shrink-0" />}
                    <span>
                      {t(`billing.features.${f}`)}
                      {!LIVE_FEATURES.has(f) ? <span className="ms-1 text-[11px]">({t("billing.comingSoon")})</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  <div className="flex h-10 items-center justify-center gap-2 rounded-xl border border-line text-sm font-medium text-muted">
                    <ShieldCheck className="h-4 w-4" /> {t("billing.current")}
                  </div>
                ) : p.contact_sales ? (
                  salesEmail ? (
                    <a href={`mailto:${salesEmail}?subject=Enterprise`} className="flex h-10 items-center justify-center rounded-xl border border-line-strong text-sm font-medium hover:bg-surface-hover">
                      {t("billing.contactSales")}
                    </a>
                  ) : (
                    <p className="text-center text-[13px] text-subtle">{t("billing.contactAdmin")}</p>
                  )
                ) : purchasable ? (
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="plan" value={p.key} />
                    <input type="hidden" name="interval" value={interval} />
                    <button type="submit" className="flex h-10 w-full items-center justify-center rounded-xl bg-accent-solid text-sm font-medium text-white hover:bg-accent-solid-hover">
                      {t("billing.upgrade")}
                    </button>
                  </form>
                ) : p.key !== "free" && !(canManage && !ctx.org.is_demo && methodFor(p.key).length) ? (
                  <p className="text-center text-[13px] text-subtle">{!canManage ? t("billing.readOnly") : t("billing.contactAdmin")}</p>
                ) : null}
                {!isCurrent && (p.key === "pro" || p.key === "business") && canManage && !ctx.org.is_demo && methodFor(p.key).length ? (
                  <PaymentMethods
                    locale={locale}
                    plan={p.key}
                    interval={interval}
                    methods={methodFor(p.key)}
                    withDivider={purchasable}
                    inlineCard={
                      sdk
                        ? { ...sdk, currency: String(p.currency ?? "ILS").toUpperCase(), planName: t(`billing.plans.${p.key}.name`), priceLabel: `${formatCurrency(locale, price, p.currency)} ${t(interval === "year" ? "billing.perYear" : "billing.perMonth")}` }
                        : null
                    }
                  />
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-center text-[12px] text-subtle">{t("billing.vat")}</p>

      {/* wave 24: full comparison + trust */}
      <details className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface" data-testid="plan-compare">
        <summary className="cursor-pointer select-none px-5 py-3.5 font-semibold hover:bg-surface-hover">{t("billing.advisor.compare")}</summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-y border-line bg-surface-hover/60">
                <th className="px-4 py-2 text-start font-medium text-muted">{t("billing.advisor.feature")}</th>
                {plans.map((p) => (
                  <th key={p.key} className={cn("px-3 py-2 text-center font-semibold", p.key === current && "text-accent")}>{t(`billing.plans.${p.key}.name`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(["contacts", "members", "ai_credits_monthly", "ai_agents"] as const).map((k) => (
                <tr key={k}>
                  <td className="px-4 py-2">{t(`billing.limitLabels.${k}`)}</td>
                  {plans.map((p) => {
                    const v = p.limits?.[k];
                    return <td key={p.key} className="px-3 py-2 text-center font-semibold tabular-nums" dir="ltr">{v === null || v === undefined ? "∞" : formatNumber(locale, Number(v))}</td>;
                  })}
                </tr>
              ))}
              {allFeatures.map((f) => (
                <tr key={f}>
                  <td className="px-4 py-2">{t(`billing.features.${f}`)}</td>
                  {plans.map((p) => (
                    <td key={p.key} className="px-3 py-2 text-center">{p.features.includes(f) ? <Check className="mx-auto h-4 w-4 text-success" aria-label="✓" /> : <span className="text-subtle">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="billing-trust">
        {(["secure", "cancel", "receipts"] as const).map((k) => (
          <div key={k} className="flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-[13px]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span><b className="block">{t(`billing.advisor.trust.${k}`)}</b><span className="text-muted">{t(`billing.advisor.trust.${k}Sub`)}</span></span>
          </div>
        ))}
      </div>
      {canManage ? <PaymentHistory locale={locale} rows={(payRows ?? []) as PaymentRow[]} /> : null}
    </>
  );
}
