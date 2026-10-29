"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

/** Locale-level boundary: public pages (/q, /s, /chat, …) show a branded, translated error instead of Next's generic one. */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid min-h-[60dvh] place-items-center px-6 text-center" role="alert">
      <div>
        <AlertTriangle className="mx-auto h-8 w-8 text-danger" aria-hidden />
        <h1 className="mt-3 text-xl font-bold">{t("errors.generic")}</h1>
        {error.digest ? <p className="mt-1 text-xs text-muted" dir="ltr">ref: {error.digest}</p> : null}
        <button type="button" onClick={reset} className="mt-6 inline-flex h-10 items-center rounded-xl bg-accent-solid px-4 text-sm font-medium text-white">
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
}
