import { describe, expect, it } from "vitest";
import type { MemoryItem } from "@/lib/team/memory-core";
import { buildIndex, candidatesFor, clientMemories, clientSubject, consolidate, decayedConfidence, fadedIds, jaccard, lessonToMemory, lessonsFor, resolveConflicts, tokens } from "@/lib/team/memory-plus-core";
import { findDuplicateTask, handoffPackage, isQuietHour, orFilterFor, planWeekLadder, planWeekRetryable, renderDigest, slaStatus, slaSummary, smartContactQuery, templatesForRole } from "@/lib/team/ops-core";

const day = 86_400_000;
const NOW = Date.parse("2026-11-02T10:00:00Z");
const mem = (p: Partial<MemoryItem> & { id: string }): MemoryItem => ({ member_id: null, layer: "semantic", kind: "fact", subject: null, content: "x", tags: [], confidence: 0.8, status: "active", expires_at: null, created_at: new Date(NOW).toISOString(), ...p });

describe("smart memory", () => {
  it("consolidates near-duplicates into the strongest one and leaves different ones", () => {
    const a = mem({ id: "a", content: "The business closes at 18:00 on Fridays", confidence: 0.9 });
    const b = mem({ id: "b", content: "business closes at 18:00 on Fridays", confidence: 0.6 });
    const c = mem({ id: "c", content: "Prices include VAT" });
    const plans = consolidate([a, b, c]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.keepId).toBe("a");
    expect(plans[0]!.dropIds).toEqual(["b"]);
  });
  it("never merges hard rules and resolves conflicts on one subject, newest wins", () => {
    const old = mem({ id: "old", subject: "opening hours", content: "Open 9-17", created_at: new Date(NOW - 10 * day).toISOString() });
    const nw = mem({ id: "nw", subject: "Opening Hours", content: "Open 10-19 on weekdays", created_at: new Date(NOW).toISOString() });
    expect(resolveConflicts([old, nw])).toEqual([{ winner: "nw", loser: "old", subject: "Opening Hours" }]);
    const r1 = mem({ id: "r1", kind: "forbidden", content: "never say free" });
    const r2 = mem({ id: "r2", kind: "forbidden", content: "never say free" });
    expect(consolidate([r1, r2])).toHaveLength(0);
  });
  it("decays by importance: rules never fade, old outcomes fade first", () => {
    const old = new Date(NOW - 400 * day).toISOString();
    expect(decayedConfidence(mem({ id: "r", kind: "forbidden", created_at: old }), NOW)).toBe(0.8);
    const outcome = decayedConfidence(mem({ id: "o", kind: "outcome", layer: "episodic", created_at: old }), NOW);
    const pref = decayedConfidence(mem({ id: "p", kind: "preference", created_at: old }), NOW);
    expect(outcome).toBeLessThan(pref);
    expect(fadedIds([mem({ id: "o", kind: "outcome", layer: "episodic", created_at: old })], NOW)).toEqual(["o"]);
  });
  it("keeps customer memories apart and shares lessons between employees", () => {
    const m = [mem({ id: "1", subject: clientSubject("c1") + ":style" }), mem({ id: "2", subject: clientSubject("c2") + ":style" })];
    expect(clientMemories(m, "c1").map((x) => x.id)).toEqual(["1"]);
    const l = lessonToMemory({ fromRole: "customer_service", content: "Customers ask about parking first", forRoles: ["sales"] });
    expect(l.status).toBe("proposed");
    const active = mem({ id: "L", tags: l.tags, status: "active", content: l.content });
    expect(lessonsFor([active], "sales")).toHaveLength(1);
    expect(lessonsFor([active], "analyst")).toHaveLength(0);
  });
  it("finds candidates fast through the index and always includes hard rules", () => {
    const items = [mem({ id: "p", content: "parking is free behind the building" }), mem({ id: "q", content: "invoices are monthly" }), mem({ id: "f", kind: "forbidden", content: "no discounts" })];
    const ids = candidatesFor(buildIndex(items), "where can I park? parking").map((m) => m.id);
    expect(ids).toContain("p");
    expect(ids).toContain("f");
    expect(ids).not.toContain("q");
    expect(jaccard(tokens("abc def ghi"), tokens("abc def ghi"))).toBe(1);
  });
});

