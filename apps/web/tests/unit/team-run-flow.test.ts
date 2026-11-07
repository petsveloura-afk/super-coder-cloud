import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flowStep, FLOW_MAX_RETRIES, FLOW_POLL_MS, FLOW_MAX_MS } from "@/lib/team/run-flow-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("running a task from the screen: start → follow → retry by itself → real result", () => {
  it("decides from the live status", () => {
    expect(flowStep({ status: "pending", error: null, retries: 0 })).toEqual({ kind: "wait" });
    expect(flowStep({ status: "in_progress", error: null, retries: 0 })).toEqual({ kind: "wait" });
    for (const s of ["done", "awaiting_approval", "awaiting_input"]) expect(flowStep({ status: s, error: null, retries: 0 })).toEqual({ kind: "done" });
    expect(flowStep({ status: "failed", error: "ai.busy", retries: 0 })).toEqual({ kind: "retry" });
    expect(flowStep({ status: "failed", error: "time_budget", retries: 1 })).toEqual({ kind: "retry" });
    expect(flowStep({ status: "failed", error: "ai.busy", retries: FLOW_MAX_RETRIES })).toEqual({ kind: "stop" });
    expect(flowStep({ status: "failed", error: "tool_not_allowed", retries: 0 })).toEqual({ kind: "stop" });
    expect(flowStep({ status: "blocked", error: "daily_credit_cap", retries: 0 })).toEqual({ kind: "stop" });
    expect(FLOW_POLL_MS).toBeLessThan(5000);
    expect(FLOW_MAX_MS).toBeGreaterThanOrEqual(120_000);
  });

  it("the button only STARTS the work (own server call) — never runs it inside the click's 60s request when it can avoid it", () => {
    const a = read("app/[locale]/(dashboard)/ai-team/run-actions.ts");
    expect(a).toContain("if (await dispatchTaskRun(orgId, input.taskId)) return { ok: true, data: { status: \"in_progress\", started: true } };");
    expect(a).toContain("deadlineAt: Date.now() + 45_000");
    expect(a).toContain("export async function taskProgressAction(");
    expect(a).toContain('if (!ctx.can("ai.use")) return { error: "errors.forbidden" };');
    const p = read("components/ai-team/panels.tsx");
    expect(p).toContain("const runTaskFlow = async (taskId: string) => {");
    expect(p).toContain("onRun={(id) => void runTaskFlow(id)}");
    expect(p).toContain("onRetry={(id) => void runTaskFlow(id)}");
    expect(read("components/ai-team/team-agent-loader.tsx")).toContain('data-testid="team-agent-loader-retry"');
  });

  it("one more AI try inside the same run; goal summary + weekly meeting stay inside the time limit; tabs fade in", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain('if (!res.ok && (res.error === "ai.busy" || res.error === "ai.failed") && (deadlineAt === undefined || deadlineAt - Date.now() > 24_000)) {');
    expect(r).toContain("if (claimed.goal_id) await refreshGoal(orgId, claimed.goal_id as string, deadlineAt);");
    expect(r).toContain("await weeklyMeeting(orgId, tz, started + budgetMs + 5_000)");
    expect(read("components/ai-team/team-screen.tsx")).toContain('<div key={tab} className="route-fade space-y-4" data-testid="team-tab-content">');
    for (const l of ["he", "en", "ar"]) {
      const run = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).aiTeam.run;
      for (const k of ["awaitingApproval", "awaitingInput", "retrying", "background", "waitingDependency", "budget"]) expect(typeof run[k], `${l}.${k}`).toBe("string");
    }
  });
});

describe("an unreadable plan no longer throws the work away", () => {
  it("the employee works directly on the task and writes the result", async () => {
    const { runEmployeeTask } = await import("@/lib/team/engine-core");
    const { localizeLog } = await import("@/lib/team/title-i18n-core");
    const logs: string[] = [];
    const deps = {
      lang: "he", interactive: false,
      ai: async () => ({ ok: true, text: "פוסט 1: דף נחיתה מהיר שממיר מבקרים ללקוחות — שלחו הודעה עוד היום.\n\nפוסט 2: טיפ: כפתור אחד ברור לפעולה מעלה המרות בצורה משמעותית.", credits: 1 }),
      log: async (_p: string, s: string) => void logs.push(s),
      context: async () => ({ profile: "", known: "", memories: [], playbookExtra: "", reviewer: null }),
      message: async () => undefined, remember: async () => undefined, approval: async () => null, handoff: async () => ({ ok: false }),
      runTool: async () => ({ ok: true, summary: "ok" }),
    } as never;
    const member = { id: "m", role: "marketing", name: "דור", tone: null, instructions: "", tools: ["social.save_draft"], autonomy: "approve", auto_actions: [], status: "active", limits: {} } as never;
    const task = { id: "t", title: "כתוב 2 פוסטים על דפי נחיתה", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null } as never;
    const settings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 8, daily_credit_cap: 0, day_credits: 0 } as never;
    const out = await runEmployeeTask(deps, member, task, settings);
    expect(out.status).not.toBe("failed");
    expect(out.drafts).toBe(2);
    expect(logs).toContain("The plan format was not readable — working directly on the task instead.");
    expect(localizeLog("The plan format was not readable — working directly on the task instead.", "he")).toContain("עובד/ת ישירות");
    expect(localizeLog("Saved 2 post draft(s) on the posts board — waiting for the owner's approval there.", "he")).toContain("נשמרו 2 טיוטות");
  });
  it("smart-team calls stay inside their time", () => {
    expect(read("lib/agents/run.ts")).toContain("hardDeadlineAt: Date.now() + 22_000,");
  });
});
