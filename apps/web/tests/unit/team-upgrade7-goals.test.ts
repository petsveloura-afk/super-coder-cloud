import { describe, expect, it } from "vitest";
import { GOAL_METRIC_KEYS, MIN_POINTS, alertLine, dayKey, expectedNow, forecast, forecastLine, goalAlert, goalCard, goalsPrompt, normalCdf, normalizeGoal, progressOf, riskLabel, type DailyPoint, type Goal } from "@/lib/team/goals-core";
import { UPGRADE7C_TOOLS, withRoleExtras7c } from "@/lib/team/tools-plus7c-core";
import { TOOLS } from "@/lib/team/tools-core";
import { withRoleExtras } from "@/lib/team/tools-plus-core";
import { withRoleExtras7 } from "@/lib/team/tools-plus7-core";

const NOW = Date.parse("2026-11-15T10:00:00Z");
const D = 86_400_000;
const goal = (over: Partial<Goal> = {}): Goal => ({ id: "g1", title: "30 new leads", metric: "leads_new", baseline: 0, target: 30, start_date: "2026-11-01", due_date: "2026-11-30", owner_member_id: null, owner_user_id: null, status: "active", source: "owner", ...over });
const days = (from: string, values: number[]): DailyPoint[] => values.map((v, i) => ({ day: dayKey(Date.parse(`${from}T00:00:00Z`) + i * D), value: v }));

describe("normalizeGoal", () => {
  const ok = { title: "More leads", metric: "leads_new", target: 40, due_date: "2026-12-31", start_date: "2026-11-01" };
  it("accepts a valid goal", () => {
    const r = normalizeGoal(ok, NOW);
    expect("goal" in r && r.goal.target).toBe(40);
  });
  it("rejects bad input with a reason", () => {
    expect(normalizeGoal({ ...ok, title: "x" }, NOW)).toEqual({ rejected: "title" });
    expect(normalizeGoal({ ...ok, metric: "sparkles" }, NOW)).toEqual({ rejected: "metric" });
    expect(normalizeGoal({ ...ok, target: "abc" }, NOW)).toEqual({ rejected: "target" });
    expect(normalizeGoal({ ...ok, due_date: "tomorrow" }, NOW)).toEqual({ rejected: "due_date" });
    expect(normalizeGoal({ ...ok, due_date: "2026-10-01" }, NOW)).toEqual({ rejected: "due_before_start" });
    expect(normalizeGoal({ ...ok, due_date: "2031-01-01" }, NOW)).toEqual({ rejected: "too_long" });
  });
  it("direction matters: a goal to go UP needs target above baseline, a goal to go DOWN below", () => {
    expect(normalizeGoal({ ...ok, baseline: 50 }, NOW)).toEqual({ rejected: "target_not_above_baseline" });
    expect(normalizeGoal({ title: "Faster replies", metric: "reply_minutes", baseline: 5, target: 8, due_date: "2026-12-31", start_date: "2026-11-01" }, NOW)).toEqual({ rejected: "target_not_below_baseline" });
    expect("goal" in normalizeGoal({ title: "Faster replies", metric: "reply_minutes", baseline: 8, target: 3, due_date: "2026-12-31", start_date: "2026-11-01" }, NOW)).toBe(true);
  });
  it("knows every metric", () => expect(GOAL_METRIC_KEYS.length).toBe(7));
});

describe("progress and pace", () => {
  it("progress is 0..1+ and never negative", () => {
    expect(progressOf({ baseline: 0, target: 30 }, 15)).toBe(0.5);
    expect(progressOf({ baseline: 10, target: 30 }, 5)).toBe(0);
    expect(progressOf({ baseline: 0, target: 30 }, 45)).toBe(1.5);
  });
  it("pace line is linear between start and due", () => {
    expect(expectedNow(goal(), Date.parse("2026-11-01T00:00:00Z"))).toBe(0);
    expect(expectedNow(goal(), Date.parse("2026-11-30T00:00:00Z"))).toBe(30);
    expect(expectedNow(goal(), Date.parse("2026-12-30T00:00:00Z"))).toBe(30);
  });
});

