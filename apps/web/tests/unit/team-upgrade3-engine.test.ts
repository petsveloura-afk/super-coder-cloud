import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEmployeeTask, type EngineDeps, type EngineMember, type EngineTask, type TeamContext } from "@/lib/team/engine-core";
import type { MemoryItem } from "@/lib/team/memory-core";
import { ROLES } from "@/lib/team/roles";

const C = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const plan = (p: Record<string, unknown>) => JSON.stringify({ understanding: "goal", missing: [], question: null, assumptions: [], steps: [], more: false, deliverable: { type: "none", customer_facing: false, instructions: "" }, risks: [], estimate: { credits: 1, minutes: 1 }, ...p });
const settings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 12, daily_credit_cap: 200, day_credits: 0 };
const ops = { quietNow: false, quietEnabled: false, rateLimits: true, anomalyFreeze: true, recipientCap: 5 };

function member(over: Partial<EngineMember> = {}): EngineMember {
  return { id: "m1", role: "customer_service", name: "Noa", tone: null, instructions: "", tools: ROLES.customer_service.tools, autonomy: "approve", auto_actions: [], status: "active", limits: {}, ...over };
}

function harness(script: string[], extra: Partial<EngineDeps> = {}, ctx: Partial<TeamContext> = {}) {
  const rec = { tools: [] as string[], logs: [] as string[], approvals: [] as { tool: string; sensitivity: string; double?: boolean; reason: string }[], ai: [] as { kind: string; system: string; user: string }[], shared: [] as unknown[], client: [] as { id: string; n: number }[] };
  let i = 0;
  const deps: EngineDeps = {
    lang: "he",
    interactive: false,
    ai: async (kind, system, user) => {
      rec.ai.push({ kind, system, user });
      const text = script[i++];
      return text === undefined ? { ok: false, text: "", credits: 0, error: "script_exhausted" } : { ok: true, text, credits: 1 };
    },
    runTool: async (tool) => {
      rec.tools.push(tool);
      return { ok: true, summary: `${tool} ok` };
    },
    log: async (_p, s) => void rec.logs.push(s),
    approval: async (a) => {
      rec.approvals.push({ tool: a.tool, sensitivity: a.sensitivity, double: a.double, reason: a.reason });
      return `ap${rec.approvals.length}`;
    },
    handoff: async () => ({ ok: true, taskId: "t" }),
    message: async () => undefined,
    remember: async () => undefined,
    context: async () => ({ profile: "Name: Dana Hair", known: "Haircut 120", memories: [], playbookExtra: "", reviewer: null, ...ctx }),
    ...extra,
  };
  const run = (m: EngineMember, task: Partial<EngineTask> = {}) => runEmployeeTask(deps, m, { id: "task", title: "Do the work", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null, ...task }, settings);
  return { rec, run };
}

const autoMember = (tools: string[], auto: string[] = []) => member({ autonomy: "auto", tools, auto_actions: auto });

