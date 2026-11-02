import { describe, expect, it } from "vitest";
import { firstJsonObjectTolerant } from "@/lib/team/json-repair-core";
import { parsePlanModel, parseVerdict } from "@/lib/team/engine-core";

const good = { understanding: "להעלות פוסטים", steps: [{ tool: "crm.search", args: { q: "x" }, why: "w" }], deliverable: { type: "text" } };

describe("plan recovery for weak / fallback models (upgrade 6)", () => {
  it("valid JSON is unchanged", () => {
    expect(parsePlanModel(JSON.stringify(good))?.steps).toHaveLength(1);
  });
  it("reads shapes the strict parser rejects", () => {
    const shapes = [
      `{"understanding": "שורה\nשנייה", "steps": []}`,
      `{"understanding": "חברת דוגמה בע"מ מזמינה", "steps": [],}`,
      "```json\n" + `{"understanding": "ok", "steps": [],}` + "\n```",
      `{"understanding": "ok", "steps": [{"tool": "crm.search", "args": {"q": "x"}, "why": "w"}], "risks": ["a", "b`,
      `{"understanding": "ok", "question": null, "steps": [{"tool": "crm.search", "args": {}}], "estimate": {"credits": 3, "mi`,
    ];
    for (const raw of shapes) expect(parsePlanModel(raw), raw).not.toBeNull();
  });
  it("never invents content and returns null for text without JSON", () => {
    expect(firstJsonObjectTolerant("sorry, I cannot")).toBeNull();
    expect(firstJsonObjectTolerant("")).toBeNull();
    expect(parsePlanModel("no json here")).toBeNull();
  });
  it("reviewer verdict survives a cut-off answer", () => {
    expect(parseVerdict(`{"verdict": "revise", "issues": ["a", "b`).verdict).toBe("revise");
  });
});

describe("one repair attempt before a plan counts as unreadable (upgrade 6b)", () => {
  it("the engine asks once more and then uses the readable answer", async () => {
    const { runEmployeeTask } = await import("@/lib/team/engine-core");
    let calls = 0;
    const logs: string[] = [];
    const deps = {
      lang: "he", interactive: false,
      ai: async () => { calls++; return calls === 1 ? { ok: true, text: "sorry, here is the plan: (no json)", credits: 1 } : { ok: true, text: JSON.stringify({ understanding: "מטרה", steps: [], deliverable: { type: "none" } }), credits: 1 }; },
      log: async (_p: string, s: string) => { logs.push(s); },
      context: async () => ({ profile: "", known: [], memories: [], playbookExtra: "", reviewer: null, reviewerExtra: "" }),
      message: async () => undefined, remember: async () => undefined, approval: async () => null, handoff: async () => ({ ok: false }), runTool: async () => ({ ok: false, summary: "", error: "x" }),
    } as never;
    const member = { id: "m", role: "marketing", name: "שירה", tone: null, instructions: "", tools: [], autonomy: "ask", auto_actions: [], status: "active", limits: {} } as never;
    const task = { id: "t", title: "משימה", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null } as never;
    const settings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 8, daily_credit_cap: 0, day_credits: 0 } as never;
    const out = await runEmployeeTask(deps, member, task, settings);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(out.error).not.toBe("plan_unreadable");
    expect(logs.some((l) => /second attempt worked/.test(l))).toBe(true);
  });
});