describe("forecast — honest by construction", () => {
  it("says 'not enough data' with fewer than MIN_POINTS days — and invents no number", () => {
    const f = forecast(goal({ start_date: "2026-11-12" }), days("2026-11-12", [1, 2, 1, 1]), NOW);
    expect(f.risk).toBe("not_enough_data");
    expect(f.expected).toBeNull();
    expect(f.low).toBeNull();
    expect(f.probability).toBeNull();
    expect(forecastLine(f, "he")).toContain("אין מספיק נתונים");
    expect(MIN_POINTS).toBe(7);
  });
  it("on track: about 2.5 a day for 15 days heads past 60 by the end of the month", () => {
    const f = forecast(goal({ target: 60 }), days("2026-11-01", Array(15).fill(2).map((v, i) => v + (i % 2 ? 1 : 0))), NOW);
    expect(f.risk).toBe("on_track");
    expect(f.expected!).toBeGreaterThan(60);
    expect(f.probability!).toBeGreaterThan(0.6);
    expect(f.low!).toBeLessThanOrEqual(f.expected!);
    expect(f.high!).toBeGreaterThanOrEqual(f.expected!);
  });
  it("off track: a trickle of 0.4 a day cannot reach 30", () => {
    const f = forecast(goal(), days("2026-11-01", [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), NOW);
    expect(f.risk).toBe("off_track");
    expect(f.probability!).toBeLessThan(0.25);
  });
  it("a noisy series gives a WIDER range than a steady one with the same mean", () => {
    const steady = forecast(goal({ target: 60 }), days("2026-11-01", Array(15).fill(2)), NOW);
    const noisy = forecast(goal({ target: 60 }), days("2026-11-01", [0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 2]), NOW);
    expect(noisy.high! - noisy.low!).toBeGreaterThan(steady.high! - steady.low!);
  });
  it("achieved is final for cumulative goals", () => {
    const f = forecast(goal({ target: 10 }), days("2026-11-01", Array(15).fill(2)), NOW);
    expect(f.risk).toBe("achieved");
    expect(f.probability).toBe(1);
  });
  it("after the due date: expired (not reached) — no forecast", () => {
    const f = forecast(goal({ due_date: "2026-11-10" }), days("2026-11-01", Array(9).fill(1)), NOW);
    expect(f.risk).toBe("expired");
  });
  it("missing days count as zero for cumulative metrics (a quiet day is data)", () => {
    const sparse: DailyPoint[] = [{ day: "2026-11-01", value: 9 }, { day: "2026-11-02", value: 9 }];
    const f = forecast(goal({ target: 100 }), sparse, NOW);
    expect(f.current).toBe(18);
    expect(f.pointsUsed).toBeGreaterThanOrEqual(MIN_POINTS);
    expect(f.risk).not.toBe("on_track");
  });
  it("level metric going DOWN (reply minutes): a falling trend is on track", () => {
    const g = goal({ metric: "reply_minutes", baseline: 12, target: 5 });
    const f = forecast(g, days("2026-11-01", [12, 11.5, 11, 10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.8, 5.5, 5.2]), NOW);
    expect(f.risk).toBe("on_track");
    const rising = forecast(g, days("2026-11-01", [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13]), NOW);
    expect(rising.risk).toBe("off_track");
  });
  it("level metric going UP (rating)", () => {
    const g = goal({ metric: "reviews_avg", baseline: 4.0, target: 4.6 });
    const f = forecast(g, days("2026-11-01", [4.0, 4.05, 4.1, 4.15, 4.2, 4.25, 4.3, 4.35, 4.4, 4.45, 4.5, 4.52, 4.55, 4.58, 4.6]), NOW);
    expect(["on_track", "achieved"]).toContain(f.risk);
  });
  it("normal CDF sanity", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("alerts: one per change", () => {
  it("raises only when entering at_risk / off_track", () => {
    expect(goalAlert("on_track", "at_risk")).toBe("at_risk");
    expect(goalAlert(null, "off_track")).toBe("off_track");
    expect(goalAlert("at_risk", "off_track")).toBe("off_track");
  });
  it("is silent when nothing changed, on recovery and on the data states", () => {
    expect(goalAlert("at_risk", "at_risk")).toBeNull();
    expect(goalAlert("off_track", "off_track")).toBeNull();
    expect(goalAlert("off_track", "at_risk")).toBeNull();
    expect(goalAlert("at_risk", "on_track")).toBeNull();
    expect(goalAlert("on_track", "not_enough_data")).toBeNull();
  });
});

describe("wording in three languages", () => {
  const f = forecast(goal(), days("2026-11-01", [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), NOW);
  it("every risk has a label in he / en / ar", () => {
    for (const r of ["achieved", "on_track", "at_risk", "off_track", "not_enough_data", "expired"] as const) for (const l of ["he", "en", "ar"] as const) expect(riskLabel(r, l).length).toBeGreaterThan(2);
  });
  it("the forecast line always shows a range and a probability, in the business language", () => {
    expect(forecastLine(f, "he")).toMatch(/טווח/);
    expect(forecastLine(f, "en")).toMatch(/range .*% chance/);
    expect(forecastLine(f, "ar")).toMatch(/النطاق/);
    expect(alertLine("יעד", "off_track", f, "he")).toContain("יעד");
  });
  it("card + prompt: only active goals reach the prompt", () => {
    const card = goalCard(goal(), f, "en");
    expect(card.progressPct).toBeLessThanOrEqual(100);
    const p = goalsPrompt([{ goal: goal(), forecast: f }, { goal: goal({ id: "g2", title: "paused one", status: "paused" }), forecast: f }], "en");
    expect(p).toContain("30 new leads");
    expect(p).not.toContain("paused one");
    expect(goalsPrompt([], "en")).toBe("");
  });
});

describe("tools wiring is additive", () => {
  it("all new tools are in the catalog, internal, and the old grants are untouched", () => {
    for (const t of UPGRADE7C_TOOLS) {
      expect(TOOLS.find((x) => x.key === t.key)).toBeTruthy();
      expect(t.sensitivity).toBe("internal");
    }
    const before = withRoleExtras7("manager", withRoleExtras("manager", ["team.ask_user"]));
    const after = withRoleExtras7c("manager", before);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toContain("goals.set");
    expect(withRoleExtras7c("customer_service", ["x"])).not.toContain("goals.set");
  });
  it("goals proposed by an employee are a write tool but never customer-facing", () => {
    expect(TOOLS.find((x) => x.key === "goals.set")).toMatchObject({ kind: "write", sensitivity: "internal" });
  });
});
