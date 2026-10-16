import { describe, expect, it } from "vitest";
import { campaignSchema, computeSlots, formSchema, zonedToUtc } from "../src/engagement";

describe("time zones", () => {
  it("converts wall-clock time in Jerusalem to UTC across DST", () => {
    // winter (UTC+2) and summer (UTC+3)
    expect(new Date(zonedToUtc("2026-01-15", 9 * 60, "Asia/Jerusalem")).toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(new Date(zonedToUtc("2026-07-15", 9 * 60, "Asia/Jerusalem")).toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(new Date(zonedToUtc("2026-07-15", 9 * 60, "UTC")).toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });
});

describe("booking slots", () => {
  const now = new Date("2026-03-02T05:00:00Z"); // Monday 07:00 in Jerusalem (UTC+2)
  const base = { availability: { "1": [["09:00", "11:00"]] as [string, string][] }, timezone: "Asia/Jerusalem", durationMin: 30, bufferMin: 0, minNoticeHours: 1, maxDaysAhead: 7, busy: [] as [string, string][], now };

  it("lists slots inside the window only, respecting duration and notice", () => {
    const slots = computeSlots({ ...base, maxDaysAhead: 8 });
    expect(slots.slice(0, 4)).toEqual(["2026-03-02T07:00:00.000Z", "2026-03-02T07:30:00.000Z", "2026-03-02T08:00:00.000Z", "2026-03-02T08:30:00.000Z"]);
    expect(slots).toHaveLength(8); // this Monday + next Monday (horizon 8 days)
    expect(computeSlots(base)).toHaveLength(4); // 7 days from 07:00 ends before next Monday 09:00
  });

  it("removes busy and buffered times", () => {
    const slots = computeSlots({ ...base, busy: [["2026-03-02T07:30:00Z", "2026-03-02T08:00:00Z"]], bufferMin: 15 });
    expect(slots.filter((s) => s.startsWith("2026-03-02"))).toEqual(["2026-03-02T08:30:00.000Z"]);
  });
});

describe("form and campaign schemas", () => {
  const field = (key: string, type = "text") => ({ key, label: key, type });
  it("requires an e-mail or phone field, unique keys, options for selects", () => {
    expect(formSchema.safeParse({ name: "F", slug: "my-form", fields: [field("name"), field("email", "email")] }).success).toBe(true);
    expect(formSchema.safeParse({ name: "F", slug: "my-form", fields: [field("name")] }).success).toBe(false);
    expect(formSchema.safeParse({ name: "F", slug: "my-form", fields: [field("email", "email"), field("email")] }).success).toBe(false);
    expect(formSchema.safeParse({ name: "F", slug: "my-form", fields: [field("email", "email"), field("plan", "select")] }).success).toBe(false);
    expect(formSchema.safeParse({ name: "F", slug: "Bad Slug!", fields: [field("email", "email")] }).success).toBe(false);
  });

  it("e-mail campaigns need a subject; SMS is limited to 1600 chars", () => {
    expect(campaignSchema.safeParse({ name: "C", channel: "email", body: "x" }).success).toBe(false);
    expect(campaignSchema.safeParse({ name: "C", channel: "email", subject: "S", body: "x" }).success).toBe(true);
    expect(campaignSchema.safeParse({ name: "C", channel: "sms", body: "x".repeat(1601) }).success).toBe(false);
  });
});

describe("wave 4 schemas", () => {
  it("document totals match the database math (discount before VAT, cents rounding)", async () => {
    const { documentTotals } = await import("../src/engagement");
    expect(documentTotals([{ quantity: 1, unit_price: 1000, discount_pct: 10, tax_rate: 18 }, { quantity: 12, unit_price: 50, tax_rate: 18 }])).toEqual({ subtotal: 1500, tax: 270, total: 1770 });
    expect(documentTotals([{ quantity: 3, unit_price: 33.33, tax_rate: 17 }])).toEqual({ subtotal: 99.99, tax: 17, total: 116.99 });
  });

  it("site blocks are validated per type; links must be https or relative", async () => {
    const { siteSchema } = await import("../src/engagement");
    const ok = siteSchema.safeParse({ name: "S", slug: "my-site", blocks: [{ type: "hero", data: { title: "Hi", cta_href: "#form" } }, { type: "form", data: { form_slug: "contact-us" } }] });
    expect(ok.success).toBe(true);
    expect(siteSchema.safeParse({ name: "S", slug: "my-site", blocks: [{ type: "hero", data: { cta_href: "javascript:alert(1)" } }] }).success).toBe(false);
    expect(siteSchema.safeParse({ name: "S", slug: "my-site", blocks: [{ type: "script", data: {} }] }).success).toBe(false);
    expect(siteSchema.safeParse({ name: "S", slug: "my-site", blocks: [] }).success).toBe(false);
  });

  it("finance settings validate Stripe key formats", async () => {
    const { financeSettingsSchema } = await import("../src/engagement");
    expect(financeSettingsSchema.safeParse({ stripe_secret_key: ["sk", "test", "abcdefghijkl"].join("_") }).success).toBe(true);
    expect(financeSettingsSchema.safeParse({ stripe_secret_key: "pk_test_abcdefghijkl" }).success).toBe(false);
    expect(financeSettingsSchema.safeParse({ stripe_webhook_secret: "whsec_abcdefghijkl" }).success).toBe(true);
  });
});
