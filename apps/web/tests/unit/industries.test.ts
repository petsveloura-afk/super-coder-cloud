import { describe, expect, it } from "vitest";
import { INDUSTRIES, industryByKey } from "@/lib/ai/industries";

/** Wave 12 — every industry template fits the setup limits (so loading + saving never fails). */
describe("industry templates", () => {
  it("has many categories with unique keys", () => {
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(INDUSTRIES.map((i) => i.key)).size).toBe(INDUSTRIES.length);
    expect(industryByKey("beauty")?.goal).toBe("booking");
    expect(industryByKey("nope")).toBeNull();
  });
  it("fits the conversation-setup validation (flow 15×300, fields 15×120, menu 8×30, pricing 3000)", () => {
    for (const ind of INDUSTRIES)
      for (const L of [ind.he, ind.en]) {
        expect(L.flow.length).toBeGreaterThan(2);
        expect(L.flow.length).toBeLessThanOrEqual(15);
        expect(L.flow.every((x) => x.trim().length > 0 && x.length <= 300)).toBe(true);
        expect(L.fields.length).toBeLessThanOrEqual(15);
        expect(L.fields.every((x) => x.length <= 120)).toBe(true);
        expect(L.menu.length).toBeLessThanOrEqual(8);
        expect(L.menu.every((x) => x.length <= 30), `${ind.key} menu`).toBe(true);
        expect(L.pricing.length).toBeLessThanOrEqual(3000);
      }
  });
});
