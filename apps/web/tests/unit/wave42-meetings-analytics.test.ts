import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildIcs,
  computeApptStats,
  detectJoinLink,
  googleCalendarUrl,
  isDayKey,
  layoutDay,
  monthGrid,
  relativeTime,
  safeZone,
  startOfWeekKey,
  zonedParts,
  type ApptRow,
} from "@/lib/appointments/insights";
import { analyticsCsv, buildHighlights, cumulative, delta, funnelSteps, movingAverage, previousWindow } from "@/lib/analytics/insights";

describe("wave 42 — calendar math", () => {
  it("reads wall-clock parts in the organisation's time zone (Israel is UTC+2 after DST ends)", () => {
    const p = zonedParts("2026-10-28T10:00:00Z", "Asia/Jerusalem");
    expect(p).toMatchObject({ year: 2026, month: 10, day: 28, hour: 12, minute: 0, weekday: 3 });
  });
  it("rolls the local day over midnight, not the UTC day", () => {
    expect(zonedParts("2026-10-28T23:30:00Z", "Asia/Jerusalem").day).toBe(29);
  });
  it("falls back to Jerusalem for an invalid zone", () => {
    expect(safeZone("Not/AZone")).toBe("Asia/Jerusalem");
    expect(safeZone(null)).toBe("Asia/Jerusalem");
  });
  it("adds days and months across boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("weeks start on Sunday", () => {
    expect(startOfWeekKey("2026-10-28")).toBe("2026-10-25"); // Wednesday → Sunday
    expect(startOfWeekKey("2026-10-25")).toBe("2026-10-25");
  });
  it("builds a month grid of full Sunday-first weeks", () => {
    const g = monthGrid("2026-10");
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]![0]).toBe("2026-09-27");
    expect(g.flat()).toContain("2026-10-31");
  });
  it("validates day keys", () => {
    expect(isDayKey("2026-10-28")).toBe(true);
    expect(isDayKey("2026-13-40")).toBe(false);
    expect(isDayKey("<script>")).toBe(false);
  });
  it("lays overlapping events side by side and keeps others full width", () => {
    const out = layoutDay([
      { id: "a", start: 600, end: 660 },
      { id: "b", start: 620, end: 700 },
      { id: "c", start: 900, end: 960 },
    ]);
    const by = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(by.a!.cols).toBe(2);
    expect(by.b!.cols).toBe(2);
    expect(by.a!.col).not.toBe(by.b!.col);
    expect(by.c!.cols).toBe(1);
  });
});

