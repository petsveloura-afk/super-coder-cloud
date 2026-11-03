import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/team/roles";
import { runEmployeeTask, type AiResult, type EngineDeps, type EngineMember, type EngineSettings, type EngineTask } from "@/lib/team/engine-core";
import { withDecisionLayer } from "@/lib/team/engine-plus7";
import { TOOL_MAP } from "@/lib/team/tools-core";
import type { DecisionRecord } from "@/lib/team/decision-core";

const C1 = "11111111-1111-4111-8111-111111111111";
const settings: EngineSettings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 12, daily_credit_cap: 200, day_credits: 0 };
const member = (role: keyof typeof ROLES): EngineMember => ({ id: `m-${role}`, role, name: role, tone: null, instructions: "", tools: ROLES[role].tools, autonomy: "auto", auto_actions: ["inbox.send_message"], status: "active", limits: {} });
const sensitivityOf = (t: string) => (TOOL_MAP[t]?.sensitivity ?? null) as "internal" | "customer" | "money" | "irreversible" | null;
const decisionFast = { understood: "asks the hours", decided: "answer from profile", why: "the owner confirmed the hours", confidence: 0.9, would_change_mind: ["hours changed"] };
const decisionDeep = {
  understood: "customer wants a refund", decided: "offer a reschedule and ask the owner", why: "keeps the customer at no cost", confidence: 0.7, chosen: "B", would_change_mind: ["owner policy allows refunds"],
  options: [{ id: "A", title: "refund", summary: "pay back", pros: ["fast"], cons: ["revenue lost"], risk: "high", reversible: false }, { id: "B", title: "reschedule", summary: "new slot", pros: ["keeps customer"], cons: ["still upset"], risk: "low", reversible: true }],
  premortem: { failure_modes: [{ cause: "too angry", likelihood: "medium", mitigation: "a person calls" }, { cause: "no slot", likelihood: "low", mitigation: "offer more weeks" }], tripwires: ["third message"] },
};

function harness(opts: { plan: Record<string, unknown>; auditor?: string; repair?: string; written?: string }) {
  const rec = { ai: [] as { kind: string; user: string }[], tools: [] as string[], approvals: [] as { tool: string; reason: string }[], logs: [] as { phase: string; summary: string }[], persisted: [] as DecisionRecord[] };
  const base: EngineDeps = {
    lang: "he",
    interactive: false,
    ai: async (kind, _s, user): Promise<AiResult> => {
      rec.ai.push({ kind, user });
      if (kind === "plan") return { ok: true, text: user.includes("Your plan so far") && opts.repair ? opts.repair : JSON.stringify(opts.plan), credits: 1 };
      if (kind === "review") return { ok: true, text: opts.auditor ?? JSON.stringify({ verdict: "approve", issues: [] }), credits: 1 };
      return { ok: true, text: opts.written ?? "שלום, אנחנו פתוחים א׳–ה׳ 09:00–19:00", credits: 1 };
    },
    runTool: async (tool) => {
      rec.tools.push(tool);
      return { ok: true, summary: `${tool} ok` };
    },
    log: async (phase, summary) => void rec.logs.push({ phase, summary }),
    approval: async (i) => {
      rec.approvals.push({ tool: i.tool, reason: i.reason });
      return `ap-${rec.approvals.length}`;
    },
    handoff: async () => ({ ok: true, taskId: "t" }),
    message: async () => undefined,
    remember: async () => undefined,
    context: async () => ({ profile: "Name: Dana Hair\nBusiness hours: Sun–Thu 09:00–19:00", known: "Sun–Thu 09:00–19:00 120", memories: [], playbookExtra: "", reviewer: null }),
  };
  return { rec, base };
}
const plan = (p: Record<string, unknown>) => ({ understanding: "goal", missing: [], question: null, assumptions: [], steps: [], more: false, deliverable: { type: "none", customer_facing: false, instructions: "" }, risks: [], estimate: { credits: 1, minutes: 1 }, ...p });
const task = (title: string, brief = ""): EngineTask => ({ id: "task-1", title, brief, depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null });

