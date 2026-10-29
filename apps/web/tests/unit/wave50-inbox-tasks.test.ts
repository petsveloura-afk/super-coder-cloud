import { describe, expect, it } from "vitest";
import { COMPOSE_MODES, cleanRewrite, composeInstruction, isComposeMode, usableRewrite } from "@/lib/inbox/compose-core";
import { bucketOf, dayIn, focusCounts, focusHeadline, weeklyProgress } from "@/lib/tasks/focus-core";
import { AUTOMATION_RECIPES, automationSchema } from "@scc/shared/automations";
import he from "@/lib/i18n/dictionaries/he.json";

describe("wave 50 — inbox AI writing tools", () => {
  it("modes and instructions", () => {
    expect(COMPOSE_MODES).toContain("translate_en");
    expect(isComposeMode("improve")).toBe(true);
    expect(isComposeMode("hack")).toBe(false);
    for (const m of COMPOSE_MODES) expect(composeInstruction(m)).toMatch(/Never add prices/);
  });
  it("cleans the answer and rejects refusals", () => {
    expect(cleanRewrite('"שלום, נשמח לעזור"')).toBe("שלום, נשמח לעזור");
    expect(cleanRewrite("Here is the improved message:\nHi there")).toBe("Hi there");
    expect(cleanRewrite("```\nhello\n```")).toBe("hello");
    expect(usableRewrite("hi", "I'm sorry, I can't help")).toBe(false);
    expect(usableRewrite("hi", "")).toBe(false);
    expect(usableRewrite("hi", "Hello! How can we help?")).toBe(true);
  });
});

describe("wave 50 — tasks focus", () => {
  const now = new Date("2026-10-29T10:00:00Z"); // 12:00 in Israel
  const tz = "Asia/Jerusalem";
  it("buckets by due day in the business time zone", () => {
    expect(dayIn("2026-10-29T22:30:00Z", tz)).toBe("2026-10-30");
    expect(bucketOf({ status: "open", due_at: "2026-10-28T10:00:00Z" }, now, tz)).toBe("overdue");
    expect(bucketOf({ status: "open", due_at: "2026-10-29T18:00:00Z" }, now, tz)).toBe("today");
    expect(bucketOf({ status: "open", due_at: "2026-10-30T09:00:00Z" }, now, tz)).toBe("tomorrow");
    expect(bucketOf({ status: "open", due_at: "2026-11-03T09:00:00Z" }, now, tz)).toBe("week");
    expect(bucketOf({ status: "open", due_at: "2026-12-01T09:00:00Z" }, now, tz)).toBe("later");
    expect(bucketOf({ status: "open", due_at: null }, now, tz)).toBe("nodate");
    expect(bucketOf({ status: "done", due_at: null }, now, tz)).toBeNull();
  });
  it("counts, headline and progress", () => {
    const c = focusCounts([{ status: "open", due_at: "2026-10-28T10:00:00Z" }, { status: "in_progress", due_at: null }], now, tz);
    expect(c.overdue).toBe(1);
    expect(c.nodate).toBe(1);
    expect(focusHeadline(c)).toEqual({ key: "overdue", n: 1 });
    expect(focusHeadline({ overdue: 0, today: 0, tomorrow: 0, week: 0, later: 0, nodate: 0 }).key).toBe("clear");
    expect(weeklyProgress(3, 1)).toBe(75);
    expect(weeklyProgress(0, 0)).toBeNull();
  });
});

describe("wave 50 — automation templates", () => {
  it("20 valid recipes, each with texts", () => {
    expect(AUTOMATION_RECIPES.length).toBeGreaterThanOrEqual(20);
    const recipes = (he as unknown as { automations: { recipes: Record<string, { name: string; body: string }> } }).automations.recipes;
    for (const r of AUTOMATION_RECIPES) {
      expect(automationSchema.safeParse({ name: r.key, trigger_type: r.trigger_type, trigger_config: r.trigger_config, conditions: r.conditions, actions: r.actions }).success, r.key).toBe(true);
      expect(recipes[r.key]?.name, r.key).toBeTruthy();
    }
  });
});
