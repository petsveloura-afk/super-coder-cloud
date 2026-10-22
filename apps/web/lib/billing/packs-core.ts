/**
 * Wave 18 — AI credit packs (pure, unit-tested). Credits from a pack are used only
 * after the plan's monthly AI allowance is used up, and do not expire.
 * Prices can be changed per deployment with CREDIT_PACKS_JSON
 * (e.g. [{"key":"ai_1000","credits":1000,"usd":15}]).
 */
export interface CreditPack {
  key: string;
  credits: number;
  usd: number;
}

export const DEFAULT_PACKS: CreditPack[] = [
  { key: "ai_500", credits: 500, usd: 9 },
  { key: "ai_2000", credits: 2000, usd: 29 },
  { key: "ai_10000", credits: 10000, usd: 99 },
];

export function creditPacks(env: Record<string, string | undefined> = process.env): CreditPack[] {
  const raw = env.CREDIT_PACKS_JSON;
  if (!raw) return DEFAULT_PACKS;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return DEFAULT_PACKS;
    const packs = arr
      .filter((p): p is CreditPack => !!p && typeof p === "object" && /^[a-z0-9_]{2,40}$/.test(String((p as CreditPack).key)) && Number((p as CreditPack).credits) > 0 && Number((p as CreditPack).usd) > 0)
      .map((p) => ({ key: p.key, credits: Math.min(10_000_000, Math.round(Number(p.credits))), usd: Math.round(Number(p.usd) * 100) / 100 }))
      .slice(0, 8);
    return packs.length ? packs : DEFAULT_PACKS;
  } catch {
    return DEFAULT_PACKS;
  }
}

export function packByKey(key: string, env?: Record<string, string | undefined>): CreditPack | null {
  return creditPacks(env).find((p) => p.key === key) ?? null;
}

/** Crypto order reference for a pack purchase: "pack:<purchase id>:<nonce>". */
export function packOrderRef(purchaseId: string, nonce: string): string {
  return `pack:${purchaseId}:${nonce}`.slice(0, 120);
}

export function parsePackRef(ref: string | null | undefined): string | null {
  const m = (ref ?? "").match(/^pack:([0-9a-f-]{36})(?::[A-Za-z0-9]{4,40})?$/);
  return m ? m[1]! : null;
}
