/**
 * Wave 49 — free image-provider chain, pure parts (no I/O, unit-tested).
 * The chain runs after Gemini and around the existing Pollinations fallback, so a post always gets a picture:
 *
 *   AI generators (free tiers, each optional, several keys/accounts allowed):
 *     cloudflare  Workers AI FLUX.1-schnell   CLOUDFLARE_AI_ACCOUNTS="accountId:token,accountId2:token2"
 *                                             (or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN)
 *     huggingface FLUX.1-schnell (router)     HF_TOKEN, HF_TOKEN_2… or HF_TOKENS="a,b"
 *     together    FLUX.1-schnell-Free         TOGETHER_API_KEY, _2… or TOGETHER_API_KEYS
 *   Real photos (free APIs):
 *     pexels      PEXELS_API_KEY(S)
 *     pixabay     PIXABAY_API_KEY(S)
 *     openverse   keyless, CC0 / public-domain only (no attribution needed)
 *   Last resort (always works, no network): an abstract branded design rendered on the server.
 *
 * STUDIO_IMAGE_CHAIN overrides the order / turns providers off, e.g. "cloudflare,pexels,brand".
 */

export type FreeProvider = "cloudflare" | "huggingface" | "together" | "pollinations" | "pexels" | "pixabay" | "openverse" | "brand";

export const DEFAULT_CHAIN_BEFORE: FreeProvider[] = ["cloudflare", "huggingface", "together"];
export const DEFAULT_CHAIN_AFTER: FreeProvider[] = ["pexels", "pixabay", "openverse", "brand"];
const ALL: FreeProvider[] = ["cloudflare", "huggingface", "together", "pollinations", "pexels", "pixabay", "openverse", "brand"];

type Env = Record<string, string | undefined>;

/** KEY, KEY_2 … KEY_n and KEYS="a,b" — deduped, trimmed. */
export function keyList(env: Env, base: string, max = 10): string[] {
  const out: string[] = [];
  const push = (v: string | undefined) => {
    for (const k of (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)) if (!out.includes(k)) out.push(k);
  };
  push(env[base]);
  for (let i = 2; i <= max; i++) push(env[`${base}_${i}`]);
  push(env[`${base}S`]);
  return out;
}

export interface CfAccount {
  accountId: string;
  token: string;
}

