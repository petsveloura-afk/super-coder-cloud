import { describe, expect, it } from "vitest";
import { PLUS7_EVALS, runPlus7Evals } from "@/lib/team/evals-plus7";

/** Runs in CI without a live model: the Hebrew evaluation set of upgrade 7. */
describe("upgrade 7 — Hebrew evaluation set (no live model)", () => {
  const results = runPlus7Evals();
  it("has at least 40 scenarios, most of them in real Hebrew", () => {
    expect(PLUS7_EVALS.length).toBeGreaterThanOrEqual(40);
    expect(PLUS7_EVALS.filter((s) => s.he && /[֐-׿]/.test(s.he)).length).toBeGreaterThanOrEqual(30);
  });
  it("covers every group", () => {
    expect(new Set(PLUS7_EVALS.map((s) => s.group))).toEqual(new Set(["understand", "policy", "route", "audit", "coordination", "numbers"]));
  });
  it("scenario ids are unique", () => expect(new Set(PLUS7_EVALS.map((s) => s.id)).size).toBe(PLUS7_EVALS.length));
  for (const r of results) it(`${r.group}: ${r.title}`, () => expect(r.failures, r.failures.join("; ")).toEqual([]));
});