describe("practical abilities", () => {
  it("tracks SLA: ok → warning → breached, answered in time or late", () => {
    const t0 = NOW;
    expect(slaStatus({ receivedAt: t0, now: t0 + 10 * 60_000 }).state).toBe("ok");
    expect(slaStatus({ receivedAt: t0, now: t0 + 50 * 60_000 }).state).toBe("warning");
    expect(slaStatus({ receivedAt: t0, now: t0 + 90 * 60_000 }).state).toBe("breached");
    expect(slaStatus({ receivedAt: t0, firstReplyAt: t0 + 20 * 60_000, now: t0 + 999 * 60_000 }).state).toBe("answered");
    expect(slaSummary([slaStatus({ receivedAt: t0, now: t0 + 90 * 60_000 })]).breached).toBe(1);
  });
  it("quiet hours wrap midnight and respect the time zone", () => {
    const night = Date.parse("2026-11-02T21:30:00Z"); // 23:30 in Israel (UTC+2 in November)
    expect(isQuietHour(night, "Asia/Jerusalem", 22, 7)).toBe(true);
    expect(isQuietHour(Date.parse("2026-11-02T10:00:00Z"), "Asia/Jerusalem", 22, 7)).toBe(false);
    expect(isQuietHour(night, "Asia/Jerusalem", 8, 8)).toBe(false);
  });
  it("detects duplicate tasks for the same employee only", () => {
    const open = [{ id: "t1", role: "sales", title: "Follow up with stale leads this week" }];
    expect(findDuplicateTask({ role: "sales", title: "follow up with stale leads this week!" }, open)).toBe("t1");
    expect(findDuplicateTask({ role: "marketing", title: "Follow up with stale leads this week" }, open)).toBeNull();
    expect(findDuplicateTask({ role: "sales", title: "Prepare quote" }, open)).toBeNull();
  });
  it("builds a handoff package with the full context", () => {
    const p = handoffPackage({ reason: "angry_customer", taskTitle: "Reply to Dana", contact: "Dana Levi", lastMessages: ["customer: this is unacceptable"], recommended: "Call her today" });
    expect(p).toContain("angry customer");
    expect(p).toContain("Dana Levi");
    expect(p).toContain("Call her today");
  });
  it("renders the digest in three languages", () => {
    const f = { period: "day" as const, tasksDone: 4, tasksFailed: 1, pendingApprovals: 2, slaBreached: 0, avgResponseMin: 12, learnings: 3, health: "ok" as const };
    expect(renderDigest(f, "he")).toContain("דוח בוקר");
    expect(renderDigest(f, "en")).toContain("morning report");
    expect(renderDigest(f, "ar")).toContain("تقرير");
  });
  it("has templates per role", () => {
    expect(templatesForRole("sales").length).toBeGreaterThan(0);
  });
  it("searches contacts smarter: names split, status words understood, filler dropped", () => {
    expect(smartContactQuery("Dana Levi")).toEqual({ tokens: ["dana", "levi"], status: null });
    expect(smartContactQuery("new leads")).toEqual({ tokens: [], status: "lead" });
    expect(smartContactQuery("לידים חדשים")).toEqual({ tokens: [], status: "lead" });
    expect(orFilterFor("da%na")).toContain("first_name.ilike.%da na%");
  });
  it("plans the week with a fallback ladder", () => {
    expect(planWeekLadder(7)).toEqual([7, 3, 1]);
    expect(planWeekLadder(2)).toEqual([2, 1]);
    expect(planWeekRetryable("ai.failed")).toBe(true);
    expect(planWeekRetryable("social.brain.weekFull")).toBe(false);
  });
});
