import type he from "./dictionaries/he.json";

export type Dictionary = typeof he;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every valid translation key, e.g. "crm.statuses.lead". */
export type TKey = Leaves<Dictionary>;

export type Params = Record<string, string | number>;

export type TFunction = (key: TKey | (string & {}), params?: Params) => string;

export function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Builds a translator. Unknown keys return the key itself (visible in QA,
 * never crashes). Interpolated params are inserted as plain text — React
 * escapes them on render, so no HTML injection is possible.
 */
export function createTranslator(dict: Dictionary): TFunction {
  return (key, params) => {
    const raw = lookup(dict, key) ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
  };
}

/** Human label for an audit action code (e.g. "contacts.update"); falls back to the raw code. */
export function auditLabel(t: TFunction, action: string): string {
  const key = `audit.${action.replace(/\./g, "_")}`;
  const label = t(key);
  return label === key ? action : label;
}
