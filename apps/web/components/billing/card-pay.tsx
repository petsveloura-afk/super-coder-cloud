"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bitcoin, CreditCard, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Spinner } from "@/components/ui/primitives";
import { captureCardOrderAction, createCardOrderAction, startPaymentAction } from "@/app/[locale]/(dashboard)/billing/actions";
import { loadSdk, type PayPalButtons } from "./card-checkout";

/**
 * Wave 14 — the card payment on its own page (/billing/checkout), not inside a pop-up
 * sheet: a modal locks focus and blocks PayPal's own windows (3-D Secure, card
 * verification), which broke the card form on phones.
 *
 * 1. PayPal Card Fields (card number / expiry / CVV as fields of our page) when the
 *    PayPal account is eligible (advanced card payments);
 * 2. otherwise PayPal's "Debit or Credit Card" button, which opens the card form in
 *    the page;
 * 3. if PayPal can't load, one button to PayPal's secure card page (guest checkout).
 * Crypto is a second tab of the same checkout.
 */
interface CardFieldsInstance {
  isEligible: () => boolean;
  NameField: (o?: Record<string, unknown>) => { render: (el: HTMLElement | string) => Promise<void> };
  NumberField: (o?: Record<string, unknown>) => { render: (el: HTMLElement | string) => Promise<void> };
  ExpiryField: (o?: Record<string, unknown>) => { render: (el: HTMLElement | string) => Promise<void> };
  CVVField: (o?: Record<string, unknown>) => { render: (el: HTMLElement | string) => Promise<void> };
  submit: () => Promise<void>;
}
type PayPalWithFields = { CardFields?: (o: Record<string, unknown>) => CardFieldsInstance };

