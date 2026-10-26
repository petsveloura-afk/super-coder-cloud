import { describe, expect, it } from "vitest";
import { normalizeShopInput, validShopDomain } from "@/lib/stores/core";
import { grantedAreas } from "@/lib/google/connect";

describe("wave 25 — Shopify store field is forgiving", () => {
  it("accepts every shape people paste", () => {
    for (const v of [
      "my-store",
      "  My-Store  ",
      "MY STORE".replace(" ", "-"),
      "https://my-store.myshopify.com/admin",
      "my-store.myshopify.com",
      "my-store.myshopify.co",
      "my-store.myshopify.con",
      "admin.shopify.com/store/my-store",
      "https://admin.shopify.com/store/my-store/products?x=1",
    ]) {
      expect(validShopDomain(v), v).toBe("my-store.myshopify.com");
    }
  });
  it("still rejects foreign hosts and junk", () => {
    expect(validShopDomain("evil.com")).toBeNull();
    expect(validShopDomain("my-store.evil.com")).toBeNull();
    expect(validShopDomain("")).toBeNull();
    expect(validShopDomain(null)).toBeNull();
    expect(validShopDomain("my store")).toBe("mystore.myshopify.com");
  });
  it("normalizes without ever touching the host suffix of other domains", () => {
    expect(normalizeShopInput("https://x.myshopify.co/")).toBe("x.myshopify.com");
  });
});

describe("wave 25 — Google permissions", () => {
  it("one calendar permission is enough", () => {
    expect(grantedAreas("openid email https://www.googleapis.com/auth/calendar.events")).toEqual(["calendar"]);
    expect(grantedAreas("openid email https://www.googleapis.com/auth/calendar.freebusy")).toEqual(["calendar"]);
  });
  it("nothing ticked → nothing granted", () => {
    expect(grantedAreas("openid email profile")).toEqual([]);
    expect(grantedAreas("")).toEqual([]);
  });
  it("all three areas", () => {
    expect(grantedAreas("https://www.googleapis.com/auth/calendar.events https://mail.google.com/ https://www.googleapis.com/auth/business.manage")).toEqual(["calendar", "gmail", "business"]);
  });
});

import { passwordStrength } from "@/lib/auth-ui/password-strength";
describe("wave 25 — password strength meter", () => {
  it("rates weak → strong", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abc")).toBe(1);
    expect(passwordStrength("password1")).toBe(1);
    expect(passwordStrength("Sunny2026day")).toBeGreaterThanOrEqual(3);
    expect(passwordStrength("Tr0ub4dor&Horse-Battery!")).toBe(4);
  });
});
