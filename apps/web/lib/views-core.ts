/** Saved views (pure): which entities support them and how filters are stored / turned back into a link. */
export const VIEW_ENTITIES = ["contacts", "companies", "deals", "tasks", "conversations"] as const;
export type ViewEntity = (typeof VIEW_ENTITIES)[number];

const ALLOWED = /^[a-z_]{1,24}$/;

/** Only short, simple query parameters; page / tokens never stored. */
export function cleanViewFilters(f: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f ?? {}).slice(0, 12)) {
    if (!ALLOWED.test(k) || k === "page" || k === "new" || k === "token") continue;
    const val = String(v ?? "").trim().slice(0, 120);
    if (val) out[k] = val;
  }
  return out;
}

export function viewHref(base: string, filters: Record<string, string>): string {
  const p = new URLSearchParams(cleanViewFilters(filters));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Is this view the one currently shown? (same filters, ignoring order and paging) */
export function isActiveView(filters: Record<string, string>, current: Record<string, string | undefined>): boolean {
  const a = cleanViewFilters(filters);
  const b = cleanViewFilters(Object.fromEntries(Object.entries(current).filter(([, v]) => typeof v === "string")) as Record<string, string>);
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length > 0 && ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