describe("wave 42 — join links, .ics, relative time", () => {
  it("finds Zoom / Meet / Teams links and ignores non-http schemes", () => {
    expect(detectJoinLink("https://us02web.zoom.us/j/123?pwd=abc")?.provider).toBe("zoom");
    expect(detectJoinLink("קישור: https://meet.google.com/abc-defg-hij.")?.url).toBe("https://meet.google.com/abc-defg-hij");
    expect(detectJoinLink(null, "https://teams.microsoft.com/l/meetup-join/xyz")?.provider).toBe("teams");
    expect(detectJoinLink("javascript:alert(1)")).toBeNull();
    expect(detectJoinLink("Tel Aviv, Rothschild 1")).toBeNull();
  });
  it("builds a valid single-event calendar file with escaping", () => {
    const ics = buildIcs({ id: "abc", title: "Demo; with, commas", starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-01T08:30:00Z", location: "Office", notes: "line1\nline2" });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20261101T080000Z");
    expect(ics).toContain("SUMMARY:Demo\\; with\\, commas");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
  });
  it("builds a Google Calendar template link", () => {
    const u = new URL(googleCalendarUrl({ title: "x", starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-01T09:00:00Z" }));
    expect(u.searchParams.get("dates")).toBe("20261101T080000Z/20261101T090000Z");
  });
  it("formats relative time", () => {
    const now = new Date("2026-10-28T10:00:00Z");
    expect(relativeTime("2026-10-28T12:00:00Z", "en-US", now)).toMatch(/2 hours/);
    expect(relativeTime("2026-10-30T10:00:00Z", "en-US", now)).toMatch(/2 days/);
  });
});

describe("wave 42 — meeting statistics", () => {
  const base = { location: null, notes: null, contact_id: null, type_id: null };
  const rows: ApptRow[] = [
    { ...base, id: "1", title: "a", starts_at: "2026-10-26T08:00:00Z", ends_at: "2026-10-26T08:30:00Z", status: "completed", host_id: "h1", created_at: "2026-10-24T08:00:00Z" },
    { ...base, id: "2", title: "b", starts_at: "2026-10-26T08:00:00Z", ends_at: "2026-10-26T09:00:00Z", status: "completed", host_id: "h1", created_at: "2026-10-25T08:00:00Z" },
    { ...base, id: "3", title: "c", starts_at: "2026-10-27T08:00:00Z", ends_at: "2026-10-27T08:30:00Z", status: "no_show", host_id: "h2", created_at: "2026-10-26T08:00:00Z" },
    { ...base, id: "4", title: "d", starts_at: "2026-10-28T08:00:00Z", ends_at: "2026-10-28T08:30:00Z", status: "canceled", host_id: "h2", created_at: "2026-10-26T08:00:00Z" },
  ];
  const s = computeApptStats(rows, "Asia/Jerusalem");
  it("computes show / no-show / cancel rates from resolved meetings only", () => {
    expect(s.total).toBe(4);
    expect(s.showRate).toBeCloseTo(2 / 3);
    expect(s.noShowRate).toBeCloseTo(1 / 3);
    expect(s.cancelRate).toBeCloseTo(1 / 4);
    expect(s.completionRate).toBeCloseTo(2 / 4);
  });
  it("counts hours without canceled meetings and finds the busiest slot", () => {
    expect(s.bookedHours).toBe(1.5); // 30 + 60 minutes held; no-shows and canceled meetings are not counted
    expect(s.busiest).toMatchObject({ weekday: 1, hour: 10, count: 2 }); // Monday 10:00 local
  });
  it("groups by week and host", () => {
    expect(s.weekly).toHaveLength(1);
    expect(s.weekly[0]).toMatchObject({ week: "2026-10-25", total: 4, completed: 2, noShow: 1, canceled: 1 });
    expect(s.byHost.find((h) => h.host === "h1")).toMatchObject({ count: 2, completed: 2 });
  });
  it("returns null rates (not NaN) for an empty set", () => {
    const e = computeApptStats([], "Asia/Jerusalem");
    expect(e.showRate).toBeNull();
    expect(e.cancelRate).toBeNull();
    expect(e.busiest).toBeNull();
  });
});

describe("wave 42 — analytics helpers", () => {
  it("computes deltas with and without a baseline", () => {
    expect(delta(150, 100)).toMatchObject({ abs: 50, pct: 0.5, dir: "up" });
    expect(delta(50, 100)).toMatchObject({ pct: -0.5, dir: "down" });
    expect(delta(10, 0).pct).toBeNull();
    expect(delta(5, 5).dir).toBe("flat");
  });
  it("derives the previous window from the doubled window", () => {
    expect(previousWindow(40, 100)).toBe(60);
    expect(previousWindow(120, 100)).toBe(0);
  });
  it("computes stage ratios without dividing by zero", () => {
    const f = funnelSteps([
      { name: "A", value: 1000, deals: 10 },
      { name: "B", value: 500, deals: 5 },
      { name: "C", value: 0, deals: 0 },
    ]);
    expect(f[1]).toMatchObject({ fromPrev: 0.5, ofFirst: 0.5, drop: 0.5 });
    expect(f[2]!.fromPrev).toBe(0);
    expect(funnelSteps([{ name: "A", value: 0, deals: 0 }, { name: "B", value: 5, deals: 1 }])[1]!.fromPrev).toBeNull();
  });
  it("builds cumulative and moving-average series", () => {
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
    expect(movingAverage([3, 6, 9], 3)).toEqual([3, 4.5, 6]);
  });
  it("neutralises formula injection and prefixes a BOM in CSV", () => {
    const csv = analyticsCsv([["=SUM(A1)", 5, null]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"'=SUM(A1)\"");
  });
  it("produces only evidence-based highlights", () => {
    const fmt = { pct: (v: number) => `${Math.round(v * 100)}%`, money: (v: number) => `₪${v}` };
    const none = buildHighlights(
      { winRate: null, closed: 0, wonValue: 0, prevWonValue: 0, contactsNew: 0, prevContactsNew: 0, tasksOverdue: 0, openDeals: 0, openValue: 0, weightedValue: 0, bestSource: null, topSeller: null, bestRoasSource: null, worstRoasSource: null, ltvCac: null, biggestDrop: null },
      fmt,
    );
    expect(none).toEqual([]);
    const some = buildHighlights(
      { winRate: 0.6, closed: 10, wonValue: 200, prevWonValue: 100, contactsNew: 50, prevContactsNew: 100, tasksOverdue: 6, openDeals: 4, openValue: 1000, weightedValue: 100, bestSource: { source: "Facebook", count: 9 }, topSeller: null, bestRoasSource: null, worstRoasSource: { source: "Google", roas: 0.4 }, ltvCac: 4, biggestDrop: null },
      fmt,
    );
    const ids = some.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(["rev-up", "win-good", "leads-down", "best-source", "worst-roas", "ltv-good", "overdue", "pipe-weak"]));
    expect(some.find((h) => h.id === "overdue")!.tone).toBe("danger");
  });
});
