import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AB_ANGLES, abForecast, isAngle } from "@/lib/site/ab-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("wave 32 — A/B forecast + angles", () => {
  it("reports visitors still needed and the uplift of B over A", () => {
    expect(abForecast({ a_views: 40, b_views: 100, a_conv: 4, b_conv: 12 }, 100)).toEqual({ needA: 60, needB: 0, done: false, upliftPct: 20 });
    const f = abForecast({ a_views: 200, b_views: 200, a_conv: 10, b_conv: 15 }, 100);
    expect(f.done).toBe(true);
    expect(f.upliftPct).toBe(50);
    expect(abForecast({ a_views: 0, b_views: 0, a_conv: 0, b_conv: 0 }).upliftPct).toBeNull();
  });
  it("only known angles are accepted", () => {
    expect(AB_ANGLES.every(isAngle)).toBe(true);
    expect(isAngle("hack")).toBe(false);
    expect(isAngle(undefined)).toBe(false);
  });
});

describe("wave 32 — bulk actions, landing from campaign, translations", () => {
  const a = read("app/[locale]/(dashboard)/websites/actions.ts");
  it("bulk action is org-scoped, capped at 50 and limit-aware", () => {
    expect(a).toContain("export async function bulkSitesAction");
    expect(a).toContain(".slice(0, 50)");
    expect(a).toContain("plan_limit:sites_published");
    expect(a.match(/eq\("organization_id", ctx\.org\.id\)/g)!.length).toBeGreaterThan(4);
  });
  it("the landing page from a campaign is saved as a draft by the existing builder and needs ai + websites rights", () => {
    expect(a).toContain("export async function landingFromCampaignAction");
    expect(a).toMatch(/landingFromCampaignAction[\s\S]{0,400}websites\.manage[\s\S]{0,60}ai\.use/);
    expect(a).toContain("buildSiteWithAI");
  });
  it("campaign page offers the landing button", () => {
    expect(read("components/campaigns/campaign-actions.tsx")).toContain("campaign-landing");
  });
  it("clone never copies visits or publish state", () => {
    const c = read("lib/site/clone.ts");
    expect(c).toContain('status: "draft"');
    expect(c).toContain("published_at: null");
    expect(c).toContain('.select("name, slug, theme, seo, blocks, settings, pages")');
  });
  it("all new texts exist in he / en / ar", () => {
    const keys = ["websites.bulk.publish", "websites.bulk.partial", "websites.quick.campaign", "abtest.angles.trust", "abtest.forecast.need", "abtest.angleLabel", "campaigns.landing.button", "campaigns.landing.done"];
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const k of keys) expect(k.split(".").reduce((o: Record<string, unknown> | undefined, p) => (o as Record<string, Record<string, unknown>>)?.[p] as Record<string, unknown> | undefined, d)).toBeTruthy();
    }
  });
});
