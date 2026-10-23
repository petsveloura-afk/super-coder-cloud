"use client";

import { useTransition } from "react";
import { Bitcoin, CreditCard, Zap } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card } from "@/components/ui/primitives";
import { buyCreditPackAction } from "@/app/[locale]/(dashboard)/billing/credit-actions";
import type { CreditPack } from "@/lib/billing/packs-core";

/** Wave 18 — extra AI credits that never expire (used after the monthly allowance). */
export function CreditPacksCard({ balance, packs, canBuy, methods, status }: { balance: number; packs: CreditPack[]; canBuy: boolean; methods: { paypal: boolean; crypto: boolean }; status: string | null }) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const fmt = (n: number) => new Intl.NumberFormat(locale === "en" ? "en-US" : locale === "ar" ? "ar" : "he-IL").format(n);
  const usd = (n: number) => new Intl.NumberFormat(locale === "en" ? "en-US" : locale === "ar" ? "ar" : "he-IL", { style: "currency", currency: "USD" }).format(n);
  const buy = (pack: string, method: "paypal" | "crypto") =>
    start(async () => {
      const res = await buyCreditPackAction({ locale, pack, method });
      if (res.error || !res.data?.url) {
        toast.error(t(res.error ?? "errors.generic"));
        return;
      }
      window.location.href = res.data.url;
    });
  return (
    <Card className="space-y-4 p-5" data-testid="credit-packs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Zap className="h-4 w-4 text-gold" /> {t("credits.title")}
        </h2>
        <span className="rounded-full bg-elevated px-3 py-1 text-[13px]" data-testid="pack-balance">
          {t("credits.balance", { n: fmt(balance) })}
        </span>
      </div>
      <p className="text-[13px] text-muted">{t("credits.hint")}</p>
      {status === "ok" ? <p role="status" className="rounded-xl border border-success/30 bg-success-soft p-3 text-[13px] text-success">{t("credits.added")}</p> : null}
      {status === "processing" ? <p role="status" className="rounded-xl border border-line bg-elevated p-3 text-[13px]">{t("credits.processing")}</p> : null}
      {status === "error" ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">{t("credits.failed")}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {packs.map((p) => (
          <div key={p.key} className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <p className="text-lg font-bold">{t("credits.packCredits", { n: fmt(p.credits) })}</p>
            <p className="text-[13px] text-muted" dir="ltr">
              {usd(p.usd)}
            </p>
            {canBuy ? (
              <div className="mt-auto flex flex-wrap gap-2">
                {methods.paypal ? (
                  <Button size="sm" loading={pending} onClick={() => buy(p.key, "paypal")}>
                    <CreditCard className="h-4 w-4" /> {t("credits.buyCard")}
                  </Button>
                ) : null}
                {methods.crypto ? (
                  <Button size="sm" variant="secondary" loading={pending} onClick={() => buy(p.key, "crypto")}>
                    <Bitcoin className="h-4 w-4" /> {t("credits.buyCrypto")}
                  </Button>
                ) : null}
                {!methods.paypal && !methods.crypto ? <span className="text-[12px] text-subtle">{t("billing.notConfigured")}</span> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
