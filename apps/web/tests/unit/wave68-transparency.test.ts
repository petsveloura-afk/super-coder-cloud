import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksTemporaryFailure } from "@/lib/team/failure-wording-core";
import { ownerFailure } from "@/lib/team/failure-reason-core";
import { classifyToolFailure, explainToolFailure, reasonCode } from "@/lib/team/tool-failure-core";
import { summarizeDay, type DayProviderRow, type DayTaskRow } from "@/lib/team/day-health-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
const NOW = Date.parse("2026-11-05T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("wave 68 — wordings that heal by themselves", () => {
  it("recognises the AI-layer wordings that used to fall into the generic bucket", () => {
    for (const e of ["rate_limited", "ai.limit_reached", "RESOURCE_EXHAUSTED", "plan_unreadable", "ai_unreadable", "no_models", "empty_response", "מנועי ה-AI עמוסים", "נסו שוב בעוד רגע", "service unavailable", "Please retry later"]) expect(looksTemporaryFailure(e), e).toBe(true);
  });
  it("does not call real bugs or other problems temporary", () => {
    for (const e of ["", null, undefined, "TypeError: cannot read properties of undefined", "boom", "not_found", "forbidden", "invalid_email"]) expect(looksTemporaryFailure(e as string), String(e)).toBe(false);
  });
  it("classifyToolFailure: those wordings are now a temporary problem, not an unexpected error", () => {
    for (const e of ["rate_limited", "ai.limit_reached", "מנועי ה-AI עמוסים"]) {
      const f = classifyToolFailure(e);
      expect(f.kind, e).toBe("temporary");
      expect(f.retryable).toBe(true);
    }
  });
  it("classifyToolFailure: every earlier answer is unchanged", () => {
    expect(classifyToolFailure("ai_all_failed:x").kind).toBe("temporary");
    expect(classifyToolFailure("not_connected").kind).toBe("missing_connection");
    expect(classifyToolFailure("no_contact").kind).toBe("missing_data");
    expect(classifyToolFailure("invalid_input").kind).toBe("bad_input");
    expect(classifyToolFailure("timeout").kind).toBe("temporary");
    expect(classifyToolFailure("something exploded").kind).toBe("bug");
    expect(classifyToolFailure("").kind).toBe("bug");
    expect(classifyToolFailure("rate limit 429").kind).toBe("temporary");
  });
  it("reasonCode keeps splitting the tool bucket and the generic code still exists for real bugs", () => {
    expect(reasonCode("something exploded")).toBe("tool_bug");
    expect(reasonCode("ai.busy")).toBe("ai_busy");
  });
});

describe("wave 68 — one reason and one action, in the business language", () => {
  it("AI busy → the sentence from the product spec, in he / en / ar", () => {
    const he = ownerFailure("ai.busy", "he");
    expect(he.text).toBe("מנועי ה-AI עמוסים, ינסה שוב בעוד כמה דקות");
    expect(he.retryable).toBe(true);
    expect(he.action).toContain("הפעל מחדש");
    expect(ownerFailure("ai.busy", "en").text).toContain("busy");
    expect(ownerFailure("ai.busy", "ar").text).toContain("مشغولة");
  });
  it("an unreadable AI answer is the same busy-and-retry story", () => {
    expect(ownerFailure("plan_unreadable", "he").text).toContain("עמוסים");
  });
  it("network, budget and policy have their own clear sentence and a non-technical action", () => {
    expect(ownerFailure("fetch failed", "he").text).toContain("רשת");
    const b = ownerFailure("daily_credit_cap", "he");
    expect(b.text).toContain("תקרת");
    expect(b.retryable).toBe(false);
    expect(ownerFailure("member_paused", "he").text).toContain("כללים");
  });
  it("a real bug is never shown as the bare words 'unexpected error'", () => {
    for (const l of ["he", "en", "ar"] as const) {
      const f = ownerFailure("something exploded", l);
      expect(f.text.length).toBeGreaterThan(10);
      expect(f.action).toMatch(/\S/);
      expect(f.text).not.toBe("שגיאה לא צפויה");
      expect(f.text).not.toBe("Unexpected error");
    }
  });
  it("connection and missing data keep the existing explanation", () => {
    const c = ownerFailure("not_connected", "he");
    expect(c.needsConnection).toBe(true);
    expect(c.text).toBe(explainToolFailure("not_connected", "he").label);
    expect(ownerFailure("no_contact", "he").action).toBe(explainToolFailure("no_contact", "he").action);
  });
  it("never shows a technical code and never throws", () => {
    for (const e of ["ai_all_failed:gemini/gemini-2.5-flash:429", "gemini/x:rate", "TypeError at line 3", null, undefined, "", "💥"]) {
      for (const l of ["he", "en", "ar"] as const) {
        const f = ownerFailure(e as string, l);
        expect(f.text).not.toMatch(/ai_all_failed|gemini|TypeError|line 3/);
        expect(f.action).not.toMatch(/ai_all_failed|gemini|TypeError/);
      }
    }
    expect(ownerFailure("x", "xx" as never).text).toMatch(/[א-ת]/);
  });
});