describe("the decision layer around the real work cycle", () => {
  it("fast path: one extra instruction, NO extra model call, a record is stored", async () => {
    const h = harness({ plan: plan({ deliverable: { type: "text", customer_facing: false, instructions: "answer hours" }, decision: decisionFast }) });
    const layered = withDecisionLayer(h.base, { member: { id: "m-1", name: "x" }, task: { id: "task-1", title: "מתי פתוחים", brief: "" }, sensitivityOf, known: "09:00-19:00", persist: async (r) => void h.rec.persisted.push(r) });
    const out = await runEmployeeTask(layered, member("customer_service"), task("מתי פתוחים"), settings);
    expect(out.status).toBe("done");
    expect(h.rec.ai.filter((a) => a.kind === "plan")).toHaveLength(1);
    expect(h.rec.ai.some((a) => a.kind === "review")).toBe(false);
    expect(h.rec.ai[0]!.user).toContain('"decision"');
    expect(h.rec.persisted).toHaveLength(1);
    expect(h.rec.persisted[0]!.route).toBe("fast");
    expect(layered.layer.audit?.verdict).toBe("approve");
  });

  it("the pre-read of the Hebrew request reaches the model, and a missing detail tells it to ask ONE question", async () => {
    const h = harness({ plan: plan({ decision: decisionFast }) });
    const layered = withDecisionLayer(h.base, { member: { id: "m", name: "x" }, task: { id: "t", title: "אפשר תור", brief: "" }, sensitivityOf });
    await runEmployeeTask(layered, member("customer_service"), task("אפשר תור"), settings);
    expect(h.rec.ai[0]!.user).toContain("PRE-READ OF THE MESSAGE");
    expect(h.rec.ai[0]!.user).toContain("booking");
    expect(h.rec.ai[0]!.user).toMatch(/ask exactly ONE question/);
  });

  it("deep path (refund wording): the model is asked for options + pre-mortem, and an INDEPENDENT audit runs", async () => {
    const h = harness({ plan: plan({ decision: decisionDeep, steps: [{ tool: "crm.find_contacts", args: { query: "Dana" }, why: "find" }] }) });
    const layered = withDecisionLayer(h.base, { member: { id: "m", name: "x" }, task: { id: "t", title: "הלקוח דורש החזר", brief: "" }, sensitivityOf, persist: async (r) => void h.rec.persisted.push(r) });
    const out = await runEmployeeTask(layered, member("customer_service"), task("הלקוח דורש החזר"), settings);
    expect(layered.layer.route).toBe("deep");
    expect(h.rec.ai[0]!.user).toContain("RISKY");
    expect(h.rec.ai.filter((a) => a.kind === "review").length).toBeGreaterThanOrEqual(1);
    expect(h.rec.persisted[0]!.options).toHaveLength(2);
    expect(h.rec.persisted[0]!.premortem?.failure_modes.length).toBeGreaterThanOrEqual(2);
    expect(["done", "awaiting_approval"]).toContain(out.status);
  });

  it("deep path with a plan that lacks options: ONE repair call, then the audit passes", async () => {
    const h = harness({ plan: plan({ decision: decisionFast }), repair: JSON.stringify({ decision: decisionDeep }) });
    const layered = withDecisionLayer(h.base, { member: { id: "m", name: "x" }, task: { id: "t", title: "הלקוח דורש החזר", brief: "" }, sensitivityOf });
    await runEmployeeTask(layered, member("customer_service"), task("הלקוח דורש החזר"), settings);
    expect(h.rec.ai.filter((a) => a.kind === "plan")).toHaveLength(2);
    expect(layered.layer.audit?.verdict).toBe("approve");
  });

  it("an unsupported deep decision gates customer-facing actions into ONE approval each — nothing is sent", async () => {
    const h = harness({
      plan: plan({ steps: [{ tool: "inbox.send_message", args: { contact_id: C1, text: "החזר אושר" }, why: "tell the customer" }], decision: { ...decisionFast, why: "ok", would_change_mind: [] } }),
      auditor: JSON.stringify({ verdict: "escalate", issues: ["the owner must decide about money"] }),
    });
    const layered = withDecisionLayer(h.base, { member: { id: "m", name: "x" }, task: { id: "t", title: "הלקוח דורש החזר של 2000 שקל", brief: "" }, sensitivityOf });
    const out = await runEmployeeTask(layered, member("customer_service"), task("הלקוח דורש החזר של 2000 שקל"), settings);
    expect(layered.layer.gate).toBe(true);
    expect(h.rec.tools).not.toContain("inbox.send_message");
    expect(h.rec.approvals.some((a) => a.tool === "inbox.send_message" && /deep|עמוק/.test(a.reason))).toBe(true);
    expect(layered.layer.heldApprovals.length).toBe(1);
    expect(out.status).not.toBe("failed");
  });

  it("the model can never override the deterministic audit: a friendly auditor + a record without reasons still gates", async () => {
    const h = harness({
      plan: plan({ steps: [{ tool: "inbox.send_message", args: { contact_id: C1, text: "x" }, why: "send" }], decision: { decided: "send", why: "", confidence: 0.99 } }),
      auditor: JSON.stringify({ verdict: "approve", issues: [] }),
    });
    const layered = withDecisionLayer(h.base, { member: { id: "m", name: "x" }, task: { id: "t", title: "הנחה גדולה ללקוח", brief: "" }, sensitivityOf });
    await runEmployeeTask(layered, member("customer_service"), task("הנחה גדולה ללקוח"), settings);
    expect(layered.layer.audit?.verdict).toBe("revise");
    expect(h.rec.tools).not.toContain("inbox.send_message");
  });

  it("fails soft: a model that ignores the decision format changes nothing about the work", async () => {
    const h = harness({ plan: plan({ deliverable: { type: "text", customer_facing: false, instructions: "x" } }) });
    const layered = withDecisionLayer(h.base, { member: { id: "m", name: "x" }, task: { id: "t", title: "סיכום יומי", brief: "" }, sensitivityOf });
    const out = await runEmployeeTask(layered, member("analyst"), task("סיכום יומי"), settings);
    expect(out.status).toBe("done");
    expect(layered.layer.record?.route).toBe("fast");
  });

  it("persist errors are swallowed", async () => {
    const h = harness({ plan: plan({ decision: decisionFast }) });
    const layered = withDecisionLayer(h.base, { member: { id: "m", name: "x" }, task: { id: "t", title: "מתי פתוחים", brief: "" }, sensitivityOf, persist: async () => { throw new Error("db down"); } });
    const out = await runEmployeeTask(layered, member("customer_service"), task("מתי פתוחים"), settings);
    expect(out.status).toBe("done");
  });
});
