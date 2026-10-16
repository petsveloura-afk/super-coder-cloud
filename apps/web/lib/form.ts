import { isLocale, type Locale } from "@/lib/i18n/config";

/** Locale posted by every form (hidden input); falls back to Hebrew. */
export function formLocale(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

/** String form value ("" when missing or not a string). */
export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/** Builds a plain object of string values for the given keys (for zod). */
export function pick(fd: FormData, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = str(fd, k);
  return out;
}
