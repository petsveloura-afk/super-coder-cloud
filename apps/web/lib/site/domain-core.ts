import { z } from "zod";

/**
 * Wave 13 — pure domain helpers (unit-tested): normalising what the customer typed,
 * the price the customer pays (registrar cost + the platform's commission), name
 * suggestions when a domain is taken, the DNS records for an existing domain, and the
 * registrant contact the registrar requires.
 */
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,24}$`);

/** "https://www.My-Shop.co.il/about" → "my-shop.co.il" (null when it is not a valid domain). */
export function normalizeDomain(input: string): string | null {
  let d = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (d.startsWith("www.")) d = d.slice(4);
  if (d.length > 253 || !DOMAIN_RE.test(d)) return null;
  return d;
}

/** A bare name ("pet line") → a domain-safe label ("petline"); null when nothing usable. */
export function labelFrom(input: string): string | null {
  const l = String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return l.length >= 2 ? l : null;
}

export const SUGGEST_TLDS = ["com", "co.il", "co", "net", "online", "site", "store", "io"] as const;

/** What to check for a search: the exact domain (when one was typed) + the name on popular endings. */
export function domainCandidates(query: string, max = 6): string[] {
  const exact = normalizeDomain(query);
  const label = exact ? exact.split(".")[0]! : labelFrom(query);
  const out: string[] = [];
  if (exact) out.push(exact);
  if (label) for (const tld of SUGGEST_TLDS) out.push(`${label}.${tld}`);
  return [...new Set(out)].slice(0, max);
}

export interface DomainPricing {
  /** commission percent on top of the registrar's price (DOMAIN_MARKUP_PERCENT, default 30) */
  markupPercent: number;
  /** minimum commission in USD (DOMAIN_MIN_FEE_USD, default 5) */
  minFee: number;
  /** most expensive registrar price the platform agrees to pay (DOMAIN_MAX_COST_USD, default 60) */
  maxCost: number;
}

export function pricingFromEnv(env: Record<string, string | undefined> = process.env): DomainPricing {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { markupPercent: n(env.DOMAIN_MARKUP_PERCENT, 30), minFee: n(env.DOMAIN_MIN_FEE_USD, 5), maxCost: n(env.DOMAIN_MAX_COST_USD, 60) };
}

/** Customer price = cost + max(cost × markup %, minimum fee), rounded up to whole cents. */
export function customerPrice(cost: number, p: DomainPricing): { price: number; fee: number } {
  const fee = Math.max((cost * p.markupPercent) / 100, p.minFee);
  const price = Math.ceil((cost + fee) * 100) / 100;
  return { price, fee: Math.round((price - cost) * 100) / 100 };
}

/** DNS records the customer adds at their registrar to connect an existing domain. */
export function dnsRecords(domain: string, verification: { type: string; domain: string; value: string }[] = []): { type: string; name: string; value: string }[] {
  const isApex = domain.split(".").length === 2 || (domain.split(".").length === 3 && /\.(co|org|net|ac|gov|muni)\.(il|uk)$/.test(domain));
  const records = isApex
    ? [
        { type: "A", name: "@", value: "76.76.21.21" },
        { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
      ]
    : [{ type: "CNAME", name: domain.split(".")[0]!, value: "cname.vercel-dns.com" }];
  return [
    ...records,
    ...verification.map((v) => ({ type: v.type, name: v.domain.replace(new RegExp(`\\.?${domain.replace(/\./g, "\\.")}$`), "") || "@", value: v.value })),
  ];
}

/** Registrant details the registrar requires (stored only until the domain is registered). */
export const domainContactSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  phone: z
    .string()
    .trim()
    .transform((v) => {
      const d = v.replace(/[^\d+]/g, "");
      if (d.startsWith("+")) return d;
      if (d.startsWith("0")) return `+972${d.slice(1)}`; // Israeli local number
      return `+${d}`;
    })
    .refine((v) => /^\+[1-9]\d{7,14}$/.test(v), { message: "validation.phone" }),
  address1: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(1).max(100),
  zip: z.string().trim().min(2).max(20),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  companyName: z.string().trim().max(160).optional(),
});
export type DomainContact = z.infer<typeof domainContactSchema>;

/** Vercel registrar phone format: "+972.501234567" (country code, dot, number). */
export function registrarPhone(e164: string): string {
  const d = e164.replace(/[^\d]/g, "");
  const cc = ["972", "971", "966", "962", "961", "970"].find((c) => d.startsWith(c)) ?? (d.startsWith("1") ? "1" : d.startsWith("44") ? "44" : d.slice(0, 2));
  return `+${cc}.${d.slice(cc.length)}`;
}