export function CardPay({
  plan,
  interval,
  currency,
  clientId,
  sdkUrl,
  crypto,
}: {
  plan: string;
  interval: "month" | "year";
  currency: string;
  clientId: string;
  sdkUrl: string;
  crypto: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<"card" | "crypto">("card");
  const [mode, setMode] = useState<"loading" | "fields" | "button" | "fallback" | "paying" | "done">("loading");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<CardFieldsInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    let buttons: PayPalButtons | null = null;
    const ppLocale = locale === "en" ? "en_US" : locale === "ar" ? "ar_EG" : "he_IL";
    const src = `${sdkUrl}?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons,card-fields&enable-funding=card&disable-funding=paylater,venmo&locale=${ppLocale}`;
    const createOrder = async () => {
      const r = await createCardOrderAction({ locale, plan, interval });
      if (!r.id) {
        toast.error(t(`billing.pay.err.${r.error ?? "paypal_request"}`) || t("billing.providerError"));
        throw new Error(r.error ?? "order_failed");
      }
      return r.id;
    };
    const onApprove = async (data: { orderID: string }) => {
      setMode("paying");
      const r = await captureCardOrderAction({ locale, orderId: data.orderID });
      if (r.ok && r.status === "COMPLETED") {
        setMode("done");
        toast.success(t("billing.pay.cardPaid"));
        router.push(`/${locale}/billing?checkout=success`);
        router.refresh();
      } else if (r.ok) {
        router.push(`/${locale}/billing?checkout=pending`);
      } else {
        toast.error(t(`billing.pay.err.${r.error ?? "capture_failed"}`));
        setMode(fieldsRef.current ? "fields" : "button");
      }
    };
    const onError = (err: unknown) => {
      console.error("paypal card error", err);
      toast.error(t("billing.pay.err.capture_failed"));
      setMode(fieldsRef.current ? "fields" : "button");
    };
    loadSdk(src)
      .then(async (paypal) => {
        if (cancelled) return;
        // 1) card fields inside our own form
        const pf = paypal as unknown as PayPalWithFields;
        if (typeof pf.CardFields === "function") {
          try {
            const style = {
              input: { "font-size": "16px", "font-family": "system-ui, sans-serif", color: document.documentElement.getAttribute("data-theme") === "light" ? "#0f172a" : "#e8ecf5", padding: "12px" },
              ".invalid": { color: "#dc2626" },
            };
            const cf = pf.CardFields({ createOrder, onApprove, onError, style });
            if (cf.isEligible()) {
              fieldsRef.current = cf;
              setMode("fields");
              await Promise.all([
                cf.NameField({ placeholder: t("billing.pay.cardName") }).render("#cc-name"),
                cf.NumberField({ placeholder: "1234 5678 9012 3456" }).render("#cc-number"),
                cf.ExpiryField({ placeholder: "MM/YY" }).render("#cc-expiry"),
                cf.CVVField({ placeholder: "CVV" }).render("#cc-cvv"),
              ]);
              return;
            }
          } catch (e) {
            console.warn("card fields unavailable, using the card button", e);
            fieldsRef.current = null;
          }
        }
        // 2) PayPal's card button (opens the card form in the page)
        if (!box.current) return;
        buttons = paypal.Buttons({
          fundingSource: paypal.FUNDING.CARD,
          style: { layout: "vertical", color: "black", shape: "rect", label: "pay", height: 50 },
          createOrder,
          onApprove,
          onError,
        });
        if (!buttons.isEligible()) return setMode("fallback");
        box.current.innerHTML = "";
        await buttons.render(box.current);
        if (!cancelled) setMode("button");
      })
      .catch(() => !cancelled && setMode("fallback"));
    return () => {
      cancelled = true;
      buttons?.close?.().catch(() => undefined);
    };
    // the SDK is set up once per page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkUrl, clientId, currency, plan, interval]);

  const payWithFields = async () => {
    if (!fieldsRef.current || busy) return;
    setBusy(true);
    try {
      await fieldsRef.current.submit();
    } catch (e) {
      console.error("card fields submit", e);
      toast.error(t("billing.pay.err.cardCheck"));
    } finally {
      setBusy(false);
    }
  };

  const fieldBox = "min-h-12 rounded-xl border border-line bg-elevated px-1";
  return (
    <div className="space-y-4" data-testid="card-checkout">
      {crypto ? (
        <div role="tablist" aria-label={t("billing.pay.methodTabs")} className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 ring-1 ring-line" data-testid="checkout-tabs">
          {(["card", "crypto"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} onClick={() => setTab(k)} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition ${tab === k ? "bg-elevated text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"}`}>
              {k === "card" ? <CreditCard className="h-4 w-4" /> : <Bitcoin className="h-4 w-4" />}
              {k === "card" ? t("billing.pay.tabCard") : t("billing.pay.tabCrypto")}
            </button>
          ))}
        </div>
      ) : null}

      {crypto && tab === "crypto" ? (
        <form action={startPaymentAction} className="space-y-3" data-testid="crypto-tab">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="plan" value={plan} />
          <input type="hidden" name="interval" value={interval} />
          <input type="hidden" name="method" value="crypto" />
          <p className="text-center text-[13px] leading-relaxed text-muted">{t("billing.pay.cryptoTabHint")}</p>
          <button type="submit" data-method="crypto_inline" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface text-sm font-semibold hover:bg-surface-hover">
            <Bitcoin className="h-4 w-4" /> {t("billing.pay.cryptoContinue")}
          </button>
        </form>
      ) : null}

      <div className={crypto && tab === "crypto" ? "hidden" : "space-y-4"}>
        {mode === "loading" || mode === "paying" || mode === "done" ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted" role="status">
            <Spinner /> {mode === "loading" ? t("common.loading") : t("billing.pay.processing")}
          </div>
        ) : null}

        {/* 1) card fields (shown only when PayPal offers them for this account) */}
        <div className={mode === "fields" ? "space-y-3" : "hidden"} data-testid="card-fields-form">
          <label className="block space-y-1 text-[12.5px] text-muted">
            <span>{t("billing.pay.cardName")}</span>
            <div id="cc-name" className={fieldBox} />
          </label>
          <label className="block space-y-1 text-[12.5px] text-muted">
            <span>{t("billing.pay.cardNumber")}</span>
            <div id="cc-number" className={fieldBox} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-[12.5px] text-muted">
              <span>{t("billing.pay.cardExpiry")}</span>
              <div id="cc-expiry" className={fieldBox} />
            </label>
            <label className="block space-y-1 text-[12.5px] text-muted">
              <span>CVV</span>
              <div id="cc-cvv" className={fieldBox} />
            </label>
          </div>
          <button type="button" onClick={payWithFields} disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent-solid text-[15px] font-semibold text-white hover:bg-accent-solid-hover disabled:opacity-60" data-testid="card-fields-pay">
            {busy ? <Spinner /> : <Lock className="h-4 w-4" />} {t("billing.pay.payNow")}
          </button>
        </div>

        {/* 2) PayPal's card button */}
        <div ref={box} className={mode === "button" ? "min-h-12" : "hidden"} data-testid="card-fields" />

        {/* 3) fallback: PayPal's secure card page */}
        {mode === "fallback" ? (
          <form action={startPaymentAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="plan" value={plan} />
            <input type="hidden" name="interval" value={interval} />
            <input type="hidden" name="method" value="paypal_card" />
            <p className="mb-2 text-center text-[12.5px] text-muted">{t("billing.pay.cardFallback")}</p>
            <button type="submit" data-method="paypal_card" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0f172a] text-sm font-semibold text-white">
              <CreditCard className="h-4 w-4" /> {t("billing.pay.cardContinue")}
            </button>
          </form>
        ) : null}

        {mode === "button" || mode === "fields" ? (
          <details className="text-center text-[12.5px] text-muted">
            <summary className="cursor-pointer hover:text-fg">{t("billing.pay.trouble")}</summary>
            <form action={startPaymentAction} className="mt-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="plan" value={plan} />
              <input type="hidden" name="interval" value={interval} />
              <input type="hidden" name="method" value="paypal_card" />
              <button type="submit" data-method="paypal_card_alt" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover">
                <CreditCard className="h-4 w-4" /> {t("billing.pay.cardContinue")}
              </button>
            </form>
          </details>
        ) : null}

        <p className="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-subtle">
          <Lock className="h-3.5 w-3.5" /> {t("billing.pay.cardSecure")} <ShieldCheck className="h-3.5 w-3.5" />
        </p>
      </div>
    </div>
  );
}
