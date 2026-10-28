import { describe, expect, it } from "vitest";
import {
  adaptiveWinChance, bottleneck, compareDeals, dealHealth, daysUntil, focusList, forecast, matchesBrainFlag,
  nextBestAction, ownerBoard, salesVelocity, stageFlow, stageProgressMap, type BrainDeal, type StageHistoryRow,
} from "@/lib/deals/brain";

const NOW = new Date("2026-10-28T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base: BrainDeal = { id: "d1", title: "x", value: 1000, stage_id: "s1", expected_close_date: "2026-11-05", owner_id: "u1", contact_id: "c1", updated_at: ago(1) };

describe("wave 38 — deal health", () => {
  it("a fresh, owned deal with a contact and a near close date is hot", () => {
    const h = dealHealth(base, { now: NOW });
    expect(h.level).toBe("hot");
    expect(h.reasons).toContain("fresh");
    expect(h.score).toBeGreaterThanOrEqual(82);
  });
  it("a stale, overdue, ownerless deal is at risk and says why", () => {
    const h = dealHealth({ ...base, updated_at: ago(40), expected_close_date: "2026-10-01", owner_id: null, contact_id: null }, { now: NOW });
    expect(h.level).toBe("risk");
    expect(h.reasons).toEqual(expect.arrayContaining(["veryStale", "overdue", "noOwner", "noContact"]));
    expect(h.score).toBeLessThan(40);
  });
  it("score always stays within 0..100", () => {
    const worst = dealHealth({ ...base, updated_at: ago(400), expected_close_date: "2020-01-01", owner_id: null, contact_id: null }, { now: NOW });
    const best = dealHealth({ ...base, updated_at: ago(0) }, { now: NOW, stageProgress: new Map([["s1", 1]]) });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(best.score).toBeLessThanOrEqual(100);
  });
  it("flags slow-in-stage against the stage benchmark", () => {
    const h = dealHealth({ ...base, stage_entered_at: ago(20), updated_at: ago(2) }, { now: NOW, stageBenchmarkDays: new Map([["s1", 4]]) });
    expect(h.reasons).toContain("slowInStage");
    expect(h.daysInStage).toBe(20);
  });
  it("daysUntil counts calendar days and ignores bad input", () => {
    expect(daysUntil("2026-10-28", NOW)).toBe(0);
    expect(daysUntil("2026-10-30", NOW)).toBe(2);
    expect(daysUntil("2026-10-25", NOW)).toBe(-3);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("nope", NOW)).toBeNull();
  });
});

describe("wave 38 — adaptive win chance", () => {
  it("healthy deals beat the stage probability, unhealthy ones fall below it", () => {
    expect(adaptiveWinChance(50, 100)).toBeGreaterThan(50);
    expect(adaptiveWinChance(50, 0)).toBeLessThan(50);
    expect(adaptiveWinChance(50, 50)).toBeCloseTo(50, -1);
  });
  it("is never 0 or 100", () => {
    expect(adaptiveWinChance(0, 0)).toBe(1);
    expect(adaptiveWinChance(100, 100)).toBe(99);
  });
});

describe("wave 38 — next best action", () => {
  it("picks the most urgent problem first", () => {
    const h = (d: BrainDeal) => dealHealth(d, { now: NOW });
    expect(nextBestAction({ ...base, expected_close_date: "2026-10-01" }, h({ ...base, expected_close_date: "2026-10-01" })).key).toBe("rescheduleClose");
    const stale = { ...base, updated_at: ago(40) };
    expect(nextBestAction(stale, h(stale)).key).toBe("reviveNow");
    const noOwner = { ...base, owner_id: null };
    expect(nextBestAction(noOwner, h(noOwner)).key).toBe("assignOwner");
    const noDate = { ...base, expected_close_date: null };
    expect(nextBestAction(noDate, h(noDate)).key).toBe("setCloseDate");
    expect(nextBestAction({ ...base, expected_close_date: "2026-12-30" }, h({ ...base, expected_close_date: "2026-12-30" })).key).toBe("keepGoing");
  });
});

describe("wave 38 — stage flow, bottleneck", () => {
  const stages = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
  const row = (deal: string, from: string | null, to: string, days: number): StageHistoryRow => ({ deal_id: deal, from_stage_id: from, to_stage_id: to, entered_at: ago(days) });
  const history: StageHistoryRow[] = [
    row("a", null, "s1", 30), row("a", "s1", "s2", 28), row("a", "s2", "s3", 10),
    row("b", null, "s1", 20), row("b", "s1", "s2", 18),
    row("c", null, "s1", 15),
    row("d", null, "s1", 12), row("d", "s1", "s2", 11), row("d", "s2", "s3", 2),
  ];
  const flow = stageFlow(stages, history, new Map([["a", "s3"], ["b", "s2"], ["c", "s1"], ["d", "s3"]]), new Set(["a"]));
  it("counts entries, advances and conversion", () => {
    expect(flow[0]).toMatchObject({ entered: 4, advanced: 3, conversion: 75, current: 1 });
    expect(flow[1]).toMatchObject({ entered: 3, advanced: 2, current: 1 });
  });
  it("measures average days in a stage once left", () => {
    expect(flow[0]!.avgDays).toBe(1.7); // a:2, b:2, d:1 days -> 1.67, one decimal
  });
  it("won deals count as having passed their last stage", () => {
    expect(flow[2]!.advanced).toBe(1);
  });
  it("no bottleneck without enough data", () => {
    expect(bottleneck(stageFlow(stages, [row("z", null, "s1", 3)], new Map([["z", "s1"]])))).toBeNull();
  });
  it("finds a slow stage", () => {
    const slow = [
      ...["a", "b", "c", "d"].flatMap((id) => [row(id, null, "s1", 60), row(id, "s1", "s2", 58), row(id, "s2", "s3", 10)]),
    ];
    const f = stageFlow(stages, slow, new Map(), new Set(["a", "b", "c", "d"]));
    expect(bottleneck(f)).toEqual({ stageId: "s2", reason: "slow" });
  });
});

