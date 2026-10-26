import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("wave 27 — store connect buttons actually navigate", () => {
  const market = read("components/integrations/marketplace.tsx");
  it("Shopify + WooCommerce navigate with location.assign instead of a CSP-blocked form redirect", () => {
    expect(market).toContain("/api/stores/shopify/start?shop=");
    expect(market).toContain("/api/stores/woocommerce/start?url=");
    expect(market.match(/window\.location\.assign/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("the integrations CSP lets a form redirect reach Shopify", () => {
    expect(read("next.config.ts")).toMatch(/form-action 'self' https:\/\/\*\.myshopify\.com https:\/\/admin\.shopify\.com/);
  });
  it("the connecting label exists in every language", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      expect(d.market.shopify.connecting).toBeTruthy();
    }
  });
});

describe("wave 28 — Shopify connected-with-warning", () => {
  it("a webhook-only problem keeps the tile connected and shows the reason", () => {
    const m = read("components/integrations/marketplace.tsx");
    expect(m).toContain('startsWith("webhooks")');
    expect(m).toContain("shopify-warning");
    for (const l of ["he", "en", "ar"]) expect(JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).market.shopify.warn.hint403).toBeTruthy();
  });
});

describe("wave 29 — scope diagnosis", () => {
  it("reports which required Shopify scopes were not granted", async () => {
    const { missingScopes } = await import("@/lib/stores/shopify");
    expect(missingScopes("read_orders,read_customers,read_checkouts")).toEqual([]);
    expect(missingScopes("read_orders")).toEqual(["read_customers", "read_checkouts"]);
    expect(missingScopes("")).toEqual(["read_orders", "read_customers", "read_checkouts"]);
    expect(missingScopes(null)).toHaveLength(3);
  });
});

describe("wave 30 — expiring Shopify tokens", () => {
  it("asks for an expiring token and parses the refresh data", async () => {
    process.env.SHOPIFY_CLIENT_ID = "cid";
    process.env.SHOPIFY_CLIENT_SECRET = "sec";
    const { vi } = await import("vitest");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response(JSON.stringify({ access_token: "a1", scope: "read_orders", expires_in: 3600, refresh_token: "r1", refresh_token_expires_in: 7776000 }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const { shopifyExchange, shopifyRefresh } = await import("@/lib/stores/shopify");
    const ex = await shopifyExchange("x.myshopify.com", "CODE");
    expect(calls[0]).toContain("expiring=1");
    expect(calls[0]).toContain("code=CODE");
    expect(ex).toMatchObject({ ok: true, token: "a1", refreshToken: "r1" });
    expect(Date.parse(ex.expiresAt!)).toBeGreaterThan(Date.now());
    const rf = await shopifyRefresh("x.myshopify.com", "r1");
    expect(calls[1]).toContain("grant_type=refresh_token");
    expect(calls[1]).toContain("refresh_token=r1");
    expect(rf.ok).toBe(true);
    vi.unstubAllGlobals();
  });
  it("refreshes only when the token is about to expire", async () => {
    const { tokenNeedsRefresh } = await import("@/lib/stores/shopify");
    const soon = new Date(Date.now() + 30_000).toISOString();
    const later = new Date(Date.now() + 3_000_000).toISOString();
    expect(tokenNeedsRefresh({ token_expires_at: soon }, { refresh_token: "r" })).toBe(true);
    expect(tokenNeedsRefresh({ token_expires_at: later }, { refresh_token: "r" })).toBe(false);
    expect(tokenNeedsRefresh({}, { refresh_token: "r" })).toBe(true);
    expect(tokenNeedsRefresh({ token_expires_at: soon }, {})).toBe(false); // old non-expiring token: nothing to refresh with
  });
});
