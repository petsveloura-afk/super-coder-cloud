import { describe, expect, it } from "vitest";
import { analyze, analysisLine, minSampleSize, normalizeExperiment, recommend, verdictLabel, type Experiment } from "@/lib/team/experiments-core";
import { correctionLesson, explainDecision } from "@/lib/team/transparency-core";
import { appendRecord } from "@/lib/team/decision-core";

const NOW = Date.parse("2026-11-20T00:00:00Z");
const exp = (a: [number, number], b: [number, number], over: Partial<Experiment> = {}) => ({ baseline_rate: 0.1, min_effect: 0.5, min_days: 7, started_at: "2026-11-01T00:00:00Z", a: { name: "A", trials: a[0], successes: a[1] }, b: { name: "B", trials: b[0], successes: b[1] }, ...over });

describe("sample size", () => {
  it("matches the textbook (10% → 15%, 80% power ≈ 686 per arm)", () => expect(Math.abs(minSampleSize(0.1, 0.5) - 686)).toBeLessThan(12));
  it("smaller effects need more", () => expect(minSampleSize(0.1, 0.1)).toBeGreaterThan(minSampleSize(0.1, 0.5) * 10));
});
describe("analyze — 'not enough data' is a real answer", () => {
  it("no data / tiny sample", () => {
    expect(analyze(exp([0, 0], [0, 0]), NOW).verdict).toBe("not_enough_data");
    expect(analyze(exp([20, 2], [20, 6]), NOW).verdict).toBe("not_enough_data");
  });
  it("a big lift in a small sample is NOT declared (no peeking)", () => {
    const r = analyze(exp([300, 30], [300, 60]), NOW);
    expect(["keep_running", "not_enough_data"]).toContain(r.verdict);
    expect(r.pValue).toBeNull();
  });
  it("too few days blocks the verdict even with the sample", () => expect(analyze(exp([800, 80], [800, 130], { started_at: "2026-11-18T00:00:00Z" }), NOW).reason).toBe("too_few_days"));
  it("B wins with the sample reached and a real difference", () => {
    const r = analyze(exp([800, 80], [800, 140]), NOW);
    expect(r.verdict).toBe("b_wins");
    expect(r.pValue!).toBeLessThan(0.05);
    expect(r.lift!).toBeGreaterThan(0.5);
    expect(r.ci![0]).toBeGreaterThan(0);
  });
  it("A wins when B is worse; no difference when equal", () => {
    expect(analyze(exp([800, 140], [800, 80]), NOW).verdict).toBe("a_wins");
    expect(analyze(exp([800, 80], [800, 82]), NOW).verdict).toBe("no_difference");
  });
  it("impossible counts are refused", () => expect(analyze(exp([10, 20], [10, 1]), NOW).reason).toBe("invalid_counts"));
  it("wording in three languages", () => {
    const a = analyze(exp([20, 2], [20, 6]), NOW);
    for (const l of ["he", "en", "ar"] as const) expect(analysisLine(a, exp([20, 2], [20, 6]), l).length).toBeGreaterThan(5);
    expect(verdictLabel("not_enough_data", "he")).toBe("אין מספיק נתונים");
  });
});
describe("normalizeExperiment", () => {
  const ok = { title: "Opening line", hypothesis: "A shorter opening gets more replies", metric: "reply_rate", variant_a: "long", variant_b: "short" };
  it("accepts and rejects", () => {
    expect("exp" in normalizeExperiment(ok)).toBe(true);
    expect(normalizeExperiment({ ...ok, variant_b: "LONG" })).toEqual({ rejected: "variants" });
    expect(normalizeExperiment({ ...ok, baseline_rate: 1.5 })).toEqual({ rejected: "baseline_rate" });
    expect(normalizeExperiment({ ...ok, metric: "" })).toEqual({ rejected: "metric" });
  });
});
describe("recommendations carry an owner and a metric", () => {
  it("only when the facts justify them", () => {
    expect(recommend({})).toEqual([]);
    const r = recommend({ unansweredOver1h: 5, stuckDeals: 4, leadConversionRate: 0.05, reviewsAvg: 3.9, goalsAtRisk: 1 }, "he");
    expect(r).toHaveLength(5);
    for (const x of r) {
      expect(x.ownerRole).toBeTruthy();
      expect(x.metric).toBeTruthy();
    }
  });
});
describe("transparency", () => {
  const rec = appendRecord([], { understood: "u", decided: "d", why: "because of reasons", confidence: 0.9, would_change_mind: ["x"], options: [{ id: "A", title: "t", summary: "s", pros: [], cons: [], risk: "low", reversible: true }], chosen: "A", premortem: null }, { id: "1", task_id: "t", member_id: null, route: "deep", route_reasons: ["money_action"], confidence: 0.6, audit: null, now: 1 })[0]!;
  it("explains from the record only, with route reasons and a calibration note", () => {
    const e = explainDecision(rec, "he");
    expect(e.routeWhy).toEqual(["פעולה כספית"]);
    expect(e.confidencePct).toBe(60);
    expect(e.rawConfidencePct).toBe(90);
    expect(e.sections.map((s) => s.key)).toEqual(["understood", "options", "decided", "why", "change"]);
  });
  it("a correction is a PROPOSED lesson, never active", () => {
    const l = correctionLesson(rec, "תמיד לשאול אותי לפני שליחת הנחה")!;
    expect(l.status).toBe("proposed");
    expect(l.content).toContain("תמיד לשאול");
    expect(correctionLesson(rec, "  ")).toBeNull();
  });
});
