import { describe, expect, it } from "vitest";
import { buildReport, compare, detectAnomaly, inventedFigures, morningBrief } from "@/lib/team/reports-core";
import { TtlCache, chooseByTier, modelCostRank, optimistic, tierFor } from "@/lib/team/speed-core";

const series = (vals: number[]) => vals.map((v, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, value: v }));
describe("anomalies — thresholds in code", () => {
  const calm = [5, 6, 4, 5, 7, 5, 6, 4, 5, 6, 5, 4, 6, 5];
  it("needs enough history", () => expect(detectAnomaly("leads", series([5, 5, 5, 40]))).toBeNull());
  it("a normal day is not flagged", () => expect(detectAnomaly("leads", series([...calm, 7]))).toBeNull());
  it("a real spike and a real drop are flagged with direction", () => {
    expect(detectAnomaly("leads", series([...calm, 30]))).toMatchObject({ direction: "up", expected: 5.2 });
    expect(detectAnomaly("leads", series([...calm.map((v) => v + 10), 1]))?.direction).toBe("down");
  });
  it("tiny absolute moves on a tiny base are ignored", () => expect(detectAnomaly("leads", series([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 3]))).toBeNull());
});
describe("compare + reports", () => {
  it("direction-aware: a faster reply time is GOOD", () => {
    const c = compare({ reply_minutes: 4, leads: 30 }, { reply_minutes: 8, leads: 20 });
    expect(c.find((x) => x.metric === "reply_minutes")).toMatchObject({ good: true, notable: true });
    expect(c.find((x) => x.metric === "leads")).toMatchObject({ good: true, pct: 0.5 });
  });
  it("small bases are not notable", () => expect(compare({ leads: 3 }, { leads: 1 })[0]!.notable).toBe(false));
  it("a Hebrew weekly report is built from the numbers, with wins, risks, anomalies and next steps", () => {
    const r = buildReport({ period: "week", cur: { leads: 30, deals_won: 5, reply_minutes: 9 }, prev: { leads: 20, deals_won: 10, reply_minutes: 5 }, anomalies: [{ metric: "leads", day: "2026-11-01", value: 30, expected: 5, z: 4, direction: "up" }], goals: [{ title: "30 לידים", risk: "at_risk", line: "בסיכון" }], recommendations: [{ title: "לקצר זמן מענה", why: "9 דקות" }], lang: "he" });
    expect(r.title).toBe("דוח שבועי");
    expect(r.sections.map((s) => s.key)).toEqual(["numbers", "wins", "risks", "anomalies", "next"]);
    expect(r.text).toContain("לידים חדשים: 30 (+50%)");
    expect(r.sections.find((s) => s.key === "risks")!.lines.join()).toContain("עסקאות שנסגרו -50%");
    expect(r.text).toContain("30 לידים");
  });
  it("English / Arabic titles; empty periods say 'no change'", () => {
    expect(buildReport({ period: "month", cur: { leads: 10 }, prev: { leads: 10 }, lang: "en" }).title).toBe("Monthly report");
    expect(buildReport({ period: "month", cur: { leads: 10 }, prev: { leads: 10 }, lang: "ar" }).title).toBe("تقرير شهري");
    expect(buildReport({ period: "week", cur: { leads: 10 }, prev: { leads: 10 }, lang: "en" }).sections[1]!.lines).toEqual(["No material change"]);
  });
  it("a polished text with an invented figure is caught", () => {
    expect(inventedFigures("Leads reached 300 this week", [30, 20])).toEqual([300]);
    expect(inventedFigures("Leads were 30, up 50%", [30, 20])).toEqual([]);
  });
});
describe("morning brief", () => {
  it("top 3, goals first", () => {
    const b = morningBrief({ goals: [{ title: "G", risk: "off_track" }], unanswered: 4, waitingApprovals: 2, stuckDeals: 1, lang: "he" });
    expect(b.items.map((x) => x.kind)).toEqual(["goal", "unanswered", "approvals"]);
    expect(b.text).toContain("1. יעד בסיכון: G");
  });
  it("quiet morning", () => expect(morningBrief({ lang: "en" }).text).toContain("nothing urgent"));
});
describe("optimistic", () => {
  it("shows at once, keeps on success", async () => {
    let s = 1;
    const seen: number[] = [];
    const r = await optimistic(() => s, (x) => { s = x; seen.push(x); }, (x) => x + 1, async () => ({ data: "ok" }));
    expect(r).toEqual({ ok: true, value: "ok" });
    expect(seen).toEqual([2]);
  });
  it("restores on a server error and on a thrown error", async () => {
    let s = 1;
    const set = (x: number) => { s = x; };
    expect(await optimistic(() => s, set, (x) => x + 1, async () => ({ error: "errors.forbidden" }))).toEqual({ ok: false, error: "errors.forbidden" });
    expect(s).toBe(1);
    expect((await optimistic(() => s, set, (x) => x + 5, async () => { throw new Error("network"); })).ok).toBe(false);
    expect(s).toBe(1);
  });
});
describe("TtlCache", () => {
  it("expires by time and by invalidation, bounded size, wrap loads once", async () => {
    let t = 0;
    const c = new TtlCache<number>(1000, 2, () => t);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    t = 1500;
    expect(c.get("a")).toBeUndefined();
    t = 0;
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.size).toBe(2);
    c.invalidate();
    expect(c.get("b")).toBeUndefined();
    let loads = 0;
    const load = async () => ++loads;
    await c.wrap("x", load); await c.wrap("x", load);
    expect(loads).toBe(1);
  });
});
describe("cost routing", () => {
  it("cheap for classification / summaries and simple work, strong only for risky plan / review", () => {
    expect(tierFor("classify", "deep")).toBe("cheap");
    expect(tierFor("summarize", "fast")).toBe("cheap");
    expect(tierFor("plan", "fast")).toBe("cheap");
    expect(tierFor("plan", "deep")).toBe("strong");
    expect(tierFor("review", "deep")).toBe("strong");
    expect(tierFor("write", "fast", true)).toBe("balanced");
  });
  it("picks the closest model to the tier", () => {
    const models = [{ model: "claude-haiku-5-5" }, { model: "claude-sonnet-5-5" }, { model: "claude-opus-5-5" }];
    expect(chooseByTier(models, "cheap")?.model).toBe("claude-haiku-5-5");
    expect(chooseByTier(models, "balanced")?.model).toBe("claude-sonnet-5-5");
    expect(chooseByTier(models, "strong")?.model).toBe("claude-opus-5-5");
    expect(chooseByTier([], "cheap")).toBeNull();
    expect(modelCostRank("gpt-4o-mini")).toBe(2);
  });
});
