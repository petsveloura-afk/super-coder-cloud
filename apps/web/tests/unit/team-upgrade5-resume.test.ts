import { describe, expect, it } from "vitest";
import { CREDITS_PER_RESUME, MAX_RESUME_PER_TICK, isResumableHold, pickResumable, resumeBudget } from "@/lib/team/resume-core";
import { WORKING_DOCTRINE } from "@/lib/team/doctrine";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("held tasks resume by themselves", () => {
  it("only the daily cap hold is resumable", () => {
    expect(isResumableHold("blocked", "daily_credit_cap")).toBe(true);
    for (const e of ["step_limit", "task_credit_limit", "depth_limit", "emergency_stop", "dependency_failed", "no_assignee", null]) expect(isResumableHold("blocked", e)).toBe(false);
    expect(isResumableHold("failed", "daily_credit_cap")).toBe(false);
  });
  it("resume budget follows the credits left under the cap", () => {
    expect(resumeBudget(200, 217)).toBe(0);
    expect(resumeBudget(200, 190)).toBe(0);
    expect(resumeBudget(200, 200 - CREDITS_PER_RESUME)).toBe(1);
    expect(resumeBudget(200, 0)).toBe(MAX_RESUME_PER_TICK);
    expect(resumeBudget(0, 9999)).toBe(MAX_RESUME_PER_TICK);
  });
  it("oldest first, never more than allowed, ignores other holds", () => {
    const rows = [
      { id: "c", status: "blocked", error: "daily_credit_cap", created_at: "2026-11-02T12:00:00Z" },
      { id: "a", status: "blocked", error: "daily_credit_cap", created_at: "2026-11-02T08:00:00Z" },
      { id: "x", status: "blocked", error: "step_limit", created_at: "2026-11-02T07:00:00Z" },
      { id: "b", status: "blocked", error: "daily_credit_cap", created_at: "2026-11-02T09:00:00Z" },
    ];
    expect(pickResumable(rows, 2).map((r) => r.id)).toEqual(["a", "b"]);
    expect(pickResumable(rows, 0)).toEqual([]);
  });
});

describe("wiring (additive)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
  it("the doctrine keeps rules 1-9 and adds the autonomy rule", () => {
    for (let i = 1; i <= 9; i++) expect(WORKING_DOCTRINE).toContain(`${i}. `);
    expect(WORKING_DOCTRINE).toContain("10. Work autonomously");
  });
  it("the team tick resumes held tasks before listing ready ones", () => {
    const r = read("lib/team/runner.ts");
    expect(r.indexOf("resumeHeldTasks(orgId)")).toBeGreaterThan(-1);
    expect(r.indexOf("await resumeHeldTasks(orgId)")).toBeLessThan(r.indexOf('select("id, status, depends_on, priority")'));
  });
  it("the engine holds (not completes) a task whose steps never ran because of the daily cap", () => {
    const e = read("lib/team/engine-core.ts");
    expect(e).toContain('fail("blocked", "daily_credit_cap"');
  });
});

import { runEmployeeTask, type EngineDeps, type EngineMember } from "@/lib/team/engine-core";
import { ROLES } from "@/lib/team/roles";

const C1 = "11111111-1111-4111-8111-111111111111";
const planJson = JSON.stringify({ understanding: "goal", missing: [], question: null, assumptions: [], steps: [{ tool: "crm.add_note", args: { contact_id: C1, body: "note" }, why: "x" }], more: false, deliverable: { type: "none", customer_facing: false, instructions: "" }, risks: [], estimate: { credits: 1, minutes: 1 } });

function run(dayCredits: number) {
  const ran: string[] = [];
  const deps: EngineDeps = {
    lang: "he",
    interactive: false,
    ai: async () => ({ ok: true, text: planJson, credits: 1 }),
    runTool: async (tool) => {
      ran.push(tool);
      return { ok: true, summary: "ok" };
    },
    log: async () => undefined,
    approval: async () => "ap1",
    handoff: async () => ({ ok: true, taskId: "t" }),
    message: async () => undefined,
    remember: async () => undefined,
    context: async () => ({ profile: "Name: Dana", known: "", memories: [], playbookExtra: "", reviewer: null }),
  };
  const m: EngineMember = { id: "m1", role: "customer_service", name: "Noa", tone: null, instructions: "", tools: ROLES.customer_service.tools, autonomy: "auto", auto_actions: ["crm.add_note"], status: "active", limits: {} };
  return runEmployeeTask(deps, m, { id: "t", title: "Do it", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null }, { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 12, daily_credit_cap: 200, day_credits: dayCredits }).then((out) => ({ out, ran }));
}

describe("engine: the daily cap holds a task instead of completing it empty", () => {
  it("cap reached right after planning → blocked + resumable code, nothing executed", async () => {
    const { out, ran } = await run(199);
    expect(out.status).toBe("blocked");
    expect(out.error).toBe("daily_credit_cap");
    expect(ran).toEqual([]);
  });
  it("cap already full before starting → blocked with the same code", async () => {
    const { out } = await run(217);
    expect(out.status).toBe("blocked");
    expect(out.error).toBe("daily_credit_cap");
  });
  it("credits available → runs exactly as before", async () => {
    const { out, ran } = await run(0);
    expect(out.status).toBe("done");
    expect(ran).toEqual(["crm.add_note"]);
  });
});
