import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEmployeeTask, type EngineDeps, type EngineMember, type EngineTask } from "@/lib/team/engine-core";
import { GRANT_TOOL, grantable, grantPreview, grantReason, withGrantedTool } from "@/lib/team/permission-core";
import { isTinyModel } from "@/lib/ai/router-core";
import { ROLES } from "@/lib/team/roles";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const C = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const plan = (p: Record<string, unknown>) => JSON.stringify({ understanding: "goal", missing: [], question: null, assumptions: [], steps: [], more: false, deliverable: { type: "none", customer_facing: false, instructions: "" }, risks: [], estimate: { credits: 1, minutes: 1 }, ...p });
const settings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 12, daily_credit_cap: 200, day_credits: 0 };

function member(over: Partial<EngineMember> = {}): EngineMember {
  return { id: "m1", role: "marketing", name: "ולדימיר", tone: null, instructions: "", tools: ["tasks.open"], autonomy: "auto", auto_actions: [], status: "active", limits: {}, ...over } as EngineMember;
}

function harness(script: string[], approvalId: string | null = "ap1") {
  const rec = { tools: [] as string[], logs: [] as string[], approvals: [] as { tool: string; payload: unknown; preview: string; sensitivity: string }[] };
  let i = 0;
  const deps: EngineDeps = {
    lang: "he",
    interactive: false,
    ai: async () => {
      const text = script[i++];
      return text === undefined ? { ok: false, text: "", credits: 0, error: "script_exhausted" } : { ok: true, text, credits: 1 };
    },
    runTool: async (tool) => {
      rec.tools.push(tool);
      return { ok: true, summary: `${tool} ok` };
    },
    log: async (_p, s) => void rec.logs.push(s),
    approval: async (a) => {
      rec.approvals.push({ tool: a.tool, payload: a.payload, preview: a.preview, sensitivity: a.sensitivity });
      return approvalId;
    },
    handoff: async () => ({ ok: true, taskId: "t" }),
    message: async () => undefined,
    remember: async () => undefined,
    context: async () => ({ profile: "Name: Dana Hair", known: "", memories: [], playbookExtra: "", reviewer: null }),
  };
  const run = (m: EngineMember, task: Partial<EngineTask> = {}) =>
    runEmployeeTask(deps, m, { id: "task", title: "בחינת נתוני הרשתות החברתיות", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null, ...task }, settings);
  return { rec, run };
}

describe("missing permission → the owner is asked at once (no silent failure)", () => {
  it("helpers: grantable only for real non-team tools, previews in 3 languages, the grant adds once", () => {
    const known = { "crm.add_note": {}, "team.handoff": {} };
    expect(grantable("crm.add_note", known)).toBe(true);
    expect(grantable("nope.tool", known)).toBe(false);
    expect(grantable("team.handoff", known)).toBe(false);
    expect(grantable(GRANT_TOOL, { [GRANT_TOOL]: {} })).toBe(false);
    expect(grantPreview("he", { member: "נועה", tool: "crm.add_note", task: "מעקב" })).toContain("נועה");
    expect(grantPreview("en", { member: "Noa", tool: "crm.add_note", task: "Follow up" })).toContain("Follow up");
    expect(grantPreview("ar", { member: "Noa", tool: "crm.add_note", task: "x" }).length).toBeGreaterThan(10);
    expect(grantReason("he", "why")).toContain("why");
    expect(withGrantedTool(["a"], "b")).toEqual(["a", "b"]);
    expect(withGrantedTool(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("a planned tool the employee does not have opens ONE grant approval and the task waits instead of failing", async () => {
    const steps = [
      { tool: "crm.add_note", args: { contact_id: C(1), body: "a" }, why: "need to note" },
      { tool: "crm.add_note", args: { contact_id: C(2), body: "b" }, why: "again" },
      { tool: "tasks.open", args: {}, why: "x" },
    ];
    const h = harness([plan({ steps })]);
    const out = await h.run(member());
    expect(h.rec.approvals.filter((a) => a.tool === GRANT_TOOL)).toHaveLength(1);
    expect(h.rec.approvals[0]!.payload).toEqual({ tool: "crm.add_note" });
    expect(h.rec.approvals[0]!.sensitivity).toBe("internal");
    expect(h.rec.tools).toContain("tasks.open"); // the allowed work still runs
    expect(h.rec.tools).not.toContain("crm.add_note");
    expect(out.approvals).toContain("ap1");
    expect(out.status).not.toBe("failed");
    expect(h.rec.logs.some((l) => l.includes("Asked the owner for permission to use crm.add_note"))).toBe(true);
  });

  it("when the approval cannot be opened, the old blocked behaviour is kept", async () => {
    const h = harness([plan({ steps: [{ tool: "crm.add_note", args: { contact_id: C(1), body: "a" }, why: "x" }] })], null);
    await h.run(member());
    expect(h.rec.logs.some((l) => l.includes("Not allowed: crm.add_note"))).toBe(true);
  });

  it("an employee who has the tool works exactly as before (no approval)", async () => {
    const h = harness([plan({ steps: [{ tool: "tasks.open", args: {}, why: "x" }] })]);
    await h.run(member({ tools: ROLES.customer_service.tools.concat("tasks.open") }));
    expect(h.rec.approvals.filter((a) => a.tool === GRANT_TOOL)).toHaveLength(0);
  });

  it("wiring: approving grants the tool and re-queues the task; owners get a notification; labels exist", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain("} else if (ap.tool === GRANT_TOOL) {");
    expect(r).toContain("withGrantedTool(");
    expect(r).toContain('result: "permission_granted"');
    expect(r).toContain('title_key: "aiTeam.permissionNeeded"');
    expect(r).toContain('["agency_owner", "owner", "admin"]');
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      expect(typeof d.aiTeam.permissionNeeded, l).toBe("string");
      expect(typeof d.aiTeam.tools.team_grant_tool, l).toBe("string");
    }
  });
});

describe("AI quality gate — a tiny model is only the last resort", () => {
  it("detects tiny models and leaves real ones alone", () => {
    for (const m of ["liquid/lfm-2.5-2.6b:free", "google/gemma-3-1b-it", "meta-llama/llama-3.2-3b-instruct:free"]) expect(isTinyModel(m), m).toBe(true);
    for (const m of ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen-3.8-27b", "gemini-3.8-flash", "llama-3.1-8b-instant", "mistral-small-latest", null, ""]) expect(isTinyModel(m), String(m)).toBe(false);
  });
  it("the router keeps a tiny answer aside while a stronger engine remains, and returns it if nothing better answers", () => {
    const r = read("lib/ai/router.ts");
    expect(r).toContain("let tinyFallback");
    expect(r).toContain("model too small — kept as last resort");
    expect(r).toContain("if (tinyFallback && !attempts.some((a) => a.ok))");
  });
});
