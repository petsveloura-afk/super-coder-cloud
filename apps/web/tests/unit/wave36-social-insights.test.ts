import { describe, expect, it } from "vitest";
import { charInfo, computeStats, dayKey, filterComments, filterPosts, filterReviews, monthGrid, postsByDay, suggestedSlots, toCsv, POST_TEMPLATES, TEMPLATE_KEYS } from "@/lib/social/insights";

const now = new Date(2026, 9, 27, 12, 0);
const iso = (d: Date) => d.toISOString();
const post = (id: string, status: string, d: Date, platforms = ["facebook"], body = "שלום") => ({ id, status, scheduled_at: iso(d), platforms, body });

describe("wave 36 — social insights", () => {
  it("counts posts, comments and reviews and lists what needs attention", () => {
    const s = computeStats(
      [post("a", "failed", now), post("b", "draft", now), post("c", "scheduled", new Date(2026, 9, 29)), post("d", "partial", now), post("e", "scheduled", new Date(2026, 9, 26))],
      [
        { id: "1", platform: "facebook", author_name: "x", body: "bad", sentiment: "negative", status: "new", created_at: iso(now) },
        { id: "2", platform: "facebook", author_name: "y", body: "ok", sentiment: "positive", status: "replied", created_at: iso(now) },
      ],
      [
        { id: "r1", author: "a", rating: 1, body: "", reply: null, status: "new", reviewed_at: null },
        { id: "r2", author: "b", rating: 5, body: "", reply: "thanks", status: "replied", reviewed_at: null },
      ],
      now,
    );
    expect(s.posts).toMatchObject({ draft: 1, failed: 1, published: 1, scheduled: 2, nextWeek: 1 });
    expect(s.comments).toMatchObject({ open: 1, answered: 1, responseRate: 50 });
    expect(s.reviews).toMatchObject({ avg: 3, unanswered: 1 });
    expect(s.reviews.dist).toEqual([1, 0, 0, 0, 1]);
    expect(s.attention.map((a) => a.kind).sort()).toEqual(["draftWaiting", "failedPost", "lowReview", "negativeComment", "pastDue"]);
  });
  it("builds a Sunday-first month grid and groups posts by day", () => {
    const g = monthGrid(2026, 9);
    expect(g.length).toBeGreaterThanOrEqual(5);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(g[0]![0]!.key <= "2026-10-01").toBe(true);
    const m = postsByDay([post("a", "draft", new Date(2026, 9, 5, 18)), post("b", "draft", new Date(2026, 9, 5, 9))]);
    expect(m.get(dayKey(new Date(2026, 9, 5)))!.map((p) => p.id)).toEqual(["b", "a"]);
  });
  it("knows each network's limits", () => {
    expect(charInfo("a".repeat(2201), "instagram").tooLong).toBe(true);
    expect(charInfo("a".repeat(2201), "facebook").ok).toBe(true);
    expect(charInfo(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), "instagram").tooManyTags).toBe(true);
  });
  it("suggests three future times", () => {
    const s = suggestedSlots(now);
    expect(s).toHaveLength(3);
    expect(s.every((d) => d.getTime() > now.getTime())).toBe(true);
  });
  it("has every template in all three languages", () => {
    for (const l of ["he", "en", "ar"] as const) for (const k of TEMPLATE_KEYS) expect(POST_TEMPLATES[l][k].length).toBeGreaterThan(20);
  });
  it("filters", () => {
    expect(filterPosts([post("a", "failed", now), post("b", "published", now, ["instagram"])], { status: "failed", platform: "all", q: "" })).toHaveLength(1);
    expect(filterPosts([post("a", "partial", now)], { status: "published", platform: "all", q: "" })).toHaveLength(1);
    const c = [{ id: "1", platform: "facebook", author_name: "Dana", body: "מחיר?", sentiment: "question", status: "new", created_at: "" }];
    expect(filterComments(c, { status: "open", sentiment: "question", platform: "all", q: "dana" })).toHaveLength(1);
    expect(filterComments(c, { status: "done", sentiment: "all", platform: "all", q: "" })).toHaveLength(0);
    const r = [{ id: "1", author: "A", rating: 2, body: "slow", reply: null, status: "new", reviewed_at: null }];
    expect(filterReviews(r, { stars: "2", unanswered: true, q: "" })).toHaveLength(1);
    expect(filterReviews(r, { stars: "5", unanswered: false, q: "" })).toHaveLength(0);
  });
  it("exports CSV that Excel opens safely", () => {
    const csv = toCsv([["a", "b"], ['x,"y"', "=SUM(A1)"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"x,""y"""');
    expect(csv).toContain("'=SUM(A1)");
  });
});