/** Cloudflare Workers AI accounts: CLOUDFLARE_AI_ACCOUNTS="id:token,…" plus the single-account pair. */
export function cloudflareAccounts(env: Env): CfAccount[] {
  const out: CfAccount[] = [];
  for (const pair of (env.CLOUDFLARE_AI_ACCOUNTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = pair.indexOf(":");
    if (i > 0) out.push({ accountId: pair.slice(0, i).trim(), token: pair.slice(i + 1).trim() });
  }
  if (env.CLOUDFLARE_ACCOUNT_ID && (env.CLOUDFLARE_AI_TOKEN || env.CLOUDFLARE_API_TOKEN)) {
    out.push({ accountId: env.CLOUDFLARE_ACCOUNT_ID.trim(), token: (env.CLOUDFLARE_AI_TOKEN || env.CLOUDFLARE_API_TOKEN)!.trim() });
  }
  return out.filter((a, i) => a.accountId && a.token && out.findIndex((b) => b.accountId === a.accountId && b.token === a.token) === i);
}

/** Is a provider usable with this environment (keys present / keyless)? */
export function providerConfigured(p: FreeProvider, env: Env): boolean {
  switch (p) {
    case "cloudflare":
      return cloudflareAccounts(env).length > 0;
    case "huggingface":
      return keyList(env, "HF_TOKEN").length > 0;
    case "together":
      return keyList(env, "TOGETHER_API_KEY").length > 0;
    case "pexels":
      return keyList(env, "PEXELS_API_KEY").length > 0;
    case "pixabay":
      return keyList(env, "PIXABAY_API_KEY").length > 0;
    case "openverse":
      return (env.STUDIO_OPENVERSE ?? "on").toLowerCase() !== "off";
    case "pollinations":
      return (env.STUDIO_IMAGE_FALLBACK ?? "pollinations").toLowerCase() !== "off";
    case "brand":
      return (env.STUDIO_BRAND_ART ?? "on").toLowerCase() !== "off";
  }
}

/**
 * Providers to try, split around Pollinations (which keeps its original place in studio-image.ts).
 * With STUDIO_IMAGE_CHAIN set, its order is used and only listed providers run.
 */
export function chainFor(env: Env): { before: FreeProvider[]; after: FreeProvider[] } {
  const custom = (env.STUDIO_IMAGE_CHAIN ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is FreeProvider => (ALL as string[]).includes(s));
  if (custom.length) {
    const cut = custom.indexOf("pollinations");
    const before = (cut >= 0 ? custom.slice(0, cut) : custom.filter((p) => DEFAULT_CHAIN_BEFORE.includes(p))).filter((p) => p !== "pollinations");
    const after = (cut >= 0 ? custom.slice(cut + 1) : custom.filter((p) => !DEFAULT_CHAIN_BEFORE.includes(p))).filter((p) => p !== "pollinations");
    return { before: before.filter((p) => providerConfigured(p, env)), after: after.filter((p) => providerConfigured(p, env)) };
  }
  return { before: DEFAULT_CHAIN_BEFORE.filter((p) => providerConfigured(p, env)), after: DEFAULT_CHAIN_AFTER.filter((p) => providerConfigured(p, env)) };
}

const STOP = new Set(
  "a an the of for and or with in on at to from by is are be this that its it as into over under very high quality professional photo photograph image picture social media business small composition landscape square natural light no text letters logos watermark visual mood style shot lens camera close up closeup background scene focus sharp detail details detailed".split(" "),
);

/** Short search query (3-5 strong English words) for stock-photo APIs from an image prompt / scene. */
export function stockQuery(prompt: string, max = 5): string {
  // prompts look like `Social media visual for the business "X": <scene>. <style>…` — search on the scene only
  const colon = prompt.indexOf(":");
  const firstPart = (colon >= 0 && colon < 160 ? prompt.slice(colon + 1) : prompt).split(".")[0] ?? "";
  const words = (firstPart.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w));
  const uniq = [...new Set(words)];
  return (uniq.slice(0, max).join(" ") || "business").slice(0, 100);
}

/** Error that means "out of free quota / rate limited" — the provider is skipped for a while. */
export function isLimitError(message: string | null | undefined): boolean {
  return /\b(?:429|402|403)\b|quota|rate.?limit|exhausted|exceeded|insufficient|credits?|too many/i.test(message ?? "");
}

export const PROVIDER_COOLDOWN_MS = 15 * 60_000;

/** Simple in-memory cool-down board (per server instance). */
export class Cooldowns {
  private until = new Map<string, number>();
  available(id: string, now = Date.now()): boolean {
    return (this.until.get(id) ?? 0) <= now;
  }
  rest(id: string, ms = PROVIDER_COOLDOWN_MS, now = Date.now()) {
    this.until.set(id, now + ms);
  }
}

/** Brand palette for the last-resort design: stable per topic, always two harmonious colors. */
const PALETTES: [string, string, string][] = [
  ["#0F172A", "#6366F1", "#22D3EE"],
  ["#1E1B4B", "#A855F7", "#F472B6"],
  ["#052E16", "#10B981", "#A3E635"],
  ["#1C1917", "#F97316", "#FACC15"],
  ["#0C4A6E", "#0EA5E9", "#67E8F9"],
  ["#3B0764", "#EC4899", "#FDBA74"],
  ["#111827", "#14B8A6", "#FDE68A"],
  ["#172554", "#3B82F6", "#F0ABFC"],
];

export function paletteFor(seed: string): [string, string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}
