"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

export default function NotFound() {
  const { t, locale } = useI18n();
  return (
    <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
      <div>
        <p className="text-6xl font-black tracking-tight text-accent" dir="ltr">404</p>
        <h1 className="mt-3 text-xl font-bold">{t("errors.notFound")}</h1>
        <p className="mt-1 text-sm text-muted">{t("errors.notFoundBody")}</p>
        <Link href={`/${locale}/overview`} className="mt-6 inline-flex h-10 items-center rounded-xl bg-accent-solid px-4 text-sm font-medium text-white">
          {t("errors.goHome")}
        </Link>
      </div>
    </div>
  );
}
