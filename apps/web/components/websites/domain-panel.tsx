"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, CreditCard, ExternalLink, Globe, Link2, Lock, RefreshCw, Search, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Field, Input, Select, Spinner } from "@/components/ui/primitives";
import { loadSdk, type PayPalButtons } from "@/components/billing/card-checkout";
import { captureDomainOrderAction, checkDomainAction, connectDomainAction, createDomainOrderAction, disconnectDomainAction, searchDomainsAction } from "@/app/[locale]/(dashboard)/websites/domain-actions";
import { cn } from "@/lib/utils";

/**
 * Wave 13 — the site's address: the free public link, and (paid plans) a custom
 * domain — buy a new one (searched, priced with the platform's commission, paid by
 * card inside the page) or connect one the business already owns (DNS records +
 * automatic verification).
 */
export interface DomainPanelProps {
  siteId: string;
  published: boolean;
  publicUrl: string;
  allowed: boolean;
  configured: boolean;
  domain: string | null;
  status: "pending" | "active" | "error" | null;
  records: { type: string; name: string; value: string }[];
  orders: { id: string; domain: string; status: string; price: number; currency: string; created_at: string; error: string | null }[];
  sdk: { clientId: string; sdkUrl: string } | null;
}

interface Offer {
  domain: string;
  available: boolean;
  price?: number;
  renewal?: number;
  currency: "USD";
  premium?: boolean;
}

const COUNTRIES = ["IL", "US", "GB", "DE", "FR", "AE", "CA", "AU", "NL", "ES", "IT"];

function CopyBtn({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-fg"
      aria-label={t("common.copy")}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => toast.success(t("common.copied")));
      }}
    >
      <Copy className="h-4 w-4" />
    </button>
  );
}

function DomainPay({ siteId, orderId, approveUrl, sdk, onDone }: { siteId: string; orderId: string; approveUrl: string | null; sdk: DomainPanelProps["sdk"]; onDone: () => void }) {
  const { t, locale } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "fallback" | "paying">(sdk ? "loading" : "fallback");
  useEffect(() => {
    if (!sdk) return;
    let cancelled = false;
    let buttons: PayPalButtons | null = null;
    const ppLocale = locale === "en" ? "en_US" : locale === "ar" ? "ar_EG" : "he_IL";
    loadSdk(`${sdk.sdkUrl}?client-id=${encodeURIComponent(sdk.clientId)}&currency=USD&intent=capture&components=buttons&enable-funding=card&disable-funding=paylater,venmo&locale=${ppLocale}`)
      .then(async (paypal) => {
        if (cancelled || !box.current) return;
        buttons = paypal.Buttons({
          fundingSource: paypal.FUNDING.CARD,
          style: { layout: "vertical", color: "black", shape: "rect", label: "pay", height: 48 },
          createOrder: async () => orderId,
          onApprove: async () => {
            setState("paying");
            const r = await captureDomainOrderAction({ locale, siteId, paypalOrderId: orderId });
            if (r.error) {
              toast.error(t(r.error));
              setState("ready");
              return;
            }
            toast.success(t(r.message ?? "websites.domain.bought"));
            onDone();
          },
          onError: () => {
            toast.error(t("billing.pay.err.capture_failed"));
            setState("ready");
          },
        });
        if (!buttons.isEligible()) return setState("fallback");
        box.current.innerHTML = "";
        await buttons.render(box.current);
        if (!cancelled) setState("ready");
      })
      .catch(() => !cancelled && setState("fallback"));
    return () => {
      cancelled = true;
      buttons?.close?.().catch(() => undefined);
    };
  }, [sdk, orderId, siteId, locale, onDone, t]);
  return (
    <div className="space-y-3" data-testid="domain-pay">
      {state === "loading" || state === "paying" ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted">
          <Spinner /> {state === "paying" ? t("websites.domain.registering") : t("common.loading")}
        </div>
      ) : null}
      <div ref={box} className={state === "fallback" ? "hidden" : "min-h-12"} />
      {state === "fallback" && approveUrl ? (
        <a href={approveUrl} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0f172a] text-sm font-semibold text-white" data-testid="domain-pay-redirect">
          <CreditCard className="h-4 w-4" /> {t("billing.pay.cardContinue")}
        </a>
      ) : null}
    </div>
  );
}

