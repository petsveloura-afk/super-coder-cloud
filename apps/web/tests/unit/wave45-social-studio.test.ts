import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRIMARY_COOLDOWN_MS, STUDIO_MAX_VARIATIONS, buildFallbackUrl, buildImagePrompt, extraVariations, imageSize, isQuotaError, normalizeAsset, primaryAvailable, splitVariants, variationCount } from "@/lib/social/studio-core";

const root = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("wave 45 / stage A — post studio core", () => {
  it("one variation by default, three in total only on 'more options'", () => {
    expect(variationCount(false)).toBe(1);
    expect(variationCount(true)).toBe(3);
    expect(extraVariations(1)).toBe(2);
    expect(extraVariations(2)).toBe(1);
    expect(extraVariations(3)).toBe(0);
    expect(extraVariations(99)).toBe(0);
    expect(STUDIO_MAX_VARIATIONS).toBe(3);
  });

  it("image prompt asks for no text and does not leak numbers beyond the topic", () => {
    const p = buildImagePrompt({ topic: "  fresh   bread ", platform: "instagram", brandVoice: "warm", business: "Bakery" });
    expect(p).toContain("fresh bread");
    expect(p).toContain("1:1");
    expect(p).toMatch(/No text/);
    expect(buildImagePrompt({ topic: "x y", platform: "facebook" })).toContain("1.91:1");
  });

  it("splits alternative posts on === lines and bounds them", () => {
    expect(splitVariants("one\n===\ntwo\n===\nthree")).toEqual(["one", "two"]);
    expect(splitVariants("\"solo\"")).toEqual(["solo"]);
    expect(splitVariants("   ")).toEqual([]);
    expect(splitVariants("a".repeat(50) + "\n===\nb", 2, 10)[0]).toHaveLength(10);
  });

  it("normalizes assets: https only, bounded, deduped tags", () => {
    expect(normalizeAsset({ url: "http://x.test/a.png" })).toBeNull();
    expect(normalizeAsset({ url: "https://x.test/" + "a".repeat(1000) })).toBeNull();
    const a = normalizeAsset({ url: " https://x.test/a.png ", title: " hi   there ", tags: ["A", "a", " b ", ""] });
    expect(a).toEqual({ url: "https://x.test/a.png", title: "hi there", prompt: null, tags: ["a", "b"] });
  });
});

describe("wave 45 / stage A — fallback image provider", () => {
  it("recognises quota errors", () => {
    expect(isQuotaError("image_429:RESOURCE_EXHAUSTED:You exceeded your current quota")).toBe(true);
    expect(isQuotaError("image_503")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
  it("builds a bounded, encoded fallback url sized for the network", () => {
    const u = buildFallbackUrl("fresh bread & butter", "instagram", 12345);
    expect(u.startsWith("https://image.pollinations.ai/prompt/fresh%20bread%20%26%20butter?")).toBe(true);
    expect(u).toContain("width=1024");
    expect(u).toContain("height=1024");
    expect(imageSize("facebook")).toEqual({ width: 1200, height: 630 });
    expect(buildFallbackUrl("x".repeat(5000), "facebook", 1, "https://img.test/p/").length).toBeLessThan(1400);
  });
  it("skips the primary provider only during the cool-down", () => {
    expect(primaryAvailable(0, 1000)).toBe(true);
    expect(primaryAvailable(1000 + PRIMARY_COOLDOWN_MS, 1000)).toBe(false);
    expect(primaryAvailable(1000, 1000 + 1)).toBe(true);
  });
});

describe("wave 45 / stage A — wiring", () => {
  it("metered wrapper reserves and finalizes credits and leaves images.ts alone", () => {
    const w = read("apps/web/lib/social/studio-image.ts");
    expect(w).toContain("reserve_ai_credits_system");
    expect(w).toContain("finalize_ai_usage_system");
    expect(w).toContain("image_gen");
    expect(read("apps/web/lib/ai/images.ts")).not.toContain("reserve_ai_credits_system");
  });

  it("migration is a new additive file above the previous latest and does not touch social_posts", () => {
    const dir = path.join(root, "supabase/migrations");
    const files = fs.readdirSync(dir).sort();
    const mine = files.find((f) => f.endsWith("_social_assets.sql"))!;
    expect(mine).toBe("20261029000003_social_assets.sql");
    expect(files.indexOf(mine)).toBe(files.length - 1);
    const sql = read(`supabase/migrations/${mine}`);
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("has_permission");
    expect(sql).not.toMatch(/alter table public\.social_posts/i);
  });

  it("every studio key exists in he / ar / en and every t() key used by the panel resolves", () => {
    const dicts = (["he", "ar", "en"] as const).map((l) => JSON.parse(read(`apps/web/lib/i18n/dictionaries/${l}.json`)));
    const keys = Object.keys(dicts[0].social.studio).sort();
    for (const d of dicts) expect(Object.keys(d.social.studio).sort()).toEqual(keys);
    const src = read("apps/web/components/social/social-studio.tsx") + read("apps/web/app/[locale]/(dashboard)/social/studio-actions.ts") + read("apps/web/lib/social/studio-image.ts");
    const used = [...src.matchAll(/["`](social\.studio\.[A-Za-z]+)["`]/g)].map((m) => m[1]!.replace("social.studio.", ""));
    for (const k of new Set(used)) expect(keys).toContain(k);
  });
});
