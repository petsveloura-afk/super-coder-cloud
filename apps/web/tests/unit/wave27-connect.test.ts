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
