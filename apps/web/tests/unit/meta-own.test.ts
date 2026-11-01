import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanAppId, cleanAppSecret, explainOwnAppError, needsAlternative, ownAppSteps, ownOAuthUrl, ownRedirectUri, parseFacebookProfile, validAppId, validAppSecret, webhookCallbackUrl, webhookEntryIds, OWN_APP_SCOPES } from "@/lib/channels/meta-own-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
const get = (d: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);

describe("own Meta app — keys", () => {
  it("cleans pasted App IDs and secrets", () => {
    expect(cleanAppId(" App ID: 1168686825483015 ")).toBe("1168686825483015");
    expect(cleanAppId("https://developers.facebook.com/apps/1168686825483015/settings/basic/")).toBe("1168686825483015");
    expect(validAppId("1234")).toBe(false);
    expect(validAppId("12345")).toBe(true);
    const fakeSecret = "ab".repeat(16);
    expect(cleanAppSecret(` ${fakeSecret.toUpperCase()} `)).toBe(fakeSecret);
    expect(validAppSecret(fakeSecret)).toBe(true);
    expect(validAppSecret("xyz")).toBe(false);
  });

  it("builds the login dialog with scopes, or with a Login for Business configuration", () => {
    const a = new URL(ownOAuthUrl({ appId: "12345", redirectUri: "https://x.app/api/channels/meta/own/oauth", state: "s1", version: "v25.0" }));
    expect(a.pathname).toBe("/v25.0/dialog/oauth");
    expect(a.searchParams.get("client_id")).toBe("12345");
    expect(a.searchParams.get("scope")?.split(",")).toEqual([...OWN_APP_SCOPES]);
    expect(a.searchParams.get("config_id")).toBeNull();
    const b = new URL(ownOAuthUrl({ appId: "12345", redirectUri: "https://x.app/r", state: "s1", version: "v25.0", configId: "998877" }));
    expect(b.searchParams.get("config_id")).toBe("998877");
    expect(b.searchParams.get("scope")).toBeNull();
  });

  it("the URLs the business copies point at the platform", () => {
    expect(ownRedirectUri("https://x.app/")).toBe("https://x.app/api/channels/meta/own/oauth");
    expect(webhookCallbackUrl("https://x.app")).toBe("https://x.app/api/channels/meta/pages");
    const steps = ownAppSteps("https://x.app");
    expect(steps.map((s) => s.key)).toEqual(["create", "keys", "redirect", "connect"]);
    expect(steps.find((s) => s.key === "redirect")?.copy).toBe("https://x.app/api/channels/meta/own/oauth");
    expect(existsSync(join(root, "app/api/channels/meta/own/oauth/route.ts"))).toBe(true);
  });
});

describe("tester invitation — profile links", () => {
  it("reads every common profile link", () => {
    expect(parseFacebookProfile("https://www.facebook.com/dana.levi")).toMatchObject({ username: "dana.levi", id: null });
    expect(parseFacebookProfile("facebook.com/profile.php?id=100012345678901")).toMatchObject({ id: "100012345678901" });
    expect(parseFacebookProfile("https://m.facebook.com/dana.levi?ref=bookmarks")).toMatchObject({ username: "dana.levi" });
    expect(parseFacebookProfile("100012345678901")).toMatchObject({ id: "100012345678901" });
    expect(parseFacebookProfile("@dana.levi")).toMatchObject({ username: "dana.levi" });
    expect(parseFacebookProfile("https://www.facebook.com/people/Dana-Levi/100012345678901/")).toMatchObject({ id: "100012345678901" });
  });
  it("refuses what is not a profile", () => {
    expect(parseFacebookProfile("https://evil.example/dana")).toBeNull();
    expect(parseFacebookProfile("https://facebook.com/groups/abc")).toBeNull();
    expect(parseFacebookProfile("")).toBeNull();
    expect(parseFacebookProfile("a b c")).toBeNull();
  });
});

describe("plain-words errors and when to offer the alternatives", () => {
  it("maps Meta's answers", () => {
    expect(explainOwnAppError("App not active: This app is not currently accessible")).toBe("metaAlt.err.notActive");
    expect(explainOwnAppError("Can't Load URL: The domain of this URL isn't included in the app's domains. redirect_uri")).toBe("metaAlt.err.redirect");
    expect(explainOwnAppError("Error validating client secret.")).toBe("metaAlt.err.secret");
    expect(explainOwnAppError("Invalid OAuth access token signature.")).toBe("metaAlt.err.appId");
    expect(explainOwnAppError("(#100) Invalid user id", 100)).toBe("metaAlt.err.userNotFound");
    expect(explainOwnAppError("")).toBe("metaAlt.err.unknown");
  });
  it("offers the alternatives for 'App not active' / not configured", () => {
    expect(needsAlternative("App not active")).toBe(true);
    expect(needsAlternative("not_configured")).toBe(true);
    expect(needsAlternative("state")).toBe(false);
  });
  it("reads entry ids from a webhook body only to find the signing app", () => {
    expect(webhookEntryIds(JSON.stringify({ entry: [{ id: "123456" }, { id: "123456" }, { id: "x" }, { id: 789012 }] }))).toEqual(["123456", "789012"]);
    expect(webhookEntryIds("not json")).toEqual([]);
  });
});

describe("wiring", () => {
  it("the webhook accepts the business's own app — but only for that business's Pages", () => {
    const r = read("app/api/channels/meta/pages/route.ts");
    expect(r).toContain("ownVerifyTokenKnown");
    expect(r).toContain("ownAppsForEntries");
    expect(r.match(/ownAppIds && !ownAppIds\.has\(acc\.organization_id\)/g)?.length).toBe(2);
  });
  it("the integrations page shows the alternatives and the Meta tile links to them", () => {
    expect(read("app/[locale]/(dashboard)/integrations/page.tsx")).toContain("<MetaAlternatives");
    expect(read("components/integrations/marketplace.tsx")).toContain('href="#meta-alt"');
    expect(read("app/[locale]/(dashboard)/integrations/connect-actions.ts")).toContain("own_app");
  });
  it("every new text exists in he, en and ar", () => {
    const keys = ["metaAlt.title", "metaAlt.tileLink", "metaAlt.err.notActive", "metaAlt.err.redirect", "metaAlt.tester.cta", "metaAlt.tester.status.invited", "metaAlt.own.steps.redirect", "metaAlt.own.status.connected", "metaAlt.admin.title", "audit.integrations_meta_own_app"];
    for (const l of ["he", "en", "ar"]) for (const k of keys) expect(get(dict(l), k), `${l}:${k}`).toBeTruthy();
  });
});
