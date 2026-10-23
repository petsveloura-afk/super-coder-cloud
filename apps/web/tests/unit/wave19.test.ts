import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commentIntent, parsePagesWebhook, quickReplies, splitForMeta } from "@/lib/channels/meta-pages-core";
import { hookHash, shopifyCheckout, shopifyOrder, storeOrigin, validShopDomain, verifyShopifyQuery, verifyShopifyWebhook, wooOrder } from "@/lib/stores/core";
import { attentionItems, cartText, isMorning, overdueText, parsePostPlan, reminderTone, scheduleSlots, trend } from "@/lib/agents/core";

describe("Messenger / Instagram webhooks", () => {
  it("parses messages, echoes, attachments and quick replies", () => {
    const r = parsePagesWebhook({
      object: "instagram",
      entry: [
        {
          id: "17841400000",
          messaging: [
            { sender: { id: "1234567" }, recipient: { id: "17841400000" }, message: { mid: "m1", text: "כמה עולה?" } },
            { sender: { id: "17841400000" }, recipient: { id: "1234567" }, message: { mid: "m2", text: "היי", is_echo: true, app_id: 999 } },
            { sender: { id: "1234567" }, recipient: { id: "17841400000" }, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://cdn.fb/x.jpg" } }] } },
            { sender: { id: "1234567" }, recipient: { id: "17841400000" }, message: { mid: "m4", text: "תספורת", quick_reply: { payload: "תספורת" } } },
            { sender: { id: "1234567" }, recipient: { id: "17841400000" }, message: { mid: "m5", is_deleted: true } },
          ],
        },
      ],
    });
    expect(r.messages).toHaveLength(4);
    expect(r.messages[0]).toMatchObject({ platform: "instagram", accountId: "17841400000", senderId: "1234567", text: "כמה עולה?", echo: false });
    expect(r.messages[1]).toMatchObject({ echo: true, senderId: "1234567", echoAppId: "999" });
    expect(r.messages[2]!.media).toEqual({ type: "image", url: "https://cdn.fb/x.jpg" });
    expect(r.messages[3]!.postback).toBe("תספורת");
  });
  it("parses page + instagram comments, skips the business's own", () => {
    const fb = parsePagesWebhook({ object: "page", entry: [{ id: "555000", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "c1", post_id: "p1", from: { id: "77", name: "Dana" }, message: "מחיר?" } }, { field: "feed", value: { item: "comment", verb: "add", comment_id: "c2", post_id: "p1", from: { id: "555000", name: "Page" }, message: "תודה" } }] }] });
    expect(fb.comments).toEqual([expect.objectContaining({ platform: "facebook", commentId: "c1", authorName: "Dana", text: "מחיר?" })]);
    const ig = parsePagesWebhook({ object: "instagram", entry: [{ id: "178414", changes: [{ field: "comments", value: { id: "ic1", text: "wow", from: { id: "9", username: "yael" }, media: { id: "med1" } } }] }] });
    expect(ig.comments[0]).toMatchObject({ platform: "instagram", commentId: "ic1", postId: "med1", authorName: "yael" });
    expect(parsePagesWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual({ messages: [], comments: [] });
  });
  it("quick replies and Meta's length limits", () => {
    expect(quickReplies(["תספורת", "אמבטיה וטיפוח מלא לכלב גדול"])).toEqual([
      { content_type: "text", title: "תספורת", payload: "תספורת" },
      { content_type: "text", title: "אמבטיה וטיפוח מלא ל…", payload: "אמבטיה וטיפוח מלא לכלב גדול" },
    ]);
    expect(quickReplies([])).toBeUndefined();
    const long = "שלום עולם. ".repeat(200);
    const parts = splitForMeta(long, "instagram");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(990);
    expect(splitForMeta("קצר", "messenger")).toEqual(["קצר"]);
  });
  it("comment intent", () => {
    expect(commentIntent("כמה עולה?")).toBe("lead");
    expect(commentIntent("how much is it")).toBe("lead");
    expect(commentIntent("מתי אתם פתוחים?")).toBe("question");
    expect(commentIntent("שירות גרוע, נוכלים")).toBe("negative");
    expect(commentIntent("check bit.ly/xyz crypto")).toBe("spam");
    expect(commentIntent("מדהים ❤️")).toBe("positive");
  });
});

