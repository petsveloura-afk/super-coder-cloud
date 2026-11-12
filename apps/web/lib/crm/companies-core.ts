/**
 * Round 12 — companies, smarter (pure, unit-tested).
 *   • companies found in the contacts: contacts that have a company name (or a business e-mail domain) but are not linked
 *     to a company are grouped into suggested companies — one click creates them and links the contacts
 *   • sorting and filtering of the companies list
 *   • the numbers per company: contacts, open deals, pipeline value, won value
 */

/** e-mail providers that are not a company */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.il", "hotmail.com", "hotmail.co.il", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "walla.co.il", "walla.com", "nana.co.il", "012.net.il", "bezeqint.net", "netvision.net.il", "zahav.net.il", "gmx.com", "gmx.net", "proton.me", "protonmail.com",
  "mail.com", "yandex.com", "yandex.ru", "mail.ru", "zoho.com", "inbox.com", "qq.com", "163.com",
]);

export function businessDomain(email: string | null | undefined): string | null {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(email ?? "").trim());
  if (!m) return null;
  const d = m[1]!.toLowerCase();
  return FREE_MAIL.has(d) ? null : d;
}

/** "Acme Ltd." / "acme ltd" / " ACME  LTD " → the same key */
export function companyKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/["'״׳`.,]/g, "")
    .replace(/\b(ltd|inc|llc|co|corp)\b/g, "")
    .replace(/(^|\s)בעמ(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** a readable company name from a domain ("acme-tools.co.il" → "Acme Tools") */
export function nameFromDomain(domain: string): string {
  const base = domain.replace(/^www\./, "").split(".")[0] ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface ContactLite {
  id: string;
  company_name: string | null;
  email: string | null;
}

export interface CompanySuggestion {
  key: string;
  name: string;
  domain: string | null;
  contactIds: string[];
}

/**
 * Contacts that are not linked to a company → suggested companies. A contact's company name wins; otherwise a business
 * e-mail domain groups contacts of the same company. Companies that already exist (same key or same domain) are matched
 * instead of suggested again — `existing` maps them to their id (the contacts are linked to the existing company).
 */
export function suggestCompanies(contacts: ContactLite[], existing: { id: string; name: string; domain: string | null }[]): { create: CompanySuggestion[]; link: { companyId: string; contactIds: string[] }[] } {
  const byKey = new Map(existing.map((c) => [`n:${companyKey(c.name)}`, c.id]));
  for (const c of existing) if (c.domain) byKey.set(`d:${String(c.domain).toLowerCase().replace(/^www\./, "")}`, c.id);
  // union-find over "signals": a contact's company name and its business e-mail domain belong to the same company, so
  // "אקמי בע\"מ" + @acme.co.il, "Acme" + @acme.co.il and "Acme" without an e-mail all end up as ONE company
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const add = (x: string) => (parent.has(x) ? undefined : parent.set(x, x));
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const signals: { c: ContactLite; name: string; domain: string | null; tokens: string[] }[] = [];
  for (const c of contacts) {
    const name = String(c.company_name ?? "").trim();
    const domain = businessDomain(c.email);
    const tokens = [...(name && companyKey(name) ? [`n:${companyKey(name)}`] : []), ...(domain ? [`d:${domain}`] : [])];
    if (!tokens.length) continue;
    tokens.forEach(add);
    for (const tk of tokens.slice(1)) union(tokens[0]!, tk);
    signals.push({ c, name, domain, tokens });
  }
  const groups = new Map<string, { name: string; domain: string | null; contactIds: string[]; existingId: string | null; order: number }>();
  for (const sig of signals) {
    const root = find(sig.tokens[0]!);
    const g = groups.get(root) ?? { name: "", domain: null, contactIds: [], existingId: null, order: groups.size };
    if (!g.name && sig.name) g.name = sig.name;
    if (!g.domain && sig.domain) g.domain = sig.domain;
    for (const tk of sig.tokens) if (!g.existingId && byKey.has(tk)) g.existingId = byKey.get(tk)!;
    g.contactIds.push(sig.c.id);
    groups.set(root, g);
  }
  const create: CompanySuggestion[] = [];
  const link: { companyId: string; contactIds: string[] }[] = [];
  for (const [root, g] of [...groups.entries()].sort((a, b) => a[1].order - b[1].order)) {
    if (g.existingId) link.push({ companyId: g.existingId, contactIds: g.contactIds });
    else create.push({ key: root, name: g.name || nameFromDomain(g.domain ?? ""), domain: g.domain, contactIds: g.contactIds });
  }
  return { create: create.sort((a, b) => b.contactIds.length - a.contactIds.length), link };
}

export interface CompanyStats {
  contacts: number;
  openDeals: number;
  pipeline: number;
  won: number;
}

export function companyStats(contacts: { company_id: string | null }[], deals: { company_id: string | null; value: number | string | null; status: string }[]): Map<string, CompanyStats> {
  const m = new Map<string, CompanyStats>();
  const get = (id: string) => m.get(id) ?? (m.set(id, { contacts: 0, openDeals: 0, pipeline: 0, won: 0 }), m.get(id)!);
  for (const c of contacts) if (c.company_id) get(c.company_id).contacts++;
  for (const d of deals) {
    if (!d.company_id) continue;
    const s = get(d.company_id);
    const v = Number(d.value) || 0;
    if (d.status === "open") {
      s.openDeals++;
      s.pipeline += v;
    } else if (d.status === "won") s.won += v;
  }
  return m;
}

export const COMPANY_SORTS = ["name", "newest", "pipeline", "contacts", "won"] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];
export const COMPANY_FILTERS = ["all", "open_deals", "no_contacts", "customers"] as const;
export type CompanyFilter = (typeof COMPANY_FILTERS)[number];

export function sortFilterCompanies<T extends { id: string; name: string; created_at: string }>(rows: T[], stats: Map<string, CompanyStats>, sort: CompanySort, filter: CompanyFilter): T[] {
  const st = (id: string) => stats.get(id) ?? { contacts: 0, openDeals: 0, pipeline: 0, won: 0 };
  const kept = rows.filter((r) => (filter === "open_deals" ? st(r.id).openDeals > 0 : filter === "no_contacts" ? st(r.id).contacts === 0 : filter === "customers" ? st(r.id).won > 0 : true));
  const by: Record<CompanySort, (a: T, b: T) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    pipeline: (a, b) => st(b.id).pipeline - st(a.id).pipeline || a.name.localeCompare(b.name),
    contacts: (a, b) => st(b.id).contacts - st(a.id).contacts || a.name.localeCompare(b.name),
    won: (a, b) => st(b.id).won - st(a.id).won || a.name.localeCompare(b.name),
  };
  return [...kept].sort(by[sort]);
}
