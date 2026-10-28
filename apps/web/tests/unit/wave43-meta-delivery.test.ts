import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateAppSubscriptions } from "@/lib/channels/meta-webhook-health-core";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CB = "https://app.example.com/api/channels/meta/pages";
const ok = { data: [{ object: "page", callback_url: CB, active: true, fields: [{ name: "messages" }, { name: "feed" }] }, { object: "instagram", callback_url: CB, active: true, fields: [{ name: "messages" }, { name: "comments" }] }] };

describe("wave 43 — Meta delivery health and the fast inbox sync (additive)", () => {
  it("a healthy app has no issues", () => {
    expect(evaluateAppSubscriptions(ok, CB)).toEqual([]);
  });
  it("a missing subscription / missing messages field / switched-off webhook is found and fixable", () => {
    const none = evaluateAppSubscriptions({ data: [] }, CB);
    expect(none.map((i) => `${i.object}:${i.kind}`).sort()).toEqual(["instagram:missing", "page:missing"]);
    expect(none.every((i) => i.fixable)).toBe(true);
    const noMsg = evaluateAppSubscriptions({ data: [{ object: "page", callback_url: CB, active: true, fields: [{ name: "feed" }] }, ok.data[1]] }, CB);
    expect(noMsg).toHaveLength(1);
    expect(noMsg[0]).toMatchObject({ object: "page", kind: "fields", fixable: true });
    const off = evaluateAppSubscriptions({ data: [{ ...ok.data[0], active: false }, ok.data[1]] }, CB);
    expect(off[0]).toMatchObject({ kind: "inactive", fixable: true });
  });
  it("a webhook pointing somewhere else is reported but never overwritten", () => {
    const other = evaluateAppSubscriptions({ data: [{ ...ok.data[0], callback_url: "https://staging.example.com/x" }, ok.data[1]] }, CB);
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ kind: "callback", fixable: false });
  });
  it("the inbox asks for new Facebook / Instagram messages and keeps its 8s refresh", () => {
    const ui = read("../../components/inbox/inbox-client.tsx");
    expect(ui).toMatch(/\/api\/channels\/meta\/sync/);
    expect(ui).toMatch(/ms = 8000/);
    const sync = read("../../lib/channels/meta-sync.ts");
    expect(sync).toMatch(/opts\.fast/);
    expect(sync).toMatch(/subscribed_apps/); // the 5-minute sweep still heals page subscriptions
    expect(read("../../app/api/cron/social/route.ts")).toMatch(/publishDuePosts/);
  });
  it("the webhook still rejects unsigned requests", () => {
    const src = read("../../app/api/channels/meta/pages/route.ts");
    expect(src).toMatch(/secrets\.some\(\(secret\) => verifyMetaSignature/);
    expect(src).toMatch(/status: 401/);
  });
});
