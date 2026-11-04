import { describe, expect, it } from "vitest";
import { circuitOf, cleanHealth, HALF_OPEN_STALE_MS, humanModelErrorKey, recordResult } from "@/lib/team/model-health-core";
import { classifyToolFailure } from "@/lib/team/tool-failure-core";

describe("wave 62 — model health heals itself", () => {
  it("a state written by the old fallback_used bug is healthy again", () => {
    const s = cleanHealth({ "gemini/gemini-2.5-flash": { fails: 1, trips: 2, openUntil: 5000, lastError: "fallback_used", total: 9, failed: 9 } });
    expect(s["gemini/gemini-2.5-flash"]!.lastError).toBeNull();
    expect(circuitOf(s, "gemini/gemini-2.5-flash", 1000)).toBe("closed");
  });
  it("a probe window nobody used for a long time shows as healthy, not \"being tested\" forever", () => {
    const s = recordResult({}, "groq/x-model", false, 0, "404 not found");
    const open = s["groq/x-model"]!.openUntil;
    expect(circuitOf(s, "groq/x-model", open + 1)).toBe("half_open");
    expect(circuitOf(s, "groq/x-model", open + HALF_OPEN_STALE_MS + 1)).toBe("closed");
  });
  it("raw engine codes become readable reasons", () => {
    expect(humanModelErrorKey("fallback_used")).toBe("unknown");
    expect(humanModelErrorKey("gemini_429:RESOURCE_EXHAUSTED per day")).toBe("quota");
    expect(humanModelErrorKey("gemini_429")).toBe("rate");
    expect(humanModelErrorKey("gemini_404 model not found")).toBe("model");
    expect(humanModelErrorKey("openai_401")).toBe("auth");
    expect(humanModelErrorKey("empty answer")).toBe("empty");
  });
});

describe("wave 62 — AI engine problems are temporary, not 'unexpected error'", () => {
  it.each(["ai_all_failed:gemini/x:rate", "ai_all_resting", "ai.failed", "empty_answer", "ai_busy"])("%s → temporary + retryable", (e) => {
    const f = classifyToolFailure(e);
    expect(f.kind).toBe("temporary");
    expect(f.retryable).toBe(true);
  });
  it("no AI key configured → needs a connection", () => {
    expect(classifyToolFailure("ai_not_configured").needsConnection).toBe(true);
  });
});