describe("protections that watch a run (upgrade 3)", () => {
  it("the same write 5 times in a row freezes further WRITE actions (and only with the ops hook)", async () => {
    const steps = Array.from({ length: 8 }, (_, k) => ({ tool: "crm.add_note", args: { contact_id: C(1), body: `note ${k}` }, why: "x" }));
    const m = autoMember(["crm.add_note"]);
    const guarded = harness([plan({ steps })], { ops });
    await guarded.run(m);
    expect(guarded.rec.tools.length).toBe(5);
    expect(guarded.rec.logs.some((l) => l.includes("Unusual behaviour"))).toBe(true);
    const plain = harness([plan({ steps })]);
    await plain.run(m);
    expect(plain.rec.tools.length).toBe(8); // without the hook: exactly the old behaviour
  });
  it("many read-only calls in a row are normal work — never frozen", async () => {
    const steps = Array.from({ length: 8 }, () => ({ tool: "tasks.open", args: {}, why: "x" }));
    const h = harness([plan({ steps })], { ops });
    await h.run(autoMember(["tasks.open"]));
    expect(h.rec.tools.length).toBe(8);
    expect(h.rec.logs.some((l) => l.includes("Unusual behaviour"))).toBe(false);
  });
  it("one task cannot message more customers than the cap", async () => {
    const steps = [1, 2, 3, 4].map((n) => ({ tool: "inbox.send_message", args: { contact_id: C(n), text: "שלום" }, why: "x" }));
    const h = harness([plan({ steps })], { ops: { ...ops, recipientCap: 2 } });
    await h.run(autoMember(["inbox.send_message"], ["inbox.send_message"]));
    expect(h.rec.tools.length).toBe(2);
    expect(h.rec.logs.filter((l) => l.includes("recipient cap")).length).toBe(2);
  });
  it("the rate limit counts the employee's calls from earlier tasks too", async () => {
    const h = harness([plan({ steps: [{ tool: "crm.add_note", args: { contact_id: C(1), body: "x" }, why: "x" }] })], { ops, recentCalls: async () => Array.from({ length: 30 }, () => Date.now() - 1000) });
    await h.run(autoMember(["crm.add_note"]));
    expect(h.rec.tools.length).toBe(0);
    expect(h.rec.logs.some((l) => l.includes("rate limited"))).toBe(true);
  });
  it("money actions are flagged for a double approval, ordinary customer messages are not", async () => {
    const h = harness([plan({ steps: [{ tool: "collections.send_reminder", args: { contact_id: C(1), text: "תזכורת" }, why: "x" }, { tool: "inbox.send_message", args: { contact_id: C(2), text: "שלום" }, why: "x" }] })]);
    await h.run(member({ tools: ["collections.send_reminder", "inbox.send_message"] }));
    const money = h.rec.approvals.find((a) => a.tool === "collections.send_reminder");
    const msg = h.rec.approvals.find((a) => a.tool === "inbox.send_message");
    expect(money?.double).toBe(true);
    expect(msg?.double).toBe(false);
  });
});

describe("quiet hours", () => {
  const script = (n = 1) => [plan({ deliverable: { type: "message", customer_facing: true, contact_id: C(1), instructions: "answer" } }), "היי, תספורת עולה 120 ₪. נקבע תור?"].slice(0, n + 1);
  it("a customer message that could be sent waits for the owner during quiet hours", async () => {
    const h = harness(script(), { ops: { ...ops, quietEnabled: true, quietNow: true } });
    const out = await h.run(autoMember(["inbox.send_message"], ["inbox.send_message"]));
    expect(h.rec.tools).not.toContain("inbox.send_message");
    expect(h.rec.approvals.some((a) => a.tool === "inbox.send_message" && /quiet/i.test(a.reason))).toBe(true);
    expect(out.status).toBe("awaiting_approval");
  });
  it("outside quiet hours (or when switched off) the same message goes out as before", async () => {
    for (const o of [{ ...ops, quietEnabled: true, quietNow: false }, { ...ops, quietEnabled: false, quietNow: true }, undefined]) {
      const h = harness(script(), o ? { ops: o } : {});
      await h.run(autoMember(["inbox.send_message"], ["inbox.send_message"]));
      expect(h.rec.tools).toContain("inbox.send_message");
    }
  });
});

