import Link from "next/link";
import type { Metadata } from "next";
import { FileText, Package, Plus, Receipt, Settings2 } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { FinanceSettingsForm, ProductButton } from "@/components/finance/finance-client";
import { InvoicingCard, OrgPayPalCard } from "@/components/finance/finance-plus";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { contactOptions } from "@/lib/lookups";
import { publicEnv } from "@/lib/env";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ScreenPulse } from "@/components/ui/screen-pulse";
import { financePulse } from "@/lib/insights/screens-core";
import { DOC_STATUS_TONE } from "@/lib/finance/labels";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("finance.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS = ["documents", "products", "settings"] as const;
const KINDS = ["all", "quote", "invoice"] as const;
const STATUS_FILTERS = ["all", "draft", "sent", "accepted", "paid", "overdue", "void"] as const;

export default async function FinancePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("finance.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as (typeof TABS)[number]) : "documents";
  const kind = (KINDS as readonly string[]).includes(String(sp.kind)) ? (sp.kind as (typeof KINDS)[number]) : "all";
  const status = (STATUS_FILTERS as readonly string[]).includes(String(sp.status)) ? (sp.status as (typeof STATUS_FILTERS)[number]) : "all";
  const canWrite = ctx.can("finance.write");
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab: tab === "documents" ? undefined : tab, kind: kind === "all" ? undefined : kind, status: status === "all" ? undefined : status, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/${locale}/finance${s ? `?${s}` : ""}`;
  };

  const header = (
    <>
      <PageHeader
        title={t("finance.title")}
        description={t("finance.subtitle")}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Link href={`/${locale}/finance/new?kind=quote`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium hover:bg-surface-hover">
                <Plus className="h-4 w-4" /> {t("finance.newQuote")}
              </Link>
              <Link href={`/${locale}/finance/new?kind=invoice`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-medium text-accent-fg hover:bg-accent-solid-hover">
                <Plus className="h-4 w-4" /> {t("finance.newInvoice")}
              </Link>
            </div>
          ) : null
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist" aria-label={t("finance.title")}>
        {TABS.map((x) => {
          const Icon = x === "documents" ? FileText : x === "products" ? Package : Settings2;
          return (
            <Link key={x} href={`/${locale}/finance${x === "documents" ? "" : `?tab=${x}`}`} role="tab" aria-selected={tab === x} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[13px]", tab === x ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg")}>
              <Icon className="h-4 w-4" /> {t(`finance.tabs.${x}`)}
            </Link>
          );
        })}
      </div>
    </>
  );

  if (tab === "products") {
    const { data } = await supabase.from("products").select("id, name, description, unit_price, tax_rate").eq("organization_id", ctx.org.id).order("name").limit(500);
    const rows = (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, description: p.description as string | null, unit_price: Number(p.unit_price), tax_rate: p.tax_rate == null ? null : Number(p.tax_rate) }));
    return (
      <>
        {header}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line p-4">
            <p className="text-[13px] text-muted">{t("finance.productsHint")}</p>
            {canWrite ? <ProductButton /> : null}
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={<Package className="h-6 w-6" />} title={t("finance.noProducts")} />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3" data-product={p.name}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    {p.description ? <p className="truncate text-[12.5px] text-muted">{p.description}</p> : null}
                  </div>
                  <span className="tabular-nums">{formatCurrency(locale, p.unit_price)}</span>
                  {p.tax_rate != null ? <Badge tone="neutral">{p.tax_rate}%</Badge> : null}
                  {canWrite ? <ProductButton product={p} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  }

  if (tab === "settings") {
    const [{ data: s }, { data: ready }] = await Promise.all([
      supabase
        .from("finance_settings")
        .select("business_name, business_id, address, phone, email, default_tax_rate, quote_valid_days, payment_terms_days, payment_instructions, default_notes, stripe_webhook_token")
        .eq("organization_id", ctx.org.id)
        .maybeSingle(),
      supabase.rpc("finance_stripe_ready", { p_org: ctx.org.id }),
    ]);
    const v = (k: string, d = "") => (s && (s as Record<string, unknown>)[k] != null ? String((s as Record<string, unknown>)[k]) : d);
    // wave 15: the business's own PayPal + Morning / iCount tax documents
    const money = canWrite && process.env.SUPABASE_SERVICE_ROLE_KEY ? await import("@/lib/finance/connections").then((m) => m.moneyConnections(ctx.org.id)).catch(() => null) : null;
    const invoicingLocked = !(await import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "invoicing_sync")));
    const webhookUrl = s?.stripe_webhook_token ? `${publicEnv.appUrl.replace(/\/$/, "")}/api/webhooks/payments/${s.stripe_webhook_token}` : null;
    return (
      <>
        {header}
        <Card className="p-5">
          {canWrite ? (
            <FinanceSettingsForm
              stripeReady={Boolean(ready)}
              webhookUrl={webhookUrl}
              initial={{
                business_name: v("business_name", ctx.org.name),
                business_id: v("business_id"),
                address: v("address"),
                phone: v("phone"),
                email: v("email"),
                default_tax_rate: v("default_tax_rate", "18"),
                quote_valid_days: v("quote_valid_days", "14"),
                payment_terms_days: v("payment_terms_days", "30"),
                payment_instructions: v("payment_instructions"),
                default_notes: v("default_notes"),
              }}
            />
          ) : (
            <EmptyState title={t("errors.forbidden")} />
          )}
        </Card>
        {money ? (
          <>
            <Card className="mt-4 p-5">
              <OrgPayPalCard connected={money.paypal.connected} mode={money.paypal.mode} />
            </Card>
            {ctx.can("integrations.manage") ? (
              <Card className="mt-4 p-5">
                <InvoicingCard provider={money.invoicing.provider} config={money.invoicing.config} lastError={money.invoicing.last_error} lastSuccess={money.invoicing.last_success_at} locked={invoicingLocked} />
              </Card>
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  let q = supabase
    .from("documents")
    .select("id, kind, number, status, title, contact_id, issue_date, due_date, currency, total, amount_paid")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (kind !== "all") q = q.eq("kind", kind);
  if (status === "overdue") q = q.eq("kind", "invoice").in("status", ["sent", "accepted"]).lt("due_date", today);
  else if (status !== "all") q = q.eq("status", status);
  const [{ data }, contacts, { data: openInv }, { data: paidMonth }] = await Promise.all([
    q,
    contactOptions(ctx.org.id),
    supabase.from("documents").select("total, amount_paid, due_date, currency").eq("organization_id", ctx.org.id).eq("kind", "invoice").in("status", ["sent", "accepted"]).limit(2000),
    supabase.from("payments").select("amount").eq("organization_id", ctx.org.id).gte("paid_at", `${today.slice(0, 7)}-01`).limit(5000),
  ]);
  const rows = data ?? [];
  const contactName = new Map(contacts.map((c) => [c.id, c.label]));
  const outstanding = (openInv ?? []).reduce((s, d) => s + Number(d.total) - Number(d.amount_paid), 0);
  const overdue = (openInv ?? []).filter((d) => d.due_date && (d.due_date as string) < today).reduce((s, d) => s + Number(d.total) - Number(d.amount_paid), 0);
  const collected = (paidMonth ?? []).reduce((s, p) => s + Number(p.amount), 0);
  // wave 53 — smart pulse: due this week + quotes waiting for an answer (the cards below show the rest)
  const { data: sentQuotes } = await supabase.from("documents").select("total, amount_paid, due_date").eq("organization_id", ctx.org.id).eq("kind", "quote").eq("status", "sent").limit(2000);
  const finPulseAll = financePulse(
    [
      ...((openInv ?? []) as { total: number; amount_paid: number; due_date: string | null }[]).map((d) => ({ kind: "invoice", status: "sent", due_date: d.due_date, total: Number(d.total), amount_paid: Number(d.amount_paid) })),
      ...((sentQuotes ?? []) as { total: number; amount_paid: number; due_date: string | null }[]).map((d) => ({ kind: "quote", status: "sent", due_date: d.due_date, total: Number(d.total), amount_paid: Number(d.amount_paid) })),
    ],
    today,
  );
  const finPulse = { ...finPulseAll, stats: finPulseAll.stats.filter((x) => x.key === "dueSoon" || x.key === "quotes") };

  return (
    <>
      {header}
      <ScreenPulse screen="finance" pulse={finPulse} locale={locale} t={t} currency={ctx.org.currency || "ILS"} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          ["finance.kpiOutstanding", outstanding, "text-fg"],
          ["finance.kpiOverdue", overdue, overdue > 0 ? "text-danger" : "text-fg"],
          ["finance.kpiCollected", collected, "text-success"],
        ].map(([k, n, cls]) => (
          <Card key={k as string} className="p-4">
            <p className="text-[12.5px] text-muted">{t(k as string)}</p>
            <p className={cn("mt-1 text-xl font-bold tabular-nums", cls as string)}>{formatCurrency(locale, n as number)}</p>
          </Card>
        ))}
      </div>
      <Card className="mb-4 flex flex-wrap gap-3 p-3">
        <div className="flex gap-1" role="group" aria-label={t("finance.kind")}>
          {KINDS.map((k) => (
            <Link key={k} href={href({ kind: k === "all" ? undefined : k })} aria-current={kind === k ? "true" : undefined} className={cn("rounded-lg px-3 py-1.5 text-[13px]", kind === k ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover")}>
              {t(`finance.kinds.${k}`)}
            </Link>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label={t("finance.status")}>
          {STATUS_FILTERS.map((k) => (
            <Link key={k} href={href({ status: k === "all" ? undefined : k })} aria-current={status === k ? "true" : undefined} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-[13px]", status === k ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover")}>
              {t(k === "all" ? "common.all" : `finance.statuses.${k}`)}
            </Link>
          ))}
        </div>
      </Card>
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt className="h-6 w-6" />} title={t("finance.empty")} body={t("finance.emptyBody")} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((d) => {
              const isOverdue = d.kind === "invoice" && ["sent", "accepted"].includes(d.status as string) && d.due_date && (d.due_date as string) < today;
              return (
                <li key={d.id as string}>
                  <Link href={`/${locale}/finance/${d.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4" data-document={`${d.kind}-${d.number}`}>
                    <span className="w-28 shrink-0 text-[13px] text-muted">
                      {t(`finance.kindShort.${d.kind}`)} #{d.number as number}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{(d.title as string | null) || (d.contact_id ? contactName.get(d.contact_id as string) : null) || "—"}</span>
                    <span className="text-[12.5px] text-subtle">{formatDate(locale, d.issue_date as string)}</span>
                    <Badge tone={isOverdue ? "danger" : DOC_STATUS_TONE[d.status as string] ?? "neutral"}>{t(isOverdue ? "finance.statuses.overdue" : `finance.statuses.${d.status}`)}</Badge>
                    <span className="w-28 text-end font-semibold tabular-nums">{formatCurrency(locale, Number(d.total), d.currency as string)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