describe("stores", () => {
  it("normalises Shopify orders and checkouts", () => {
    const o = shopifyOrder({ id: 450789, name: "#1001", email: "a@b.co", total_price: "199.90", currency: "ils", financial_status: "paid", buyer_accepts_marketing: true, customer: { first_name: "Avi", last_name: "Cohen" }, line_items: [{ title: "Shampoo", quantity: 2, price: "99.95" }] })!;
    expect(o).toMatchObject({ id: "450789", number: "#1001", email: "a@b.co", name: "Avi Cohen", total: 199.9, currency: "ILS", status: "paid", consent: true });
    expect(o.items).toEqual([{ name: "Shampoo", qty: 2, price: 99.95 }]);
    const c = shopifyCheckout({ token: "tok1", email: "x@y.co", total_price: "50", abandoned_checkout_url: "https://s.co/c/1", line_items: [] })!;
    expect(c).toMatchObject({ id: "tok1", checkout_url: "https://s.co/c/1", total: 50 });
    expect(shopifyCheckout({ id: 1, abandoned_checkout_url: "http://insecure" })!.checkout_url).toBeNull();
    expect(shopifyOrder({})).toBeNull();
  });
  it("normalises WooCommerce orders", () => {
    expect(wooOrder({ id: 77, number: "77", status: "processing", total: "120.00", currency: "ILS", billing: { first_name: "Lea", last_name: "Levi", email: "l@l.co", phone: "0541234567" }, line_items: [{ name: "Bag", quantity: 1, price: 120 }] })).toMatchObject({ id: "77", email: "l@l.co", phone: "0541234567", name: "Lea Levi", total: 120, status: "processing" });
  });
  it("verifies Shopify webhooks and OAuth callbacks, validates shops and store URLs", () => {
    const body = '{"id":1}';
    const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
    expect(verifyShopifyWebhook(body, sig, "s3cret")).toBe(true);
    expect(verifyShopifyWebhook(body, sig, "other")).toBe(false);
    const qs = new URLSearchParams({ code: "abc", shop: "my-store.myshopify.com", state: "xyz", timestamp: "1" });
    const msg = [...qs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    qs.set("hmac", createHmac("sha256", "s3cret").update(msg).digest("hex"));
    expect(verifyShopifyQuery(qs, "s3cret")).toBe(true);
    qs.set("shop", "evil.myshopify.com");
    expect(verifyShopifyQuery(qs, "s3cret")).toBe(false);
    expect(validShopDomain("My-Store")).toBe("my-store.myshopify.com");
    expect(validShopDomain("https://my-store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(validShopDomain("evil.com")).toBeNull();
    expect(storeOrigin("shop.co.il/path")).toBe("https://shop.co.il");
    expect(storeOrigin("http://shop.co.il")).toBeNull();
    expect(hookHash("a")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("the AI team", () => {
  it("trends and attention items", () => {
    expect(trend(14, 10)).toBe("↑ 40%");
    expect(trend(5, 10)).toBe("↓ 50%");
    expect(trend(11, 10)).toBeNull();
    expect(trend(3, 0)).toBe("new");
    const items = attentionItems({ leads: 1, conversations: 1, aiReplies: 1, avgReplyMs: 45_000, wonValue: 0, wonCount: 0, revenue: 0, overdueTotal: 1200, appointmentsToday: 2, waiting: 3, hotLeads: 1 }, "he");
    expect(items[0]).toMatch(/3 שיחות/);
    expect(items.join(" ")).toMatch(/1,200|1200/);
    expect(items).toHaveLength(5);
  });
  it("collections tone and texts", () => {
    expect([0, 1, 2, 5].map(reminderTone)).toEqual(["friendly", "clear", "final", "final"]);
    const t = overdueText("he", { name: "Dana Levi", number: "1042", balance: 350, currency: "ILS", days: 6, url: "https://x/q/t", org: "פט-ליין", tone: "friendly" });
    expect(t).toMatch(/היי Dana/);
    expect(t).toMatch(/1042/);
    expect(t).toMatch(/https:\/\/x\/q\/t/);
    expect(overdueText("en", { name: null, number: "9", balance: 10, currency: "USD", days: 30, url: "u", org: "O", tone: "final" })).toMatch(/last reminder/);
    expect(cartText("he", { name: "Avi", org: "חנות", url: "https://s/c", total: 1, currency: "ILS" })).toMatch(/https:\/\/s\/c/);
  });
  it("content plan parsing and scheduling", () => {
    const plan = parsePostPlan('Here you go: [{"text":"טיפ ראשון לטיפוח הכלב בחורף 🐶","platforms":["facebook","instagram"]},{"text":"short"},{"text":"מבצע השבוע: 10% הנחה לטיפוח מלא","platforms":["x"]}]', 5);
    expect(plan).toHaveLength(2);
    expect(plan[0]!.platforms).toEqual(["facebook", "instagram"]);
    expect(plan[1]!.platforms).toEqual(["facebook"]);
    expect(parsePostPlan("not json", 3)).toEqual([]);
    const slots = scheduleSlots(3, new Date("2026-10-23T08:00:00Z"));
    expect(slots).toHaveLength(3);
    expect(slots[0]!.getTime()).toBeGreaterThan(new Date("2026-10-23T08:00:00Z").getTime());
    expect(new Set(slots.map((d) => d.toISOString().slice(0, 10))).size).toBe(3);
  });
  it("morning window", () => {
    expect(isMorning("Asia/Jerusalem", new Date("2026-10-23T05:30:00Z"))).toBe(true); // 08:30
    expect(isMorning("Asia/Jerusalem", new Date("2026-10-23T15:00:00Z"))).toBe(false); // 18:00
  });
});
