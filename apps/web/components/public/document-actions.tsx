"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, ExternalLink, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input } from "@/components/ui/primitives";
import { acceptPublicQuote, startDocumentPayment } from "@/app/[locale]/(public)/actions";

export function PrintButton() {
  const { t } = useI18n();
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> {t("finance.print")}
    </Button>
  );
}

/** Customer-side actions on a shared quote / invoice: accept (typed name) or pay. */
export function DocumentPublicActions({
  token,
  kind,
  canAccept,
  canPay,
  online,
  paymentUrl,
  balanceLabel,
}: {
  token: string;
  kind: "quote" | "invoice";
  canAccept: boolean;
  canPay: boolean;
  online: boolean;
  paymentUrl: string | null;
  balanceLabel: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (kind === "quote" && canAccept) {
    return (
      <form
        className="flex flex-col gap-3 rounded-2xl border border-line p-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await acceptPublicQuote({ token, name });
            if (!r.ok) setError(r.error ?? "errors.generic");
            else router.refresh();
          });
        }}
      >
        <Field label={t("finance.acceptName")} htmlFor="acc-name" error={error ? t(error) : undefined} className="flex-1">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Button type="submit" loading={pending}>
          <CheckCircle2 className="h-4 w-4" /> {t("finance.acceptQuote")}
        </Button>
      </form>
    );
  }
  if (kind === "invoice" && canPay && (online || paymentUrl)) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {online ? (
          <Button
            size="lg"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await startDocumentPayment({ token, locale });
                if (r.ok && r.redirect) window.location.href = r.redirect;
                else setError(r.error ?? "errors.generic");
              })
            }
          >
            <CreditCard className="h-4 w-4" /> {t("finance.payOnline", { amount: balanceLabel })}
          </Button>
        ) : null}
        {paymentUrl ? (
          <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-2 rounded-xl border border-line px-6 text-[15px] font-medium hover:bg-surface-hover">
            <ExternalLink className="h-4 w-4" /> {t("finance.payLink")}
          </a>
        ) : null}
        {error ? (
          <p role="alert" className="w-full text-sm text-danger">
            {t(error)}
          </p>
        ) : null}
      </div>
    );
  }
  return null;
}
