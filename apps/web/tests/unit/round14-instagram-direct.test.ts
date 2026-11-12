import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanIgCode, grantedPermissions, graphBaseFor, igAccountUsable, igAuthorizeUrl, igExpiry, igIssueFromPermissions, igTokenNeedsRefresh, isIgLoginToken, parseIgProfile, IG_LOGIN_SCOPES } from "@/lib/channels/ig-login-core";
import { parsePagesWebhook } from "@/lib/channels/meta-pages-core";
import { messagesFromConversations } from "@/lib/channels/meta-sync-core";
import { isChannelPlaceholderTitle, isServiceSender } from "@/lib/inbox/robots-core";
import { notCustomerKind } from "@/lib/ai/spam-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Instagram connected directly — the pure parts", () => {
  it("Instagram-login tokens go to graph.instagram.com, Facebook tokens stay on graph.facebook.com", () => {
    expect(isIgLoginToken("IGAAabc123")).toBe(true);
    expect(isIgLoginToken("EAAGabc")).toBe(false);
    expect(isIgLoginToken("")).toBe(false);
    expect(graphBaseFor("IGAAx", "v25.0")).toBe("https://graph.instagram.com/v25.0");
    expect(graphBaseFor("EAAx", "v25.0")).toBe("https://graph.facebook.com/v25.0");
    expect(graphBaseFor("EAAx", "v25.0", { META_GRAPH_BASE: "http://127.0.0.1:3100/graph/" })).toBe("http://127.0.0.1:3100/graph");
    expect(graphBaseFor("IGx", "v25.0", { META_IG_GRAPH_BASE: "http://mock/ig" })).toBe("http://mock/ig");
  });

  it("the sign-in address asks for messages, comments and publishing, with the state", () => {
    const u = new URL(igAuthorizeUrl({ appId: "123456789", redirectUri: "https://app.supercoder.agency/api/channels/instagram/oauth", state: "abc" }));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("123456789");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.supercoder.agency/api/channels/instagram/oauth");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("scope")).toBe(IG_LOGIN_SCOPES.join(","));
    expect(IG_LOGIN_SCOPES).toContain("instagram_business_manage_messages");
    expect(cleanIgCode("AQBx#_")).toBe("AQBx");
  });

  it("the account id webhooks use (user_id) is stored, the app-scoped id is kept aside", () => {
    expect(parseIgProfile({ user_id: "17841400000000001", id: "9876543210", username: "salon", account_type: "BUSINESS" })).toEqual({ igId: "17841400000000001", appScopedId: "9876543210", username: "salon", name: null, accountType: "BUSINESS" });
    expect(parseIgProfile({ id: "17841400000000002" })?.igId).toBe("17841400000000002");
    expect(parseIgProfile({ username: "x" })).toBeNull();
    expect(igAccountUsable("BUSINESS")).toBe(true);
    expect(igAccountUsable("MEDIA_CREATOR")).toBe(true);
    expect(igAccountUsable("PERSONAL")).toBe(false);
    expect(igAccountUsable(null)).toBe(true);
  });

  it("the 60-day token is refreshed in time", () => {
    const now = Date.parse("2026-11-13T00:00:00Z");
    expect(igTokenNeedsRefresh(new Date(now + 40 * 86_400_000).toISOString(), now)).toBe(false);
    expect(igTokenNeedsRefresh(new Date(now + 10 * 86_400_000).toISOString(), now)).toBe(true);
    expect(igTokenNeedsRefresh(null, now)).toBe(true);
    expect(igExpiry(5184000, now)).toBe(new Date(now + 5184000 * 1000).toISOString());
    expect(igExpiry(undefined, now)).toBe(new Date(now + 60 * 86_400 * 1000).toISOString());
  });

  it("why a Facebook Page came without Instagram", () => {
    expect(grantedPermissions({ data: [{ permission: "pages_messaging", status: "granted" }, { permission: "instagram_basic", status: "declined" }] })).toEqual(["pages_messaging"]);
    expect(igIssueFromPermissions(["pages_messaging"])).toBe("permission");
    expect(igIssueFromPermissions(["pages_messaging", "instagram_basic", "instagram_manage_messages"])).toBe("not_linked");
    expect(igIssueFromPermissions(null)).toBe("not_linked");
  });

  it("an Instagram-login webhook is parsed by the same parser (entry.id = the stored ig_id)", () => {
    const r = parsePagesWebhook({ object: "instagram", entry: [{ id: "17841400000000001", messaging: [{ sender: { id: "5550001" }, recipient: { id: "17841400000000001" }, message: { mid: "m1", text: "כמה עולה תספורת?" } }], changes: [{ field: "comments", value: { id: "c1", text: "מחיר?", from: { id: "777", username: "dana" }, media: { id: "m9" } } }] }] });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ platform: "instagram", accountId: "17841400000000001", senderId: "5550001", text: "כמה עולה תספורת?" });
    expect(r.comments[0]).toMatchObject({ platform: "instagram", accountId: "17841400000000001", commentId: "c1", authorName: "dana" });
  });

  it("the poller stops at the business's own reply (by account id or app-scoped id)", () => {
    const now = Date.now();
    const json = { data: [{ id: "t1", messages: { data: [{ id: "a", message: "שלום", created_time: new Date(now - 60_000).toISOString(), from: { id: "5550001", username: "dana" } }, { id: "b", message: "היי!", created_time: new Date(now - 120_000).toISOString(), from: { id: "9876543210" } }] } }] };
    const list = messagesFromConversations("instagram", "17841400000000001", ["9876543210"], json, now - 3_600_000);
    expect(list.map((m) => m.mid)).toEqual(["a"]);
  });
});