describe("wave 68 — today's health (pure)", () => {
  const reasonOf = (e: string | null) => (e && /busy/.test(e) ? "ai_busy" : e ? "tool_bug" : "unknown");
  const tasks: DayTaskRow[] = [
    { status: "done", error: null, finished_at: ago(1) },
    { status: "done", error: null, finished_at: ago(5) },
    { status: "failed", error: "ai.busy", finished_at: ago(2) },
    { status: "failed", error: "ai.busy", finished_at: ago(3) },
    { status: "failed", error: "weird", finished_at: ago(4) },
    { status: "done", error: null, finished_at: ago(30) },
    { status: "failed", error: "ai.busy", finished_at: ago(25) },
    { status: "blocked", error: "x", finished_at: ago(1) },
    { status: "done", error: null, finished_at: null },
  ];
  it("counts only the last 24 hours and only done / failed", () => {
    const d = summarizeDay(tasks, NOW, reasonOf);
    expect(d.done).toBe(2);
    expect(d.failed).toBe(3);
    expect(d.windowHours).toBe(24);
  });
  it("groups failures by reason, most frequent first", () => {
    expect(summarizeDay(tasks, NOW, reasonOf).reasons).toEqual([{ code: "ai_busy", count: 2 }, { code: "tool_bug", count: 1 }]);
  });
  it("a reason function that throws becomes 'unknown' instead of breaking the card", () => {
    const d = summarizeDay([{ status: "failed", error: "x", finished_at: ago(1) }], NOW, () => { throw new Error("no"); });
    expect(d.reasons).toEqual([{ code: "unknown", count: 1 }]);
  });
  it("ignores future timestamps and unreadable dates", () => {
    const d = summarizeDay([{ status: "done", error: null, finished_at: new Date(NOW + 3_600_000).toISOString() }, { status: "done", error: null, finished_at: "garbage" }], NOW, reasonOf);
    expect(d.done).toBe(0);
  });
  it("lists providers worst first with a rounded percentage, and tolerates junk rows", () => {
    const rows = [
      { provider: "groq", calls: 10, successRate: 0.96, status: "healthy" },
      { provider: "gemini", calls: 4, successRate: 0.25, status: "degraded" },
      { provider: "cerebras", calls: 1, successRate: null, status: "neutral" },
      { provider: "", calls: 3, successRate: 1, status: "healthy" },
    ] as DayProviderRow[];
    const d = summarizeDay([], NOW, reasonOf, rows);
    expect(d.providers.map((p) => p.provider)).toEqual(["groq", "cerebras", "gemini"].sort((a, b) => ["healthy", "neutral", "degraded"].indexOf(rows.find((r) => r.provider === a)!.status) - ["healthy", "neutral", "degraded"].indexOf(rows.find((r) => r.provider === b)!.status)));
    expect(d.providers[0]).toEqual({ provider: "groq", calls: 10, successPct: 96, status: "healthy" });
    expect(d.providers.find((p) => p.provider === "cerebras")!.successPct).toBeNull();
  });
  it("is empty and zero when nothing happened, and does not mutate the input", () => {
    const copy = JSON.stringify(tasks);
    summarizeDay(tasks, NOW, reasonOf);
    expect(JSON.stringify(tasks)).toBe(copy);
    expect(summarizeDay([], NOW, reasonOf)).toEqual({ windowHours: 24, done: 0, failed: 0, reasons: [], providers: [] });
  });
});

