import { describe, expect, it } from "vitest";
import { Cooldowns, chainFor, cloudflareAccounts, isLimitError, keyList, paletteFor, providerConfigured, stockQuery } from "@/lib/social/image-providers-core";

describe("wave 49 — free image provider chain", () => {
  it("collects keys from KEY, KEY_2… and KEYS", () => {
    expect(keyList({ HF_TOKEN: "a", HF_TOKEN_2: "b", HF_TOKENS: "c, a" }, "HF_TOKEN")).toEqual(["a", "b", "c"]);
    expect(keyList({}, "HF_TOKEN")).toEqual([]);
  });
  it("reads several Cloudflare accounts", () => {
    expect(cloudflareAccounts({ CLOUDFLARE_AI_ACCOUNTS: "id1:t1, id2:t2", CLOUDFLARE_ACCOUNT_ID: "id3", CLOUDFLARE_AI_TOKEN: "t3" })).toEqual([
      { accountId: "id1", token: "t1" },
      { accountId: "id2", token: "t2" },
      { accountId: "id3", token: "t3" },
    ]);
  });
  it("always ends with keyless providers, even with no keys", () => {
    expect(chainFor({})).toEqual({ before: [], after: ["openverse", "brand"] });
    const full = chainFor({ HF_TOKEN: "x", PEXELS_API_KEY: "p", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_AI_TOKEN: "t" });
    expect(full.before).toEqual(["cloudflare", "huggingface"]);
    expect(full.after).toEqual(["pexels", "openverse", "brand"]);
    expect(chainFor({ STUDIO_IMAGE_CHAIN: "pexels,pollinations,brand", PEXELS_API_KEY: "p" })).toEqual({ before: ["pexels"], after: ["brand"] });
    expect(providerConfigured("brand", { STUDIO_BRAND_ART: "off" })).toBe(false);
  });
  it("builds a short stock query from the scene only", () => {
    const q = stockQuery('Social media visual for the business "Super Coder": a smiling man pointing at a laptop landing page. Editorial commercial photography.');
    expect(q).toContain("smiling");
    expect(q).toContain("laptop");
    expect(q).not.toMatch(/super|coder|social|editorial/);
    expect(stockQuery("")).toBe("business");
  });
  it("limit errors and cool-downs", () => {
    expect(isLimitError("cloudflare_429:Too many")).toBe(true);
    expect(isLimitError("huggingface_402:credits")).toBe(true);
    expect(isLimitError("download_500")).toBe(false);
    const c = new Cooldowns();
    c.rest("x", 1000, 0);
    expect(c.available("x", 500)).toBe(false);
    expect(c.available("x", 1000)).toBe(true);
    expect(paletteFor("bread")).toEqual(paletteFor("bread"));
  });
});