describe("memory and lessons", () => {
  const reviewer = member({ id: "qc", role: "quality_control", name: "QC", tools: [] });
  const draft = "היי דנה, תספורת עולה 120 ₪. נקבע תור?";
  const script = [
    plan({ deliverable: { type: "message", customer_facing: true, contact_id: C(1), instructions: "answer" } }),
    draft,
    JSON.stringify({ verdict: "revise", issues: ["Open with the customer's name and a warmer greeting"] }),
    "היי דנה 🙂 תספורת אצלנו עולה 120 ₪. נקבע לך תור?",
    JSON.stringify({ verdict: "approve", issues: [] }),
  ];
  it("what the reviewer corrected becomes a PROPOSED lesson for the whole team, and the customer's style is remembered", async () => {
    const shared: { status: string; tags?: string[]; content: string }[] = [];
    const client: { id: string; subjects: string[] }[] = [];
    const h = harness(script, { ops, share: async (items) => void shared.push(...(items as typeof shared)), rememberClient: async (id, items) => void client.push({ id, subjects: items.map((x) => x.subject) }) }, { reviewer });
    await h.run(member({ tools: ["inbox.send_message"] }), { brief: "דנה כתבה: כמה עולה תספורת?" });
    expect(shared.length).toBe(1);
    expect(shared[0]!.status).toBe("proposed");
    expect(shared[0]!.tags).toContain("lesson");
    expect(shared[0]!.content).toMatch(/warmer greeting/);
    expect(client.length).toBe(1);
    expect(client[0]!.id).toBe(C(1));
    expect(client[0]!.subjects.every((s) => s.startsWith(`client:${C(1)}`))).toBe(true);
  });
  it("without the hooks nothing is written (old behaviour)", async () => {
    const h = harness(script, {}, { reviewer });
    const out = await h.run(member({ tools: ["inbox.send_message"] }));
    expect(out.status).toBe("awaiting_approval");
  });
  it("a customer's memories never leak into another customer's prompt", async () => {
    const mem = (id: string, subject: string, content: string): MemoryItem => ({ id, member_id: null, layer: "semantic", kind: "preference", subject, content, tags: [], confidence: 0.8, status: "active", expires_at: null, created_at: new Date().toISOString() });
    const memories = [mem("a", `client:${C(1)}:style`, "Customer ONE wants very short replies"), mem("b", `client:${C(2)}:style`, "Customer TWO likes long formal replies")];
    const h = harness([plan({ deliverable: { type: "message", customer_facing: true, contact_id: C(1), instructions: "answer" } }), draft], {}, { memories });
    await h.run(member({ tools: ["inbox.send_message"] }));
    const all = h.rec.ai.map((a) => `${a.system}\n${a.user}`).join("\n");
    expect(all).not.toContain("Customer TWO");
    expect(h.rec.ai.some((a) => a.kind === "write" && a.user.includes("Customer ONE"))).toBe(true);
    expect(h.rec.ai.every((a) => !a.system.includes("Customer ONE"))).toBe(true); // the system prompt carries no customer memories
  });
});

describe("upgrade 3 — files", () => {
  const root = join(__dirname, "../..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  it("the migration is additive and idempotent, and does not touch older migrations", () => {
    const m = read("../../supabase/migrations/20261103000002_team_upgrade_3.sql");
    expect(m).not.toMatch(/drop (table|column)|truncate|delete from/i);
    expect(m).toContain("add column if not exists ops");
    expect(m).toContain("add column if not exists confirmations");
    expect((m.match(/create index if not exists/g) ?? []).length).toBe(2);
  });
  it("the new screen keys exist in he / en / ar with identical structure", () => {
    const leaves = (o: unknown, p = ""): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : leaves(v, `${p}${k}.`)));
    const d = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).aiTeam;
    const base = [...leaves(d("he").ops), ...leaves(d("he").tpl)].sort();
    expect(base.length).toBeGreaterThan(30);
    for (const l of ["en", "ar"]) expect([...leaves(d(l).ops), ...leaves(d(l).tpl)].sort()).toEqual(base);
    for (const l of ["he", "en", "ar"]) expect(typeof d(l).msg.confirmAgain).toBe("string");
  });
  it("every work template has a name in the dictionaries", async () => {
    const { WORK_TEMPLATES } = await import("@/lib/team/ops-core");
    const en = JSON.parse(read("lib/i18n/dictionaries/en.json")).aiTeam.tpl;
    for (const t of WORK_TEMPLATES) expect(typeof en[t.id]).toBe("string");
  });
  it("the original engine, runner and action lines are all still there", () => {
    const e = read("lib/team/engine-core.ts");
    for (const keep of ["export async function runEmployeeTask", "async function retryTool", "prefetch.get(step) ?? retryTool", "const d = decide(step.tool, member, settings"]) expect(e).toContain(keep);
    const r = read("lib/team/runner.ts");
    for (const keep of ["export async function decideApproval", "export async function teamTick", "await maintainTeam(orgId);"]) expect(r).toContain(keep);
    expect(read("app/[locale]/(dashboard)/ai-team/actions.ts")).toContain("export async function decideApprovalAction");
  });
});
