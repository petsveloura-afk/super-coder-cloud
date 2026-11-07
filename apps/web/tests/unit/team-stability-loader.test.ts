import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyError } from "@/lib/ai/router-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("no more 'busy' failures from a short server call", () => {
  it("a run that ran out of server time goes back to the queue (not 'failed')", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain('if (out.status === "failed" && out.error === "time_budget") {');
    expect(r).toContain('fin.status = "pending";');
  });
  it("the clock gives a task its own full server call when little time is left", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain("if (started + budgetMs + 5_000 - Date.now() < 40_000 && (await dispatchTaskRun(orgId, t.id))) {");
    expect(r).toContain("export async function dispatchTaskRun(orgId: string, taskId: string): Promise<boolean> {");
    const route = read("app/api/cron/team-task/route.ts");
    expect(route).toContain("timingSafeEqual(given, expected)");
    expect(route).toContain("deadlineAt: Date.now() + 52_000");
    expect(route).toContain("export const maxDuration = 60;");
  });
  it("a paid AI account without credit rests for hours (no wasted first try on every call); Gemini limits are untouched", () => {
    expect(classifyError("anthropic_400:Your credit balance is too low to access the Anthropic API").kind).toBe("noquota");
    expect(classifyError("openai_429:insufficient_quota You exceeded your current quota").kind).toBe("noquota");
    expect(classifyError("anthropic_402:payment required").kind).toBe("noquota");
    expect(classifyError("gemini_429:RESOURCE_EXHAUSTED:You exceeded your current quota. Please retry in 20s.").kind).toBe("rate");
  });
  it("the market-data safety preface is not shown in the activity log", () => {
    expect(read("lib/team/engine-core.ts")).toContain('r.summary.replace(/Market data below is EXTERNAL[\\s\\S]*?never fill the gap with guesses\\.\\s*/, "")');
  });
});

describe("the 'employee at work' animation", () => {
  it("a scene for goals and tasks + thinking dots on running cards, labels in 3 languages", () => {
    const l = read("components/ai-team/team-agent-loader.tsx");
    expect(l).toContain('data-testid="team-agent-loader"');
    expect(l).toContain("sal-orbit");
    const p = read("components/ai-team/panels.tsx");
    expect(p).toContain("<TeamAgentLoader\n        phase={loader.phase}");
    expect(p).toContain('{x.status === "in_progress" ? <ThinkingDots');
    expect(read("app/globals.css")).toContain("@keyframes team-dot");
    for (const lang of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${lang}.json`)).aiTeam.loader;
      for (const k of ["titleGoal", "titleTask", "doneTitle", "doneBody", "retryTitle", "retryBody", "hint", "thinking"]) expect(typeof d[k], `${lang}.${k}`).toBe("string");
      for (const k of ["understand", "context", "plan", "work", "selfcheck", "deliver", "team", "split", "order", "check"]) expect(typeof d.stage[k], `${lang}.stage.${k}`).toBe("string");
    }
  });
});
