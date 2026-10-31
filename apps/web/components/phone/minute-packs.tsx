"use client";

import { useTransition } from "react";
import { Bitcoin, CreditCard, Timer } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { buyCreditPackAction } from "@/app/[locale]/(dashboard)/billing/credit-actions";
import type { CreditPack } from "@/lib/billing/packs-core";

/** Wave 59 — phone minute packs: bought in the app, used after the monthly minutes, never expire. */
export function MinutePacks({ packs, balance, canBuy, methods }: { packs: CreditPack[]; balance: number; canBuy: boolean; methods: { paypal: boolean; crypto: boolean } }) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const fmt = (n: number) => new Intl.NumberFormat(locale === "en" ? "en-US" : locale === "ar" ? "ar" : "he-IL").format(n);
  const usd = (n: number) => new Intl.NumberFormat(locale === "en" ? "en-US" : locale === "ar" ? "ar" : "he-IL", { style: "currency", currency: "USD" }).format(n);
  const buy = (pack: string, method: "paypal" | "crypto") =>
    start(async () => {
      const res = await buyCreditPackAction({ locale, pack, method });
      if (res.error || !res.data?.url) return void toast.error(t(res.error ?? "errors.generic"));
      window.location.href = res.data.url;
    });
  return (
    <div className="space-y-3 p-5" data-testid="minute-packs">
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Timer className="h-4 w-4 text-accent" aria-hidden /> {t("phone.packs.balance", { n: fmt(balance) })}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {packs.map((p) => (
          <div key={p.key} className="lift flex flex-col gap-1.5 rounded-2xl border border-line p-3">
            <p className="text-[17px] font-bold">{t("phone.packs.minutes", { n: fmt(p.credits) })}</p>
            <p className="text-[12.5px] text-muted" dir="ltr">
              {usd(p.usd)}
            </p>
            {canBuy ? (
              <div className="mt-auto flex flex-wrap gap-1.5">
                {methods.paypal ? (
                  <Button size="sm" loading={pending} onClick={() => buy(p.key, "paypal")}>
                    <CreditCard className="h-4 w-4" aria-hidden /> {t("credits.buyCard")}
                  </Button>
                ) : null}
                {methods.crypto ? (
                  <Button size="sm" variant="secondary" loading={pending} onClick={() => buy(p.key, "crypto")}>
                    <Bitcoin className="h-4 w-4" aria-hidden /> {t("credits.buyCrypto")}
                  </Button>
                ) : null}
                {!methods.paypal && !methods.crypto ? <span className="text-[12px] text-muted">{t("billing.notConfigured")}</span> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
