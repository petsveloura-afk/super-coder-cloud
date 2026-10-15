export const LOCALES = ["he", "ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "he";
export const LOCALE_COOKIE = "scc_locale";

export const LOCALE_META: Record<Locale, { label: string; dir: "rtl" | "ltr"; intl: string }> = {
  he: { label: "עברית", dir: "rtl", intl: "he-IL" },
  ar: { label: "العربية", dir: "rtl", intl: "ar" },
  en: { label: "English", dir: "ltr", intl: "en-US" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: Locale) {
  return LOCALE_META[locale].dir;
}

/** Pick the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((x) => x.tag && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (base === "iw") return "he"; // legacy Hebrew code
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
