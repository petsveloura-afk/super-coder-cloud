import { describe, expect, it } from "vitest";
import { hasOpenWaitingTask, queueCooldown, retryNote, taskBriefing, tickBudget } from "@/lib/team/team-intel-core";
import { localizeTitle } from "@/lib/team/title-i18n-core";

const NOW = Date.parse("2026-11-05T10:00:00Z");
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("wave 65 — adaptive tick budget", () => {
  it("keeps 3 when engines are fine, and slows down as 'busy' failures pile up", () => {
    expect(tickBudget([], 3)).toBe(3);
    expect(tickBudget(["429 rate limit"], 3)).toBe(3);
    expect(tickBudget(["429", "all engines failed"], 3)).toBe(2);
    expect(tickBudget(["429", "all engines failed", "ai_failed", "503"], 3)).toBe(1);
  });
  it("only 'busy' failures count, never a policy or input error", () => {
    expect(tickBudget(["emergency_stop", "no_assignee", "tool_not_allowed", null, undefined], 3)).toBe(3);
  });
  it("never exceeds the base", () => {
    expect(tickBudget(["429", "429"], 1)).toBe(1);
  });
});

describe("wave 65 — waiting-customers task cooldown", () => {
  it("creates one when nothing failed recently", () => {
    expect(queueCooldown([], NOW).skip).toBe(false);
    expect(queueCooldown([minAgo(400)], NOW).skip).toBe(false);
  });
  it("waits 30 / 90 / 180 minutes after 1 / 2 / 3 failures", () => {
    expect(queueCooldown([minAgo(10)], NOW)).toEqual({ skip: true, waitMs: 20 * 60_000 });
    expect(queueCooldown([minAgo(31)], NOW).skip).toBe(false);
    expect(queueCooldown([minAgo(60), minAgo(120)], NOW).skip).toBe(true);
    expect(queueCooldown([minAgo(100), minAgo(130)], NOW).skip).toBe(false);
    expect(queueCooldown([minAgo(100), minAgo(130), minAgo(160)], NOW).skip).toBe(true);
  });
  it("ignores garbage dates", () => {
    expect(queueCooldown(["??", ""], NOW).skip).toBe(false);
  });
});

describe("wave 65 — retried tasks", () => {
  it("a temporary failure gets the 'do not act twice' note; a real one does not", () => {
    expect(retryNote("ai_failed: all engines")).toContain("sent or created twice");
    expect(retryNote("fetch failed")).toContain("RETRY");
    expect(retryNote("emergency_stop")).toBe("");
    expect(retryNote("no_assignee")).toBe("");
    expect(retryNote(null)).toBe("");
    expect(retryNote("  ")).toBe("");
  });
  it("the briefing carries it", () => {
    expect(taskBriefing({ role: "customer_service", title: "מענה ללקוחות", brief: "", lastError: "429 rate", now: NOW })).toContain("RETRY");
    expect(taskBriefing({ role: "customer_service", title: "מענה ללקוחות", brief: "", now: NOW })).not.toContain("RETRY");
  });
});

describe("wave 65 — initiative titles in the business's language", () => {
  it("translates the numbered titles in Hebrew and Arabic", () => {
    expect(localizeTitle("Reach 1 new lead(s) that got no reply", "he")).toBe("לפנות ל-1 לידים חדשים שלא קיבלו מענה");
    expect(localizeTitle("6 conversation(s) waiting for an answer", "he")).toBe("6 שיחות שממתינות למענה");
    expect(localizeTitle("Answer 2 negative review(s)", "he")).toBe("לענות על 2 ביקורות שליליות");
    expect(localizeTitle("Revive 3 stuck deal(s)", "he")).toBe("להחיות 3 עסקאות תקועות");
    expect(localizeTitle("2 overdue invoice(s)", "he")).toBe("2 חשבוניות באיחור");
    expect(localizeTitle("No post for 6 days", "he")).toBe("אין פוסט כבר 6 ימים");
    expect(localizeTitle("Leads dropped sharply — find out why", "he")).toBe("ירידה חדה בלידים — לברר למה");
    expect(localizeTitle("6 conversation(s) waiting for an answer", "ar")).toContain("6");
  });
  it("English and unknown titles stay as they are", () => {
    expect(localizeTitle("Reach 1 new lead(s) that got no reply", "en")).toBe("Reach 1 new lead(s) that got no reply");
    expect(localizeTitle("Something custom the owner wrote", "he")).toBe("Something custom the owner wrote");
    expect(localizeTitle("מענה ללקוחות", "he")).toBe("מענה ללקוחות");
  });
});

describe("wave 65 — no double work on waiting customers", () => {
  it("an open initiative or queue task on the same customers blocks a second one", () => {
    expect(hasOpenWaitingTask(["6 conversation(s) waiting for an answer"])).toBe(true);
    expect(hasOpenWaitingTask(["מענה ללקוחות שממתינים"])).toBe(true);
    expect(hasOpenWaitingTask(["Reply to waiting customers"])).toBe(true);
    expect(hasOpenWaitingTask(["الرد على العملاء المنتظرين"])).toBe(true);
  });
  it("unrelated work does not", () => {
    expect(hasOpenWaitingTask([])).toBe(false);
    expect(hasOpenWaitingTask([null, undefined, "הכנת דוח שבועי", "Answer 2 negative review(s)"])).toBe(false);
  });
});
