import type { ReactNode } from "react";
import { BrandLockup } from "@/components/layout/brand";
import { LanguageSwitcher, ThemeToggle } from "@/components/layout/locale-theme";
import { getT, resolveLocale } from "@/lib/i18n/server";

export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const { t } = await getT(locale);
  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <BrandLockup />
        <div className="flex items-center gap-1">
          <LanguageSwitcher className="hidden sm:flex" />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-10 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
      <footer className="flex flex-col items-center gap-3 px-5 pb-6 text-[12px] text-subtle">
        <LanguageSwitcher className="sm:hidden" />
        <span>{t("app.tagline")}</span>
      </footer>
    </div>
  );
}