describe("wave 68 — wiring and texts", () => {
  it("the new dictionary block exists in he, en and ar with the same keys", () => {
    const keys = (l: string) => Object.keys(dict(l).aiTeam.dayHealth).sort().join(",");
    expect(keys("he")).toBe(keys("en"));
    expect(keys("he")).toBe(keys("ar"));
    for (const l of ["he", "en", "ar"]) {
      const d = dict(l).aiTeam.dayHealth;
      expect(Object.keys(d.status).sort()).toEqual(["degraded", "healthy", "neutral", "shaky"]);
      for (const k of ["title", "window", "done", "failed", "reasons", "providers", "providersNote", "noProviders", "quiet", "calls"]) expect(typeof d[k], `${l}.${k}`).toBe("string");
    }
  });
  it("every reason code the card can show has a text in all three languages", () => {
    for (const l of ["he", "en", "ar"]) {
      const r = dict(l).aiTeam.health.reason;
      for (const c of ["policy", "budget", "ai_unreadable", "ai_busy", "network", "input", "tool", "unknown", "tool_needs_connection", "tool_missing_data", "tool_temporary", "tool_bad_input", "tool_bug"]) expect(typeof r[c], `${l}.${c}`).toBe("string");
    }
  });
  it("the two extended texts keep their old words and add the way forward", () => {
    expect(dict("he").aiTeam.health.reason.ai_busy).toBe("מנועי ה-AI עמוסים (ינסה שוב בעוד כמה דקות)");
    expect(dict("he").aiTeam.health.reason.tool_bug).toContain("שגיאה לא צפויה");
    expect(dict("en").aiTeam.health.reason.tool_bug).toContain("Unexpected error");
    expect(dict("ar").aiTeam.health.reason.tool_bug).toContain("خطأ غير متوقع");
  });
  it("the card is loaded in its own try/catch and shown only when present", () => {
    const p = read("lib/team/page-data.ts");
    expect(p).toMatch(/wave 68[\s\S]{0,300}loadDayHealth[\s\S]{0,200}catch \{/);
    expect(p).toContain("data.health = { level: h.verdict.level");
    expect(read("components/ai-team/panels.tsx")).toContain("{data.dayHealth ? <DayHealthCard day={data.dayHealth} /> : null}");
    expect(read("components/ai-team/panels.tsx")).toContain("{data.health ? <HealthPanel health={data.health} /> : null}");
  });
  it("the loader returns null on any error and reads only done / failed tasks of one business", () => {
    const l = read("lib/team/day-health.ts");
    expect(l).toMatch(/catch \{\s*return null;/);
    expect(l).toContain('.eq("organization_id", orgId)');
    expect(l).toContain('.in("status", ["done", "failed"])');
    expect(l).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
  it("tool-failure-core only gained the extra line before the generic bucket", () => {
    const t = read("lib/team/tool-failure-core.ts");
    expect(t).toMatch(/looksTemporaryFailure\(e\)\) return \{ kind: "temporary"[\s\S]{0,160}return \{ kind: "bug", code: "tool_bug"/);
  });
  it("no migration, no package", () => {
    expect(read("lib/team/day-health-core.ts")).not.toMatch(/^import /m);
    expect(read("lib/team/failure-wording-core.ts")).not.toMatch(/^import /m);
  });
});