describe("wave 38 — forecast", () => {
  const prob = new Map([["s1", 20], ["s2", 80]]);
  const deals = [
    { value: 1000, stage_id: "s2", expected_close_date: "2026-10-30", health: 90 },
    { value: 2000, stage_id: "s1", expected_close_date: "2026-10-31", health: 50 },
    { value: 500, stage_id: "s2", expected_close_date: "2026-12-10", health: 70 },
    { value: 700, stage_id: "s1", expected_close_date: null, health: 70 },
  ];
  const f = forecast(deals, prob, NOW);
  it("commit only holds late-stage healthy deals closing this month", () => {
    expect(f.commit).toBe(1000);
  });
  it("best case is everything dated this month at full value", () => {
    expect(f.bestCase).toBe(3000);
    expect(f.pipelineTotal).toBe(4200);
  });
  it("expected is below best case and above commit's weighted floor", () => {
    expect(f.expected).toBeLessThan(f.bestCase);
    expect(f.expected).toBeGreaterThan(0);
  });
  it("buckets six months and collects undated deals", () => {
    expect(f.months).toHaveLength(6);
    expect(f.months[0]!.key).toBe("2026-10");
    expect(f.months[2]!.count).toBe(1);
    expect(f.undated.count).toBe(1);
  });
});

describe("wave 38 — velocity and owners", () => {
  it("sales velocity needs closed history and cycle dates", () => {
    expect(salesVelocity(10, []).perDay).toBeNull();
    const v = salesVelocity(10, [
      { status: "won", value: 1000, created_at: ago(20), closed_at: ago(0) },
      { status: "won", value: 3000, created_at: ago(40), closed_at: ago(0) },
      { status: "lost", value: 500 },
      { status: "lost", value: 500 },
    ]);
    expect(v.winRate).toBe(50);
    expect(v.avgCycleDays).toBe(30);
    expect(v.perDay).toBe(Math.round((10 * 0.5 * 2000) / 30));
    expect(v.perMonth).toBe(10_000); // computed from the unrounded daily value
  });
  it("owner board ranks by weighted value and computes win rate", () => {
    const rows = ownerBoard(
      [
        { owner_id: "a", value: 100, weighted: 40, health: "risk" },
        { owner_id: "b", value: 500, weighted: 300, health: "hot" },
        { owner_id: null, value: 50, weighted: 5, health: "cooling" },
      ],
      [{ owner_id: "a", status: "won" }, { owner_id: "a", status: "lost" }, { owner_id: "a", status: "won" }],
    );
    expect(rows.map((r) => r.ownerId)).toEqual(["b", "a", null]);
    expect(rows[1]).toMatchObject({ open: 1, atRisk: 1, won: 2, lost: 1, winRate: 67 });
  });
});

describe("wave 38 — focus list, flags, sorting", () => {
  const mk = (over: Partial<BrainDeal> & { id: string }) => {
    const d: BrainDeal = { ...base, ...over };
    const health = dealHealth(d, { now: NOW });
    return { ...d, health, winChance: adaptiveWinChance(50, health.score) };
  };
  it("puts valuable rescuable deals first and leaves healthy ones out", () => {
    const list = focusList([mk({ id: "fine" }), mk({ id: "big", value: 90_000, updated_at: ago(20) }), mk({ id: "small", value: 100, updated_at: ago(20) })], 5);
    expect(list.map((x) => x.id)).toEqual(["big", "small"]);
  });
  it("respects the limit", () => {
    const many = Array.from({ length: 9 }, (_, i) => mk({ id: `x${i}`, updated_at: ago(20) }));
    expect(focusList(many, 3)).toHaveLength(3);
  });
  it("flags", () => {
    const d = mk({ id: "a", owner_id: null, expected_close_date: null });
    expect(matchesBrainFlag("unassigned", d, d.health)).toBe(true);
    expect(matchesBrainFlag("nodate", d, d.health)).toBe(true);
    expect(matchesBrainFlag("hot", d, d.health)).toBe(false);
  });
  it("sorts weakest health first and value descending", () => {
    const a = { ...mk({ id: "a", updated_at: ago(40) }), position: 1 };
    const b = { ...mk({ id: "b" }), position: 0 };
    expect([a, b].sort(compareDeals("health"))[0]!.id).toBe("a");
    expect([a, b].sort(compareDeals("position"))[0]!.id).toBe("b");
    expect([{ ...a, value: 1 }, { ...b, value: 9 }].sort(compareDeals("value"))[0]!.id).toBe("b");
  });
  it("stage progress spans 0..1", () => {
    const m = stageProgressMap([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual([0, 0.5, 1]);
  });
});
