import "server-only";
import { notFound } from "next/navigation";
import { createTranslator, type Dictionary } from "./translate";
import { isLocale, type Locale } from "./config";

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  he: () => import("./dictionaries/he.json").then((m) => m.default),
  ar: () => import("./dictionaries/ar.json").then((m) => m.default as Dictionary),
  en: () => import("./dictionaries/en.json").then((m) => m.default as Dictionary),
};

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  return loaders[locale]();
}

/** Resolve the `[locale]` route param, 404 on unsupported values. */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}

export async function getT(locale: Locale) {
  const dict = await getDictionary(locale);
  return { dict, t: createTranslator(dict) };
}
