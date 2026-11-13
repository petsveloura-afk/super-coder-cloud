import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { META_MODE_FLAG, appDashboardLinks, nextOwnStep, ownAppUrls, resolveMetaMode, subscriptionsReady } from "@/lib/channels/meta-mode-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("round 16 — Facebook + Instagram: each business's own app, with a platform-admin switch", () => {
  it("the switch decides; when never set, the platform app only when it is configured", () => {
    expect(META_MODE_FLAG).toBe("meta_connect_own_app");
    expect(resolveMetaMode(true, true)).toBe("own_app");
    expect(resolveMetaMode(false, false)).toBe("platform");
    expect(resolveMetaMode(null, true)).toBe("platform");
    expect(resolveMetaMode(undefined, false)).toBe("own_app");
  });

  it("every address the business's app needs comes from the platform address", () => {
    const u = ownAppUrls("https://app.supercoder.agency/");
    expect(u.host).toBe("app.supercoder.agency");
    expect(u.redirect).toBe("https://app.supercoder.agency/api/channels/meta/own/oauth");
    expect(u.webhook).toBe("https://app.supercoder.agency/api/channels/meta/pages");
    expect(u.privacy).toBe("https://app.supercoder.agency/en/legal/privacy");
    expect(u.terms).toBe("https://app.supercoder.agency/en/legal/terms");
    expect(u.deletion).toBe("https://app.supercoder.agency/api/meta/data-deletion");
    expect(u.deauth).toBe("https://app.supercoder.agency/api/meta/deauthorize");
  });

  it("direct links into the business's app (a bad id falls back to the app list)", () => {
    expect(appDashboardLinks("123456789").basic).toBe("https://developers.facebook.com/apps/123456789/settings/basic/");
    expect(appDashboardLinks("x").dashboard).toBe("https://developers.facebook.com/apps/");
    expect(appDashboardLinks("1").create).toContain("/apps/creation/");
  });

  it("webhooks count only when they point to us with the messages field", () => {
    const cb = "https://app.x/api/channels/meta/pages";
    const json = { data: [
      { object: "page", callback_url: cb, active: true, fields: [{ name: "messages" }, { name: "feed" }] },
      { object: "instagram", callback_url: "https://other/", active: true, fields: ["messages"] },
    ] };
    expect(subscriptionsReady(json, cb)).toEqual({ page: true, instagram: false });
    expect(subscriptionsReady(null, cb)).toEqual({ page: false, instagram: false });
  });

  it("the one next step, in order; everything fine → done", () => {
    expect(nextOwnStep([{ key: "keys", ok: false }, { key: "connected", ok: false }])).toBe("keys");
    expect(nextOwnStep([{ key: "keys", ok: true }, { key: "connected", ok: false }, { key: "webhooks", ok: false }])).toBe("connected");
    expect(nextOwnStep([{ key: "keys", ok: true }, { key: "connected", ok: true }, { key: "webhooks", ok: true }, { key: "page", ok: true }, { key: "live", ok: null }])).not.toBe("keys");
    expect(nextOwnStep([{ key: "keys", ok: true }, { key: "connected", ok: true }, { key: "webhooks", ok: true }, { key: "page", ok: true }, { key: "live", ok: true }])).toBe("done");
  });

  it("only the platform admin flips the switch, platform-wide, through the audited flag RPC", () => {
    const a = read("app/[locale]/(dashboard)/admin/meta-mode-actions.ts");
    expect(a).toContain("isPlatformAdmin");
    expect(a).toContain("platform_set_flag");
    expect(a).toContain("META_MODE_FLAG");
    expect(a).toContain("p_org: null");
    expect(read("app/[locale]/(dashboard)/admin/page.tsx")).toContain("<MetaModeCard");
  });

  it("the check-and-fix action needs integrations.manage", () => {
    expect(read("app/[locale]/(dashboard)/integrations/meta-easy-actions.ts")).toContain('.can("integrations.manage")');
  });

  it("switching never disconnects: the regular button stays, own mode only changes what is shown", () => {
    const m = read("components/integrations/marketplace.tsx");
    expect(m).toContain('data-testid="meta-own-start"');
    expect(m).toContain('metaMode === "own_app"');
    const alt = read("components/integrations/meta-alternatives.tsx");
    expect(alt).toContain('data-testid="own-check"');
    expect(alt).toContain("ownMode");
    // the webhook still accepts both kinds of apps
    expect(read("app/api/channels/meta/pages/route.ts").length).toBeGreaterThan(0);
  });

  it("saving the business's keys also fills Meta's required addresses (best effort)", () => {
    expect(read("app/[locale]/(dashboard)/integrations/meta-own-actions.ts")).toContain("configureOwnAppSettings");
  });

  it("texts in all three languages", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      expect(d.metaMode.own_app.title).toBeTruthy();
      expect(d.metaEasy.c.live.unknown).toBeTruthy();
      expect(d.metaEasy.next.connected).toBeTruthy();
    }
  });
});
