"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Languages, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Switches language by swapping the first path segment (full reload → correct dir/lang). */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() || `/${locale}`;
  const rest = pathname.split("/").slice(2).join("/");
  return (
    <nav aria-label={t("common.language")} className={cn("flex items-center gap-1", className)}>
      <Languages className="h-4 w-4 text-subtle" aria-hidden />
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={`/${l}${rest ? `/${rest}` : ""}`}
          hrefLang={l}
          prefetch={false}
          aria-current={l === locale ? "true" : undefined}
          className={cn(
            "rounded-lg px-2 py-1 text-[13px] transition-colors",
            l === locale ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          {LOCALE_META[l].label}
        </Link>
      ))}
    </nav>
  );
}

function subscribeTheme(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const theme = useSyncExternalStore<Theme>(
    subscribeTheme,
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => "dark",
  );
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      }}
      className={cn("grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-fg", className)}
      aria-label={`${t("common.theme")}: ${t(next === "light" ? "common.light" : "common.dark")}`}
      title={t("common.theme")}
    >
      {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}
