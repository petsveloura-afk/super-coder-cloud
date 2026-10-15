"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type Dictionary, type TFunction } from "./translate";
import { LOCALE_META, type Locale } from "./config";

interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  intl: string;
  t: TFunction;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({ locale, dir: LOCALE_META[locale].dir, intl: LOCALE_META[locale].intl, t: createTranslator(dict) }),
    [locale, dict],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
