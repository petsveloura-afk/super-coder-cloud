import { describe, expect, it } from "vitest";
import { applyHealth, circuitOf, cleanHealth, isPermanentError, modelKey, openMs, recordResult, summarizeHealth, type HealthState } from "@/lib/team/model-health-core";
import { backoffMs, classifyFailure, isStuck, nextRetry, teamHealth, tooSoon } from "@/lib/team/reliability-core";

const G = modelKey("gemini", "gemini-3.8-flash");
const route = [
  { provider: "gemini", model: "gemini-3.8-flash" },
  { provider: "groq", model: "llama-70b" },
  { provider: "mistral", model: "large" },
];

describe("model health / circuit breaker", () => {
  it("opens after the threshold of consecutive failures and moves the model to the end — nothing is removed", () => {
    let s: HealthState = {};
    s = recordResult(s, G, false, 1000, "timeout");
    expect(circuitOf(s, G, 1000)).toBe("closed");
    s = recordResult(s, G, false, 2000, "timeout");
    expect(circuitOf(s, G, 2500)).toBe("open");
    const r = applyHealth(route, s, 2500);
    expect(r).toHaveLength(3);
    expect(r[0]!.provider).toBe("groq");
    expect(r[2]!.provider).toBe("gemini");
  });
  it("a permanent error (model not found) opens at once", () => {
    expect(isPermanentError("404 model not found")).toBe(true);
    const s = recordResult({}, G, false, 0, "404 model_not_found");
    expect(circuitOf(s, G, 1)).toBe("open");
  });
  it("becomes half-open after the rest time and closes on a success", () => {
    let s = recordResult({}, G, false, 0, "404 not found");
    const later = openMs(1) + 1;
    expect(circuitOf(s, G, later)).toBe("half_open");
    expect(applyHealth(route, s, later)[0]!.provider).toBe("groq");
    s = recordResult(s, G, true, later);
    expect(circuitOf(s, G, later)).toBe("closed");
    expect(applyHealth(route, s, later)[0]!.provider).toBe("gemini");
  });
  it("the rest time grows with every trip and is capped", () => {
    expect(openMs(1)).toBe(30_000);
    expect(openMs(2)).toBe(60_000);
    expect(openMs(30)).toBe(15 * 60_000);
  });
  it("does not mutate its input and summarizes unhealthy first", () => {
    const s0: HealthState = {};
    const s1 = recordResult(s0, G, false, 0, "404");
    expect(Object.keys(s0)).toHaveLength(0);
    const s2 = recordResult(s1, modelKey("groq", "llama-70b"), true, 0);
    expect(summarizeHealth(s2, 1)[0]!.key).toBe(G);
  });
  it("cleans garbage from the database", () => {
    expect(cleanHealth(null)).toEqual({});
    expect(cleanHealth({ "bad key": {}, "gemini/x-model": { fails: 2, openUntil: "x" } })["gemini/x-model"]!.openUntil).toBe(0);
  });
});

describe("reliability", () => {
  it("classifies failures with a clear, stable reason", () => {
    expect(classifyFailure("emergency_stop").retryable).toBe(false);
    expect(classifyFailure("ai.failed").kind).toBe("ai_busy");
    expect(classifyFailure("plan_unreadable").kind).toBe("ai_unreadable");
    expect(classifyFailure("fetch failed").kind).toBe("network");
    expect(classifyFailure("daily_credit_cap").kind).toBe("budget");
  });
  it("backoff grows, is capped and jittered within bounds", () => {
    expect(backoffMs(1, { jitter: 0 }, () => 0.5)).toBe(30_000);
    expect(backoffMs(3, { jitter: 0 }, () => 0.5)).toBe(120_000);
    expect(backoffMs(30, { jitter: 0 }, () => 0.5)).toBe(30 * 60_000);
    const j = backoffMs(1, { jitter: 0.2 }, () => 1);
    expect(j).toBeLessThanOrEqual(36_000);
  });
  it("retries only retryable failures and only up to the maximum", () => {
    expect(nextRetry("ai.failed", 1, 0, 4, () => 0.5).retry).toBe(true);
    expect(nextRetry("ai.failed", 4, 0, 4).retry).toBe(false);
    expect(nextRetry("team_off", 0, 0).retry).toBe(false);
  });
  it("detects stuck tasks and double runs", () => {
    expect(isStuck(new Date(0).toISOString(), 11 * 60_000)).toBe(true);
    expect(isStuck(new Date(0).toISOString(), 5 * 60_000)).toBe(false);
    expect(isStuck(null, 1e9)).toBe(false);
    expect(tooSoon(1000, 2000, 60_000)).toBe(true);
    expect(tooSoon(1000, 100_000, 60_000)).toBe(false);
  });
  it("gives one verdict for the health screen", () => {
    const base = { enabled: true, emergencyStop: false, stuck: 0, failedLast24h: 0, openCircuits: 0, totalModels: 5, lastTickAt: 1000, now: 2000 };
    expect(teamHealth(base).level).toBe("ok");
    expect(teamHealth({ ...base, openCircuits: 1 }).level).toBe("degraded");
    expect(teamHealth({ ...base, openCircuits: 5 }).level).toBe("down");
    expect(teamHealth({ ...base, emergencyStop: true }).issues).toContain("emergency_stop");
  });
});
