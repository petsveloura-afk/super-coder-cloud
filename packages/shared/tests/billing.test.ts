import { describe, expect, it } from "vitest";
import {
  limitErrorKey,
  normaliseStatus,
  planForPrice,
  priceEnvName,
  usageRatio,
  isPlanKey,
} from "../src/billing";
import { signStripePayload, stripeForm, verifyStripeSignature } from "../src/stripe";

describe("billing helpers", () => {
  it("interprets limits and usage", () => {
    expect(usageRatio(50, 100)).toBe(0.5);
    expect(usageRatio(500, 100)).toBe(1);
    expect(usageRatio(5, null)).toBe(0);
    expect(isPlanKey("pro")).toBe(true);
    expect(isPlanKey("gold")).toBe(false);
  });
  it("maps DB limit errors to i18n keys", () => {
    expect(limitErrorKey("plan_limit:contacts")).toBe("billing.limitReached");
    expect(limitErrorKey("plan_limit:ai_credits")).toBe("ai.limitReached");
    expect(limitErrorKey("demo_mode")).toBe("ai.demoBlocked");
    expect(limitErrorKey("rate_limited")).toBe("ai.rateLimited");
    expect(limitErrorKey("something else")).toBeNull();
  });
  it("normalises unknown provider statuses", () => {
    expect(normaliseStatus("active")).toBe("active");
    expect(normaliseStatus("paused")).toBe("incomplete");
  });
  it("resolves price ids to plans via env", () => {
    const env = { [priceEnvName("pro", "month")]: "price_1", [priceEnvName("business", "year")]: "price_2" };
    expect(planForPrice("price_1", env)).toEqual({ plan: "pro", interval: "month" });
    expect(planForPrice("price_2", env)).toEqual({ plan: "business", interval: "year" });
    expect(planForPrice("price_x", env)).toBeNull();
  });
});

describe("stripe webhook signatures", () => {
  const secret = "whsec_test_123";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  it("accepts a valid signature", () => {
    expect(verifyStripeSignature(body, signStripePayload(body, secret), secret)).toBe(true);
  });
  it("rejects tampered body, wrong secret, missing header and stale timestamps", () => {
    const h = signStripePayload(body, secret);
    expect(verifyStripeSignature(body + " ", h, secret)).toBe(false);
    expect(verifyStripeSignature(body, h, "whsec_other")).toBe(false);
    expect(verifyStripeSignature(body, null, secret)).toBe(false);
    const old = signStripePayload(body, secret, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyStripeSignature(body, old, secret)).toBe(false);
    expect(verifyStripeSignature(body, "t=1,v1=zz", secret)).toBe(false);
  });
  it("encodes nested form bodies the way Stripe expects", () => {
    const f = stripeForm({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { org_id: "o1" } });
    expect(decodeURIComponent(f)).toBe("mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[org_id]=o1");
  });
});