export function DomainPanel(p: DomainPanelProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<"buy" | "connect">("buy");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Offer[] | null>(null);
  const [pick, setPick] = useState<Offer | null>(null);
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "", address1: "", city: "", state: "", zip: "", country: "IL", companyName: "" });
  const [order, setOrder] = useState<{ id: string; approveUrl: string | null; price: number } | null>(null);
  const [own, setOwn] = useState("");
  const [pending, start] = useTransition();
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  if (!p.allowed) {
    return (
      <div className="space-y-4" data-testid="domain-panel">
        <PublicLink {...p} />
        <Card className="flex flex-wrap items-center gap-3 border-gold/30 p-4" data-testid="upgrade-site_custom_domain">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold-soft text-gold">
            <Lock className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("plans.locked.site_custom_domain.title")}</p>
            <p className="text-[12.5px] text-muted">{t("plans.locked.site_custom_domain.body", { plan: t("billing.plans.pro.name") })}</p>
          </div>
          <Link href={`/${locale}/billing`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent-solid px-3.5 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4" /> {t("plans.locked.cta", { plan: t("billing.plans.pro.name") })}
          </Link>
        </Card>
      </div>
    );
  }

  const search = () =>
    start(async () => {
      setPick(null);
      setOrder(null);
      const r = await searchDomainsAction({ locale, siteId: p.siteId, query });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      setResults(r.data.results);
    });
  const buy = () =>
    start(async () => {
      if (!pick) return;
      const r = await createDomainOrderAction({ locale, siteId: p.siteId, domain: pick.domain, contact: { ...contact, companyName: contact.companyName || undefined } });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      setOrder({ id: r.data.paypalOrderId, approveUrl: r.data.approveUrl, price: r.data.price });
    });

  return (
    <div className="space-y-4" data-testid="domain-panel">
      <PublicLink {...p} />

      {p.domain ? (
        <Card className="p-4 sm:p-5" data-testid="domain-current">
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="h-5 w-5 text-accent" />
            <span className="font-semibold" dir="ltr">
              {p.domain}
            </span>
            <Badge tone={p.status === "active" ? "success" : "warning"}>{t(`websites.domain.status.${p.status ?? "pending"}`)}</Badge>
            <span className="flex-1" />
            {p.status === "active" ? (
              <a href={`https://${p.domain}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover">
                <ExternalLink className="h-4 w-4" /> {t("websites.view")}
              </a>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await checkDomainAction({ locale, siteId: p.siteId });
                  if (r.error) return void toast.error(t(r.error));
                  toast.success(t(r.message ?? "common.saved"));
                  router.refresh();
                })
              }
              data-testid="domain-check"
            >
              <RefreshCw className="h-4 w-4" /> {t("websites.domain.check")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                window.confirm(t("websites.domain.removeConfirm")) &&
                start(async () => {
                  const r = await disconnectDomainAction({ locale, siteId: p.siteId });
                  if (r.error) return void toast.error(t(r.error));
                  toast.success(t(r.message ?? "common.saved"));
                  router.refresh();
                })
              }
              aria-label={t("websites.domain.remove")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {p.status !== "active" && p.records.length ? (
            <div className="mt-4">
              <p className="mb-2 text-[13px] text-muted">{t("websites.domain.dnsHint")}</p>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[28rem] text-[13px]" dir="ltr">
                  <thead className="bg-surface-hover text-start text-muted">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">Type</th>
                      <th className="px-3 py-2 text-start font-medium">Name</th>
                      <th className="px-3 py-2 text-start font-medium">Value</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.records.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="px-3 py-2 font-mono">{r.type}</td>
                        <td className="px-3 py-2 font-mono">{r.name}</td>
                        <td className="px-3 py-2 font-mono break-all">{r.value}</td>
                        <td className="px-1">
                          <CopyBtn text={r.value} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-subtle">{t("websites.domain.dnsWait")}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {!p.configured ? (
        <Card className="p-4 text-sm text-muted" data-testid="domain-not-configured">
          {t("websites.domain.err.notConfigured")}
        </Card>
      ) : (
        <Card className="p-4 sm:p-5">
          <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 ring-1 ring-line">
            {(["buy", "connect"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} data-domain-tab={k} onClick={() => setMode(k)} className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium", mode === k ? "bg-elevated shadow-sm ring-1 ring-line" : "text-muted hover:text-fg")}>
                {k === "buy" ? <ShoppingCart className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                {t(`websites.domain.tab.${k}`)}
              </button>
            ))}
          </div>

          {mode === "buy" ? (
            <div className="space-y-4">
              <p className="text-[13px] text-muted">{t("websites.domain.buyHint")}</p>
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && query.trim().length > 1 && search()}
                  placeholder={t("websites.domain.searchPlaceholder")}
                  aria-label={t("websites.domain.search")}
                  dir="ltr"
                  data-testid="domain-search"
                />
                <Button onClick={search} loading={pending && !pick} disabled={query.trim().length < 2} data-testid="domain-search-run">
                  <Search className="h-4 w-4" /> {t("websites.domain.search")}
                </Button>
              </div>
              {results ? (
                <ul className="divide-y divide-line rounded-xl border border-line" data-testid="domain-results">
                  {results.map((r) => (
                    <li key={r.domain} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-domain={r.domain}>
                      <span className="font-medium" dir="ltr">
                        {r.domain}
                      </span>
                      {r.available && r.price ? (
                        <>
                          <span className="text-[12px] text-success">{t("websites.domain.available")}</span>
                          <span className="flex-1" />
                          <span className="font-semibold tabular-nums" dir="ltr">
                            {fmt(r.price)}
                            <span className="text-[11px] font-normal text-muted"> / {t("websites.domain.year")}</span>
                          </span>
                          <Button size="sm" variant={pick?.domain === r.domain ? "primary" : "secondary"} onClick={() => setPick(r)} data-testid="domain-pick">
                            {pick?.domain === r.domain ? <CheckCircle2 className="h-4 w-4" /> : null} {t("websites.domain.choose")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1" />
                          <span className="text-[12px] text-subtle">{t(r.premium ? "websites.domain.premium" : "websites.domain.taken")}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {pick && !order ? (
                <div className="space-y-3 rounded-xl border border-accent/30 bg-accent-soft/30 p-4" data-testid="domain-contact">
                  <p className="text-sm font-semibold">
                    {t("websites.domain.contactTitle", { domain: pick.domain })} · <span dir="ltr">{fmt(pick.price ?? 0)}</span>
                  </p>
                  <p className="text-[12.5px] text-muted">{t("websites.domain.contactHint")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["firstName", "lastName", "email", "phone", "address1", "city", "state", "zip", "companyName"] as const).map((k) => (
                      <Field key={k} label={t(`websites.domain.contact.${k}`)} htmlFor={`dc-${k}`}>
                        <Input id={`dc-${k}`} dir={["email", "phone", "zip"].includes(k) ? "ltr" : undefined} value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} />
                      </Field>
                    ))}
                    <Field label={t("websites.domain.contact.country")} htmlFor="dc-country">
                      <Select id="dc-country" value={contact.country} onChange={(e) => setContact({ ...contact, country: e.target.value })}>
                        {COUNTRIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <ul className="list-disc space-y-1 ps-5 text-[12px] text-muted">
                    <li>{t("websites.domain.noteYear", { renewal: pick.renewal ? fmt(Math.max(pick.renewal, pick.price ?? 0)) : "—" })}</li>
                    <li>{t("websites.domain.noteRefund")}</li>
                  </ul>
                  <Button onClick={buy} loading={pending} data-testid="domain-buy">
                    <CreditCard className="h-4 w-4" /> {t("websites.domain.payNow", { price: fmt(pick.price ?? 0) })}
                  </Button>
                </div>
              ) : null}

              {order ? (
                <div className="space-y-2 rounded-xl border border-line p-4">
                  <p className="text-sm font-semibold">
                    {t("websites.domain.payTitle", { domain: pick?.domain ?? "" })} · <span dir="ltr">{fmt(order.price)}</span>
                  </p>
                  <DomainPay
                    siteId={p.siteId}
                    orderId={order.id}
                    approveUrl={order.approveUrl}
                    sdk={p.sdk}
                    onDone={() => {
                      setOrder(null);
                      setPick(null);
                      setResults(null);
                      router.refresh();
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-muted">{t("websites.domain.connectHint")}</p>
              <div className="flex gap-2">
                <Input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="my-business.co.il" aria-label={t("websites.domain.yourDomain")} dir="ltr" data-testid="domain-own" />
                <Button
                  loading={pending}
                  disabled={own.trim().length < 4}
                  onClick={() =>
                    start(async () => {
                      const r = await connectDomainAction({ locale, siteId: p.siteId, domain: own });
                      if (r.error) return void toast.error(t(r.error));
                      toast.success(t(r.message ?? "common.saved"));
                      setOwn("");
                      router.refresh();
                    })
                  }
                  data-testid="domain-connect"
                >
                  <Link2 className="h-4 w-4" /> {t("websites.domain.connect")}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {p.orders.length ? (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">{t("websites.domain.orders")}</h3>
          <ul className="divide-y divide-line text-[13px]" data-testid="domain-orders">
            {p.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
                <span dir="ltr" className="font-medium">
                  {o.domain}
                </span>
                <Badge tone={o.status === "active" ? "success" : o.status === "failed" ? "danger" : "neutral"}>{t(`websites.domain.orderStatus.${o.status}`)}</Badge>
                <span className="flex-1" />
                <span className="tabular-nums" dir="ltr">
                  {fmt(o.price)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function PublicLink(p: DomainPanelProps) {
  const { t } = useI18n();
  return (
    <Card className="p-4 sm:p-5" data-testid="public-link">
      <h2 className="font-semibold">{t("websites.domain.publicTitle")}</h2>
      <p className="mb-3 text-[12.5px] text-muted">{p.published ? t("websites.domain.publicHint") : t("websites.domain.publishFirst")}</p>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" dir="ltr">
          {p.publicUrl}
        </span>
        <CopyBtn text={p.publicUrl} />
        {p.published ? (
          <a href={p.publicUrl} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-fg" aria-label={t("websites.view")}>
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </Card>
  );
}
