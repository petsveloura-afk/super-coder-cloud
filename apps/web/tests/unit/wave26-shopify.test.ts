import { describe, expect, it } from "vitest";
import { isPrivateIp, parseShopInput, probeHandle, resolveShop, shopFromDomain } from "@/lib/stores/resolve";

const res = (status: number, headers: Record<string, string> = {}, body?: unknown) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } });

describe("wave 26 — parsing what people type", () => {
  it("handles / urls / admin addresses", () => {
    expect(parseShopInput("My-Store")).toMatchObject({ kind: "handles", handles: expect.arrayContaining(["my-store"]) });
    expect(parseShopInput("https://my-store.myshopify.com/admin")).toEqual({ kind: "handles", handles: ["my-store"], via: "handle" });
    expect(parseShopInput("https://admin.shopify.com/store/my-store/products")).toEqual({ kind: "handles", handles: ["my-store"], via: "admin_url" });
  });
  it("a store NAME becomes the handle variants Shopify generates", () => {
    const r = parseShopInput("Dana's Cool Shop");
    expect(r.kind).toBe("handles");
    if (r.kind === "handles") expect(r.handles.slice(0, 2)).toEqual(["danas-cool-shop", "danascoolshop"]);
  });
  it("custom domains are looked up, not guessed", () => {
    expect(parseShopInput("https://www.mystore.co.il/products?x=1")).toEqual({ kind: "domain", host: "www.mystore.co.il" });
  });
  it("junk is rejected", () => {
    expect(parseShopInput("")).toEqual({ kind: "invalid", reason: "empty" });
    expect(parseShopInput("החנות שלי")).toEqual({ kind: "invalid", reason: "non_latin" });
    expect(parseShopInput("a".repeat(400))).toMatchObject({ kind: "invalid" });
  });
});

describe("wave 26 — verifying against Shopify", () => {
  it("404 → not found, 200 → exists, network failure → unknown", async () => {
    expect(await probeHandle("nope", async () => res(404))).toBe(false);
    expect(await probeHandle("yes", async () => res(200))).toBe(true);
    expect(await probeHandle("pw", async () => res(302, { location: "/password" }))).toBe(true);
    expect(await probeHandle("x", async () => Promise.reject(new Error("boom")))).toBeNull();
  });
  it("tries the name variants and picks the live one", async () => {
    const f = async (url: string) => {
      if (url.startsWith("https://danas-cool-shop.myshopify.com/meta.json")) return res(200, {}, { name: "Dana's Cool Shop" });
      if (url.startsWith("https://danascoolshop.myshopify.com/")) return res(200, { "x-shopid": "1" });
      return res(404);
    };
    const r = await resolveShop("Dana's Cool Shop", f);
    expect(r).toMatchObject({ status: "found", shop: "danascoolshop.myshopify.com" });
  });
  it("everything 404 → not_found; flaky network → unverified (never blocks)", async () => {
    expect((await resolveShop("ghost-store", async () => res(404))).status).toBe("not_found");
    const r = await resolveShop("ghost-store", async () => Promise.reject(new Error("offline")));
    expect(r).toMatchObject({ status: "unverified", shop: "ghost-store.myshopify.com" });
  });
  it("custom domain → myshopify via meta.json, or via the /admin redirect", async () => {
    const meta = await shopFromDomain("shop.example.com", async (u) => (u.endsWith("/meta.json") ? res(200, {}, { myshopify_domain: "real-handle.myshopify.com", name: "Real" }) : res(404)));
    expect(meta).toMatchObject({ shop: "real-handle.myshopify.com", name: "Real" });
    const adm = await shopFromDomain("shop.example.com", async (u) => (u.endsWith("/admin") ? res(302, { location: "https://admin.shopify.com/store/via-admin/" }) : res(404)));
    expect(adm.shop).toBe("via-admin.myshopify.com");
  });
});

describe("wave 26 — never fetches internal addresses", () => {
  it("private ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1", "::1", "fd00::1"]) expect(isPrivateIp(ip), ip).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
  it("a domain that is an IP / localhost is refused", async () => {
    expect((await resolveShop("http://169.254.169.254/latest", async () => res(200))).status).toBe("invalid");
    expect((await resolveShop("localhost", async () => res(404))).status).not.toBe("found");
  });
});
