import { describe, expect, it } from "vitest";
import { geminiThinking, hedged, hedgeDelayMs, isThinkingConfigError, latencyLabel, nextThinkingLevel, selfCheckBudgetMs, smartDebounceMs, Timing, withSoftDeadline } from "@/lib/ai/speed-core";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("speed: Gemini thinking", () => {
  it("2.5 Flash keeps thinking off; 3.x chat uses the lowest level; env overrides", () => {
    expect(geminiThinking("gemini-2.5-flash")).toEqual({ thinkingBudget: 0 });
    expect(geminiThinking("gemini-3.6-flash")).toEqual({ thinkingLevel: "minimal" });
    expect(geminiThinking("gemini-3.5-flash-lite")).toEqual({ thinkingLevel: "minimal" });
    expect(geminiThinking("gemini-3.8-flash")).toEqual({ thinkingLevel: "low" });
    expect(geminiThinking("gemini-3.1-pro-preview")).toEqual({ thinkingLevel: "low" });
    expect(geminiThinking("gemini-flash-latest")).toEqual({ thinkingLevel: "minimal" });
    expect(geminiThinking("gemini-1.5-pro")).toBeNull();
    expect(geminiThinking("gemini-3.6-flash", { AI_GEMINI_THINKING_LEVEL: "off" })).toBeNull();
    expect(geminiThinking("gemini-3.6-flash", { AI_GEMINI_THINKING_LEVEL: "medium" })).toEqual({ thinkingLevel: "medium" });
    expect(geminiThinking("gemini-3.6-flash", {}, "deep")).toBeNull();
  });
  it("a rejected level steps up once, then the model default", () => {
    expect(nextThinkingLevel("minimal")).toBe("low");
    expect(nextThinkingLevel("low")).toBeNull();
    expect(isThinkingConfigError(400, "Thinking level MINIMAL is not supported")).toBe(true);
    expect(isThinkingConfigError(400, "API key not valid")).toBe(false);
    expect(isThinkingConfigError(429, "thinking")).toBe(false);
  });
});

describe("speed: smart debounce", () => {
  it("a complete question is answered at once, a fragment waits a little", () => {
    expect(smartDebounceMs(2500, "כמה עולה תספורת?")).toBe(500);
    expect(smartDebounceMs(2500, "היי")).toBe(1200);
    expect(smartDebounceMs(2500, "אני רוצה לקבוע תור לכלב שלי למחר בבוקר")).toBe(500);
    expect(smartDebounceMs(2500, "0541234567")).toBe(500);
    expect(smartDebounceMs(0, "x")).toBe(0);
    expect(smartDebounceMs(undefined, "x")).toBe(0);
    expect(smartDebounceMs(2500, "היי", { AI_AUTOPILOT_DEBOUNCE_MS: "3000" })).toBe(3000);
    expect(smartDebounceMs(2500, "היי", { AI_AUTOPILOT_DEBOUNCE_MS: "0" })).toBe(0);
  });
  it("hedge and self-check budgets", () => {
    expect(hedgeDelayMs({})).toBe(6000);
    expect(hedgeDelayMs({ AI_HEDGE_MS: "0" })).toBe(0);
    expect(hedgeDelayMs({ AI_HEDGE_MS: "2500" })).toBe(2500);
    expect(selfCheckBudgetMs({})).toBe(7000);
    expect(selfCheckBudgetMs({ AI_SELF_CHECK_MS: "3000" })).toBe(3000);
  });
});

describe("speed: hedged request", () => {
  it("a fast primary wins and the backup never starts", async () => {
    let backup = 0;
    const r = await hedged(async () => "A", async () => { backup++; return "B"; }, 50);
    expect(r).toBe("A");
    await wait(80);
    expect(backup).toBe(0);
  });
  it("a slow primary: the backup starts and the first answer wins", async () => {
    let started = false;
    const r = await hedged(async () => { await wait(200); return "A"; }, async () => { await wait(10); return "B"; }, 30, () => { started = true; });
    expect(r).toBe("B");
    expect(started).toBe(true);
  });
  it("backup fails → the primary still answers; both fail → the primary's error", async () => {
    expect(await hedged(async () => { await wait(80); return "A"; }, async () => { throw new Error("b"); }, 10)).toBe("A");
    await expect(hedged(async () => { await wait(40); throw new Error("a"); }, async () => { throw new Error("b"); }, 10)).rejects.toThrow("a");
    await expect(hedged(async () => { throw new Error("fast-a"); }, async () => "B", 50)).rejects.toThrow("fast-a");
  });
});

describe("speed: deadlines and timing", () => {
  it("soft deadline returns the fallback, never throws", async () => {
    expect(await withSoftDeadline(wait(100).then(() => 1), 20, 0)).toBe(0);
    expect(await withSoftDeadline(Promise.resolve(5), 50, 0)).toBe(5);
    expect(await withSoftDeadline(Promise.reject(new Error("x")), 50, -1)).toBe(-1);
  });
  it("timing marks stages and labels latency", () => {
    let now = 1000;
    const t = new Timing(() => now);
    now += 120;
    t.mark("load");
    now += 2300;
    t.mark("ai");
    expect(t.toJSON()).toEqual({ load: 120, ai: 2300, total: 2420 });
    expect(latencyLabel(850)).toBe("850ms");
    expect(latencyLabel(2420)).toBe("2.4s");
    expect(latencyLabel(15000)).toBe("15s");
    expect(latencyLabel(undefined)).toBeNull();
  });
});