describe("Instagram connected directly — wired, additive", () => {
  it("one Graph helper serves both hosts; the Page flow finds the Instagram from both link types and says why it is missing", () => {
    const mp = read("lib/channels/meta-pages.ts");
    expect(mp).toContain("const res = await fetch(`${graphFor(init.token)}${path}`");
    expect(mp).toContain("connected_instagram_account");
    expect(mp).toContain("p.igIssue = issue");
    expect(read("lib/channels/meta-sync.ts")).toContain('cfg.mode === "instagram_login"');
  });

  it("the round trip: state cookie, permission check, account stored like the Page-linked one", () => {
    const route = read("app/api/channels/instagram/oauth/route.ts");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain('ctx.can("integrations.manage")');
    const act = read("app/[locale]/(dashboard)/integrations/instagram-actions.ts");
    expect(act).toContain('mode: "instagram_login"');
    expect(act).toContain("sealSecrets({ page_token: r.conn.token })");
    expect(act).toContain('.eq("kind", "instagram")');
  });

  it("disconnecting Facebook keeps a directly connected Instagram; the Facebook flow never replaces it", () => {
    const c = read("app/[locale]/(dashboard)/integrations/connect-actions.ts");
    expect(c).toContain("keepDirect");
    expect(c).toContain('!== "instagram_login"');
    expect(read("components/integrations/marketplace.tsx")).toContain("function InstagramTile");
  });

  it("after the move to Railway nothing points to the deleted Vercel address", () => {
    expect(read("public/guide/guide-data.js")).toContain('"app": "https://app.supercoder.agency"');
    expect(read("public/.well-known/security.txt")).not.toContain("vercel.app");
    expect(read("../../.github/workflows/deploy.yml")).not.toContain('APP_URL:-https://super-coder-cloud.vercel.app');
  });
});

describe("a Messenger / Instagram customer whose name was not read yet is a customer, not a robot", () => {
  it("the agent answers, the inbox counts them, the robots clean-up skips them", () => {
    expect(isChannelPlaceholderTitle("Instagram", "instagram")).toBe(true);
    expect(isChannelPlaceholderTitle("Messenger", "messenger")).toBe(true);
    expect(isChannelPlaceholderTitle("Instagram", "email")).toBe(false);
    expect(isServiceSender("Instagram", null, "instagram")).toBe(false);
    expect(isServiceSender("Messenger", null, "messenger")).toBe(false);
    expect(notCustomerKind({ text: "היי, כמה עולה תספורת?", channel: "instagram", subject: "Instagram" })).toBeNull();
    expect(notCustomerKind({ text: "Hi, is it available?", channel: "messenger", subject: "Messenger" })).toBeNull();
    // unchanged elsewhere: an e-mail from "Instagram" is still a service sender
    expect(isServiceSender("Instagram", null, "email")).toBe(true);
    expect(isServiceSender("Instagram")).toBe(true);
  });
});
