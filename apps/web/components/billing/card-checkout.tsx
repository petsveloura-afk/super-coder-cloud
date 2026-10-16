"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/primitives";
import { captureCardOrderAction, createCardOrderAction, startPaymentAction } from "@/app/[locale]/(dashboard)/billing/actions";

/**
 * Pay by card INSIDE our page: PayPal's "Debit or Credit Card" button (JS SDK)
 * opens the card form right here — no PayPal window, no PayPal account. The money
 * lands in the business's PayPal. When PayPal can't show the in-page form for this
 * buyer / country, a single fallback button opens PayPal's card page instead.
 */

interface PayPalButtons {
  isEligible: () => boolean;
  render: (el: HTMLElement) => Promise<void>;
  close?: () => Promise<void>;
}
interface PayPalNamespace {
  Buttons: (o: Record<string, unknown>) => PayPalButtons;
  FUNDING: { CARD: string };
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
    __sccPayPalSdk?: Promise<PayPalNamespace>;
  }
}

function loadSdk(src: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (window.__sccPayPalSdk) return window.__sccPayPalSdk;
  window.__sccPayPalSdk = new Promise<PayPalNamespace>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.namespace = "paypal";
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("sdk_missing")));
    s.onerror = () => {
      window.__sccPayPalSdk = undefined;
      reject(new Error("sdk_failed"));
    };
    document.head.appendChild(s);
  });
  return window.__sccPayPalSdk;
}

export function CardCheckout({
  plan,
  planName,
  interval,
  priceLabel,
  currency,
  clientId,
  sdkUrl,
}: {
  plan: string;
  planName: string;
  interval: "month" | "year";
  priceLabel: string;
  currency: string;
  clientId: string;
  sdkUrl: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "fallback" | "paying" | "done">("loading");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let buttons: PayPalButtons | null = null;
    const ppLocale = locale === "en" ? "en_US" : locale === "ar" ? "ar_EG" : "he_IL";
    const src = `${sdkUrl}?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons&enable-funding=card&disable-funding=paylater,venmo&locale=${ppLocale}`;
    loadSdk(src)
      .then(async (paypal) => {
        if (cancelled || !box.current) return;
        buttons = paypal.Buttons({
          fundingSource: paypal.FUNDING.CARD,
          style: { layout: "vertical", color: "black", shape: "rect", label: "pay", height: 48 },
          createOrder: async () => {
            const r = await createCardOrderAction({ locale, plan, interval });
            if (!r.id) {
              toast.error(t(`billing.pay.err.${r.error ?? "paypal_request"}`, {}) || t("billing.providerError"));
              throw new Error(r.error ?? "order_failed");
            }
            return r.id;
          },
          onApprove: async (data: { orderID: string }) => {
            setState("paying");
            const r = await captureCardOrderAction({ locale, orderId: data.orderID });
            if (r.ok && r.status === "COMPLETED") {
              setState("done");
              toast.success(t("billing.pay.cardPaid"));
              setOpen(false);
              router.push(`/${locale}/billing?checkout=success`);
              router.refresh();
            } else if (r.ok) {
              setOpen(false);
              router.push(`/${locale}/billing?checkout=pending`);
            } else {
              setState("ready");
              toast.error(t(`billing.pay.err.${r.error ?? "capture_failed"}`));
            }
          },
          onError: (err: unknown) => {
            console.error("paypal card error", err);
            toast.error(t("billing.pay.err.capture_failed"));
            setState("ready");
          },
        });
        if (!buttons.isEligible()) {
          setState("fallback");
          return;
        }
        box.current.innerHTML = "";
        await buttons.render(box.current);
        if (!cancelled) setState("ready");
      })
      .catch(() => !cancelled && setState("fallback"));
    return () => {
      cancelled = true;
      buttons?.close?.().catch(() => undefined);
    };
  }, [open, sdkUrl, clientId, currency, locale, plan, interval, router, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setState("loading");
        setOpen(o);
      }}
      title={t("billing.pay.cardTitle", { plan: planName })}
      description={t("billing.pay.cardDesc")}
      trigger={
        <button type="button" data-method="card_inline" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0f172a] px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:brightness-125">
          <CreditCard className="h-4 w-4 shrink-0" />
          <span className="flex flex-col items-center leading-tight">
            <span>{t("billing.pay.paypalCard")}</span>
            <span className="text-[10.5px] font-normal opacity-80">{t("billing.pay.cardInlineSub")}</span>
          </span>
        </button>
      }
    >
      <div className="space-y-4" data-testid="card-checkout">
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
          <span className="font-medium">{planName}</span>
          <span className="font-bold tabular-nums" dir="ltr">
            {priceLabel}
          </span>
        </div>
        {state === "loading" || state === "paying" ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted">
            <Spinner /> {state === "paying" ? t("billing.pay.processing") : t("common.loading")}
          </div>
        ) : null}
        <div ref={box} className={state === "fallback" ? "hidden" : "min-h-12"} data-testid="card-fields" />
        {state === "fallback" ? (
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
        <p className="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-subtle">
          <Lock className="h-3.5 w-3.5" /> {t("billing.pay.cardSecure")} <ShieldCheck className="h-3.5 w-3.5" />
        </p>
      </div>
    </Dialog>
  );
}
