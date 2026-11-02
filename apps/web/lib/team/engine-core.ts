/**
 * The digital team — the work cycle of an employee and the orchestrator (pure orchestration; every side effect
 * goes through injected dependencies, so the exact same code runs in production and in the evaluation suite).
 *
 * Every task goes through the same documented cycle (each phase is written to the activity log):
 *   1 understand   restate the goal, find what is missing, ONE clarifying question when needed
 *   2 context      business profile + relevant memories + playbook + live data
 *   3 plan         steps with tools, estimated cost, risks
 *   4 execute      real platform tools (policy: execute / approval / blocked), retry once, bounded rounds
 *   5 self-check   role checklist: facts, prices, leaks, forbidden wording, language, goal
 *   6 peer review  quality control / the team lead reviews customer-facing output (max 2 rounds, then the owner decides)
 *   7 deliver      by autonomy and sensitivity: executed, or one approval with the employee's reasoning
 *   8 summarize    a short report + episodic memory
 */
import { firstJsonObject } from "@/lib/operator/operator-core";
import { ROLES, type RoleKey, type Autonomy } from "./roles";
import { playbookPrompt } from "./playbooks";
import { TOOL_MAP, toolsPrompt, validateArgs } from "./tools-core";
import { budgetStop, decide, isLoop } from "./policy-core";
import { memoryPrompt, recall, type MemoryItem } from "./memory-core";
import { SAFETY_RULES, asData, escalationSignal, inventedPrices, leaks } from "./safety-core";
import { DIAGNOSTIC_METHOD, GOAL_PLANNING_GUIDE, REPORT_STANDARD, WORKING_DOCTRINE, expertisePrompt, isDiagnosticTask } from "./doctrine";
import type { TaskKind } from "./routing-core";

export interface EngineMember {
  id: string;
  role: RoleKey;
  name: string;
  tone: string | null;
  instructions: string;
  tools: string[];
  autonomy: Autonomy;
  auto_actions: string[];
  status: "active" | "paused";
  limits: { max_steps?: number; max_credits?: number };
}

export interface EngineTask {
  id: string;
  title: string;
  brief: string;
  depth: number;
  steps_used: number;
  credits_used: number;
  review_rounds: number;
  /** the ancestors (closest first) — loop detection */
  chain: { role: string; title: string }[];
  /** the owner's answer to the employee's question (when the task was waiting for input) */
  answer?: string | null;
}

export interface EngineSettings {
  enabled: boolean;
  emergency_stop: boolean;
  max_depth: number;
  max_steps: number;
  daily_credit_cap: number;
  day_credits: number;
}

export interface AiResult {
  ok: boolean;
  text: string;
  credits: number;
  provider?: string;
  model?: string;
  error?: string;
}

export interface ToolRun {
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
  link?: string;
}

export interface TeamContext {
  profile: string;
  /** every price / fact text the business stated (for the invented-price check) */
  known: string;
  memories: MemoryItem[];
  playbookExtra: string;
  /** who reviews customer-facing work (quality control, else the team lead), null when nobody */
  reviewer: EngineMember | null;
  reviewerExtra?: string;
}

export interface EngineDeps {
  lang: "he" | "en" | "ar";
  interactive: boolean;
  ai(kind: TaskKind, system: string, user: string, maxTokens: number): Promise<AiResult>;
  runTool(tool: string, args: Record<string, string | number>): Promise<ToolRun>;
  log(phase: Phase, summary: string, details?: Record<string, unknown>, ok?: boolean): Promise<void>;
  approval(input: { tool: string; payload: Record<string, unknown>; preview: string; reason: string; sensitivity: string }): Promise<string | null>;
  handoff(input: { role: string; title: string; brief: string }): Promise<{ ok: boolean; taskId?: string; error?: string }>;
  message(kind: "request" | "answer" | "clarify" | "handoff" | "report" | "review", toMember: string | null, body: Record<string, unknown>): Promise<void>;
  remember(items: { layer: "episodic" | "semantic"; kind: MemoryItem["kind"]; content: string; subject?: string | null; confidence: number; status: "active" | "proposed" }[]): Promise<void>;
  context(): Promise<TeamContext>;
}

export type Phase = "understand" | "context" | "plan" | "execute" | "self_check" | "peer_review" | "deliver" | "learn" | "initiative" | "approval" | "system";

export interface Outcome {
  status: "done" | "awaiting_approval" | "awaiting_input" | "failed" | "blocked";
  report: string;
  output: string | null;
  question: string | null;
  credits: number;
  steps: number;
  approvals: string[];
  handoffs: string[];
  error: string | null;
  plan: PlanModel | null;
}

export interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

export interface PlanModel {
  understanding: string;
  missing: string[];
  question: string | null;
  assumptions: string[];
  steps: PlanStep[];
  more: boolean;
  deliverable: { type: "none" | "text" | "report" | "message" | "review_reply" | "reminder"; customer_facing: boolean; contact_id?: string; review_id?: string; instructions: string };
  risks: string[];
  estimate: { credits: number; minutes: number };
}

const str = (v: unknown, n = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const arr = (v: unknown, n = 8) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, n) : []);

/** the model's plan → a clean, bounded plan (unknown tools are kept so policy can block + report them) */
export function parsePlanModel(raw: string): PlanModel | null {
  const j = firstJsonObject(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  const d = (j.deliverable && typeof j.deliverable === "object" ? j.deliverable : {}) as Record<string, unknown>;
  const types = ["none", "text", "report", "message", "review_reply", "reminder"] as const;
  const type = (types as readonly string[]).includes(String(d.type)) ? (String(d.type) as PlanModel["deliverable"]["type"]) : "text";
  const steps = (Array.isArray(j.steps) ? j.steps : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .filter((s) => typeof s.tool === "string")
    .slice(0, 8)
    .map((s) => ({ tool: String(s.tool).slice(0, 60), args: (s.args && typeof s.args === "object" ? s.args : {}) as Record<string, unknown>, why: str(s.why, 300) }));
  const est = (j.estimate && typeof j.estimate === "object" ? j.estimate : {}) as Record<string, unknown>;
  const q = str(j.question, 500);
  return {
    understanding: str(j.understanding, 600),
    missing: arr(j.missing),
    question: q && !/^(none|null|no)$/i.test(q) ? q : null,
    assumptions: arr(j.assumptions),
    steps,
    more: j.more === true,
    deliverable: {
      type,
      customer_facing: d.customer_facing === true || type === "message" || type === "review_reply" || type === "reminder",
      contact_id: typeof d.contact_id === "string" ? d.contact_id : undefined,
      review_id: typeof d.review_id === "string" ? d.review_id : undefined,
      instructions: str(d.instructions, 800),
    },
    risks: arr(j.risks, 5),
    estimate: { credits: Math.max(0, Math.min(200, Number(est.credits) || 0)), minutes: Math.max(0, Math.min(600, Number(est.minutes) || 0)) },
  };
}

const LANG = { he: "Hebrew", en: "English", ar: "Arabic" } as const;

/** the employee's system prompt: identity + playbook + safety + business + memory + tools */
export function employeeSystem(m: EngineMember, ctx: TeamContext, lang: "he" | "en" | "ar", task: string): string {
  const mem = recall(ctx.memories, task, m.id, 12);
  return [
    `You are ${m.name}, ${m.role.replace(/_/g, " ")} in this business's team. You work like a senior professional employee of the business — not a chatbot. Write everything the business or its customers will read in ${LANG[lang]}.`,
    m.tone ? `Your personality and tone: ${m.tone.slice(0, 400)}` : "",
    playbookPrompt(m.role, ctx.playbookExtra),
    WORKING_DOCTRINE,
    expertisePrompt(m.role),
    isDiagnosticTask(task) ? DIAGNOSTIC_METHOD : "",
    m.instructions ? `The owner's own instructions for you:\n${m.instructions.slice(0, 6000)}` : "",
    SAFETY_RULES,
    ctx.profile ? `THE BUSINESS (live profile from the platform):\n${ctx.profile}` : "",
    memoryPrompt(mem),
    toolsPrompt(m.tools),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const PLAN_FORMAT = [
  "Work cycle — answer with ONE JSON object only:",
  '{"understanding": "the goal in one measurable sentence", "missing": ["what is missing"], "question": null or "ONE focused question to the owner (only if you cannot do the work without it)",',
  ' "assumptions": ["what you assume (marked as assumptions)"], "steps": [{"tool": "tool.key", "args": {…}, "why": "…"}], "more": true if you need the results of these steps before deciding further steps,',
  ' "deliverable": {"type": "none|text|report|message|review_reply|reminder", "customer_facing": true|false, "contact_id": "uuid when the deliverable is a message/reminder to a customer", "review_id": "uuid for review_reply", "instructions": "what the final output must contain"},',
  ' "risks": ["…"], "estimate": {"credits": n, "minutes": n}}',
  "Use only your tools. Read before you write. Never invent ids — get them from read tools. Prefer the smallest plan that does the job well.",
  "Plan like a senior professional: put ALL the relevant read tools in the first round so you decide on evidence (set more=true), then write; in \"understanding\" state the measurable goal; in \"assumptions\" list every assumption; in \"risks\" list what could make the result wrong; in deliverable.instructions say exactly which sections the output needs.",
].join("\n");

async function retryTool(deps: EngineDeps, tool: string, args: Record<string, string | number>): Promise<ToolRun> {
  const first = await deps.runTool(tool, args).catch((e: Error) => ({ ok: false, summary: "", error: e.message }) as ToolRun);
  if (first.ok || !/timeout|network|fetch|temporar|ECONN|5\d\d|rate/i.test(first.error ?? "")) return first;
  return deps.runTool(tool, args).catch((e: Error) => ({ ok: false, summary: "", error: e.message }) as ToolRun);
}

/** the self-check of an output (pure): returns the problems to fix */
export function selfCheck(output: string, input: { customerFacing: boolean; known: string; lang: "he" | "en" | "ar"; forbidden: string[] }): string[] {
  const issues: string[] = [];
  const t = output.trim();
  if (t.length < 2) issues.push("The output is empty.");
  if (leaks(t)) issues.push("The output contains internal instructions or secret-looking text — remove it.");
  if (input.customerFacing) {
    const bad = inventedPrices(t, input.known);
    if (bad.length) issues.push(`These prices are not in the business data — remove them or ask the owner: ${bad.join(", ")}.`);
    if (input.lang === "he" && !/[֐-׿]/.test(t)) issues.push("Customer-facing text must be in Hebrew.");
    if (input.lang === "ar" && !/[؀-ۿ]/.test(t)) issues.push("Customer-facing text must be in Arabic.");
  }
  for (const f of input.forbidden) {
    const w = f.trim();
    if (w.length >= 3 && w.length <= 60 && t.toLowerCase().includes(w.toLowerCase())) issues.push(`The owner forbade: "${w}" — rephrase without it.`);
  }
  return issues;
}

/** the reviewer's verdict (pure parse) */
export function parseVerdict(raw: string): { verdict: "approve" | "revise"; issues: string[] } {
  const j = firstJsonObject(raw) as Record<string, unknown> | null;
  if (j && (j.verdict === "approve" || j.verdict === "revise")) return { verdict: j.verdict, issues: arr(j.issues, 6) };
  return { verdict: /\brevise\b/i.test(raw) ? "revise" : "approve", issues: [] };
}

function deliverableTool(type: PlanModel["deliverable"]["type"]): string | null {
  return type === "message" ? "inbox.send_message" : type === "review_reply" ? "reviews.draft_reply" : type === "reminder" ? "collections.send_reminder" : null;
}

/**
 * Runs ONE task of ONE employee through the full cycle. Never throws: failures become an Outcome with a reason.
 */
export async function runEmployeeTask(deps: EngineDeps, member: EngineMember, task: EngineTask, settings: EngineSettings): Promise<Outcome> {
  const out: Outcome = { status: "done", report: "", output: null, question: null, credits: 0, steps: task.steps_used, approvals: [], handoffs: [], error: null, plan: null };
  const maxSteps = Math.min(settings.max_steps, member.limits.max_steps ?? settings.max_steps);
  const maxCredits = member.limits.max_credits ?? 25;
  const stop = () => budgetStop({ depth: task.depth, maxDepth: settings.max_depth, steps: out.steps, maxSteps, credits: task.credits_used + out.credits, maxCredits, dayCredits: settings.day_credits + out.credits, dayCap: settings.daily_credit_cap });
  const fail = async (status: Outcome["status"], error: string, summary: string) => {
    out.status = status;
    out.error = error;
    await deps.log("system", summary, { error }, false);
    return out;
  };
  if (settings.emergency_stop) return fail("blocked", "emergency_stop", "Emergency stop is on — the team is frozen.");
  if (!settings.enabled) return fail("blocked", "team_off", "The team is turned off.");
  if (member.status !== "active") return fail("blocked", "member_paused", `${member.name} is paused.`);
  const pre = stop();
  if (pre) return fail("blocked", pre, `Stopped before starting: ${pre}.`);

  // a customer escalation signal goes to a human — never handled by the AI alone
  const signal = escalationSignal(`${task.title}\n${task.brief}`);
  if (signal && (member.role === "customer_service" || member.role === "sales" || member.role === "reputation")) {
    out.status = "awaiting_input";
    out.question = `escalate:${signal}`;
    await deps.log("understand", `Needs a person: ${signal.replace(/_/g, " ")}.`, { signal });
    return out;
  }

  // 2 — context
  const ctx = await deps.context();
  await deps.log("context", `Loaded the business profile, ${ctx.memories.length} memories and the ${member.role.replace(/_/g, " ")} playbook.`, { memories: ctx.memories.length, reviewer: ctx.reviewer?.name ?? null });
  const system = employeeSystem(member, ctx, deps.lang, `${task.title} ${task.brief}`);
  const taskText = [`TASK: ${task.title}`, task.brief ? asData("task brief", task.brief, 4000) : "", task.answer ? `The owner answered your question: ${asData("owner answer", task.answer, 1500)}` : ""].filter(Boolean).join("\n");

  // 1 + 3 — understand and plan (bounded act rounds: read → decide → write)
  const results: { tool: string; ok: boolean; summary: string }[] = [];
  let plan: PlanModel | null = null;
  for (let round = 0; round < 3; round++) {
    const b = stop();
    if (b) {
      await deps.log("system", `Stopped: ${b}.`, { reason: b }, false);
      break;
    }
    const prompt = round === 0 ? `${taskText}\n\n${PLAN_FORMAT}` : `${taskText}\n\nResults so far:\n${results.map((r) => `- ${r.tool}: ${r.ok ? "ok" : "failed"} — ${asData(r.tool, r.summary, 1500)}`).join("\n")}\n\nDecide the NEXT steps (or none) and the deliverable.\n${PLAN_FORMAT}`;
    const res = await deps.ai("plan", system, prompt, 1500);
    out.credits += res.credits;
    if (!res.ok) return fail("failed", res.error ?? "ai_failed", "The AI did not answer (all engines busy) — the task will be retried.");
    const parsed = parsePlanModel(res.text);
    if (!parsed) return fail("failed", "plan_unreadable", "The plan could not be read.");
    plan = parsed;
    out.plan = parsed;
    if (round === 0) {
      await deps.log("understand", parsed.understanding || task.title, { missing: parsed.missing, assumptions: parsed.assumptions });
      if (parsed.question && !task.answer) {
        out.status = "awaiting_input";
        out.question = parsed.question;
        await deps.message("clarify", null, { question: parsed.question });
        await deps.log("understand", `Asked the owner one question: ${parsed.question}`, {});
        return out;
      }
      await deps.log("plan", `${parsed.steps.length} steps · deliverable: ${parsed.deliverable.type}${parsed.deliverable.customer_facing ? " (customer-facing)" : ""} · est. ${parsed.estimate.credits} credits`, { steps: parsed.steps.map((s) => ({ tool: s.tool, why: s.why })), risks: parsed.risks });
    }
    // 4 — execute
    for (const step of parsed.steps) {
      const b2 = stop();
      if (b2) {
        await deps.log("system", `Stopped the remaining steps: ${b2.replace(/_/g, " ")}.`, { reason: b2 }, false);
        break;
      }
      out.steps++;
      if (!TOOL_MAP[step.tool]) {
        results.push({ tool: step.tool, ok: false, summary: "unknown tool" });
        await deps.log("execute", `Blocked: "${step.tool}" is not a platform tool.`, { tool: step.tool }, false);
        continue;
      }
      const v = validateArgs(step.tool, step.args);
      if (!v.ok) {
        results.push({ tool: step.tool, ok: false, summary: v.error });
        await deps.log("execute", `${step.tool}: invalid arguments (${v.error}).`, { tool: step.tool }, false);
        continue;
      }
      const d = decide(step.tool, member, settings, { interactive: deps.interactive });
      if (d.do === "blocked") {
        results.push({ tool: step.tool, ok: false, summary: `blocked: ${d.why}` });
        await deps.log("execute", `Not allowed: ${step.tool} (${d.why.replace(/_/g, " ")}).`, { tool: step.tool, why: d.why }, false);
        continue;
      }
      if (step.tool === "team.ask_user") {
        out.status = "awaiting_input";
        out.question = String(v.args.question ?? "");
        await deps.message("clarify", null, { question: out.question });
        await deps.log("understand", `Asked the owner: ${out.question}`, {});
        return out;
      }
      if (step.tool === "team.handoff") {
        const role = String(v.args.role ?? "");
        const title = String(v.args.title ?? "");
        if (isLoop({ role, title }, [{ role: member.role, title: task.title }, ...task.chain], settings.max_depth)) {
          results.push({ tool: step.tool, ok: false, summary: "loop prevented" });
          await deps.log("execute", `Handoff to ${role} prevented (loop / depth limit).`, { role, title }, false);
          continue;
        }
        const h = await deps.handoff({ role, title, brief: `${String(v.args.brief ?? "")}\n\nContext from ${member.name}: ${task.title}`.slice(0, 5000) });
        results.push({ tool: step.tool, ok: h.ok, summary: h.ok ? `handed to ${role}` : h.error ?? "handoff failed" });
        if (h.ok && h.taskId) out.handoffs.push(h.taskId);
        await deps.log("execute", h.ok ? `Handed "${title}" to ${role}.` : `Handoff failed: ${h.error}`, { role, title }, h.ok);
        continue;
      }
      if (d.do === "approve") {
        const id = await deps.approval({ tool: step.tool, payload: v.args, preview: JSON.stringify(v.args).slice(0, 1500), reason: step.why || d.why, sensitivity: d.sensitivity });
        if (id) out.approvals.push(id);
        results.push({ tool: step.tool, ok: true, summary: "waiting for the owner's approval" });
        await deps.log("approval", `Waiting for approval: ${step.tool} — ${step.why || d.why}`, { tool: step.tool, why: d.why });
        continue;
      }
      const r = await retryTool(deps, step.tool, v.args);
      results.push({ tool: step.tool, ok: r.ok, summary: r.ok ? r.summary : r.error ?? "failed" });
      await deps.log("execute", r.ok ? `${step.tool}: ${r.summary.slice(0, 300)}` : `${step.tool} failed: ${(r.error ?? "").slice(0, 200)}`, { tool: step.tool, link: r.link ?? null }, r.ok);
    }
    if (!parsed.more) break;
  }
  if (!plan) return fail("failed", "no_plan", "No plan.");

  // the deliverable (text / report / message …)
  if (plan.deliverable.type !== "none") {
    const customer = plan.deliverable.customer_facing;
    const forbidden = ctx.memories.filter((m) => m.kind === "forbidden" && m.status === "active").map((m) => m.content);
    const writePrompt = (fixes: string[] = [], draft = "") =>
      [
        taskText,
        results.length ? `What you found / did:\n${results.map((r) => `- ${r.tool}: ${asData(r.tool, r.summary, 1500)}`).join("\n")}` : "",
        `Write the final ${plan!.deliverable.type} now. ${plan!.deliverable.instructions}`,
        customer ? "It goes to a CUSTOMER: short, warm, accurate, only facts from the business profile, one clear next step." : "It goes to the OWNER: concise, factual, mark assumptions.",
        !customer && (plan!.deliverable.type === "report" || isDiagnosticTask(taskText)) ? REPORT_STANDARD : "",
        draft ? `Your previous draft:\n${asData("draft", draft, 3000)}\nFix exactly these points:\n${fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")}` : "",
        "Answer with the final text only (no JSON, no preface).",
      ]
        .filter(Boolean)
        .join("\n\n");
    const outTokens = !customer && (plan.deliverable.type === "report" || isDiagnosticTask(taskText)) ? 2200 : 1200;
    let w = await deps.ai(customer ? "write" : "summarize", system, writePrompt(), outTokens);
    out.credits += w.credits;
    if (!w.ok) return fail("failed", w.error ?? "ai_failed", "Could not write the output (AI busy).");
    let draft = w.text.trim();
    // 5 — self-check (one fix round)
    let issues = selfCheck(draft, { customerFacing: customer, known: ctx.known, lang: deps.lang, forbidden });
    await deps.log("self_check", issues.length ? `Self-check found ${issues.length} issue(s) — fixing.` : "Self-check passed.", { issues }, !issues.length);
    if (issues.length && !stop()) {
      w = await deps.ai("write", system, writePrompt(issues, draft), outTokens);
      out.credits += w.credits;
      if (w.ok) draft = w.text.trim();
      issues = selfCheck(draft, { customerFacing: customer, known: ctx.known, lang: deps.lang, forbidden });
      if (issues.length) await deps.log("self_check", `Still ${issues.length} issue(s) after the fix — the owner will decide.`, { issues }, false);
    }
    // 6 — peer review (customer-facing)
    let reviewDisagreement: string[] = [];
    if (customer && ctx.reviewer && ctx.reviewer.id !== member.id) {
      for (let round = task.review_rounds; round < 2 && !stop(); round++) {
        const rsys = employeeSystem(ctx.reviewer, { ...ctx, playbookExtra: ctx.reviewerExtra ?? "" }, deps.lang, draft);
        const rv = await deps.ai("review", rsys, `Review this customer-facing ${plan.deliverable.type} written by ${member.name} for the task "${task.title}".\n${asData("output to review", draft, 3000)}\nCheck facts against the business profile, brand tone, policy, language, length and the goal.\nAnswer JSON only: {"verdict": "approve"|"revise", "issues": ["numbered, specific fixes"]}`, 600);
        out.credits += rv.credits;
        if (!rv.ok) break;
        const verdict = parseVerdict(rv.text);
        await deps.message("review", member.id, { reviewer: ctx.reviewer.name, verdict: verdict.verdict, issues: verdict.issues });
        await deps.log("peer_review", `${ctx.reviewer.name}: ${verdict.verdict}${verdict.issues.length ? ` — ${verdict.issues.slice(0, 3).join("; ")}` : ""}`, { verdict: verdict.verdict, issues: verdict.issues }, verdict.verdict === "approve");
        if (verdict.verdict === "approve") {
          reviewDisagreement = [];
          break;
        }
        reviewDisagreement = verdict.issues;
        const fix = await deps.ai("write", system, writePrompt(verdict.issues.length ? verdict.issues : ["Improve per the reviewer."], draft), 1200);
        out.credits += fix.credits;
        if (fix.ok) draft = fix.text.trim();
      }
    }
    out.output = draft;
    // 7 — deliver
    const tool = deliverableTool(plan.deliverable.type);
    if (tool) {
      const args: Record<string, unknown> = { text: draft };
      if (plan.deliverable.contact_id) args.contact_id = plan.deliverable.contact_id;
      if (plan.deliverable.review_id) args.review_id = plan.deliverable.review_id;
      const v = validateArgs(tool, args);
      if (!v.ok) {
        await deps.log("deliver", `The output is ready but cannot be sent (${v.error}) — kept for the owner.`, { tool }, false);
        const id = await deps.approval({ tool: "team.ask_user", payload: { question: draft }, preview: draft.slice(0, 1500), reason: `Ready, but ${v.error}`, sensitivity: "internal" });
        if (id) out.approvals.push(id);
      } else {
        const d = decide(tool, member, settings, { interactive: deps.interactive });
        const unresolved = reviewDisagreement.length > 0 || issues.length > 0;
        if (d.do === "blocked") {
          await deps.log("deliver", `Cannot send: ${d.why.replace(/_/g, " ")}.`, { tool }, false);
        } else if (d.do === "approve" || unresolved) {
          const reason = unresolved ? `Quality review did not fully approve: ${[...reviewDisagreement, ...issues].slice(0, 3).join("; ")}` : plan.deliverable.instructions || plan.understanding;
          const id = await deps.approval({ tool, payload: v.args, preview: draft.slice(0, 1500), reason, sensitivity: d.do === "approve" ? d.sensitivity : TOOL_MAP[tool]!.sensitivity });
          if (id) out.approvals.push(id);
          await deps.log("deliver", unresolved ? "Sent to the owner to decide (review disagreement)." : "Waiting for the owner's approval to send.", { tool });
        } else {
          const r = await retryTool(deps, tool, v.args);
          await deps.log("deliver", r.ok ? `Sent: ${r.summary.slice(0, 200)}` : `Sending failed: ${r.error}`, { tool, link: r.link ?? null }, r.ok);
          if (!r.ok) {
            out.status = "failed";
            out.error = r.error ?? "deliver_failed";
          }
        }
      }
    } else {
      await deps.log("deliver", `${plan.deliverable.type === "report" ? "Report" : "Output"} ready.`, {});
    }
  }

  if (out.approvals.length && out.status === "done") out.status = "awaiting_approval";
  // 8 — summarize + learn
  const did = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  out.report = [plan.understanding || task.title, `${did} action(s) done${failed ? `, ${failed} not done` : ""}${out.approvals.length ? `, ${out.approvals.length} waiting for approval` : ""}${out.handoffs.length ? `, ${out.handoffs.length} handed over` : ""}.`, plan.assumptions.length ? `Assumptions: ${plan.assumptions.join("; ")}` : ""].filter(Boolean).join(" ");
  await deps.remember([{ layer: "episodic", kind: "outcome", content: `${task.title}: ${out.report}`.slice(0, 1500), subject: null, confidence: 0.6, status: "active" }]);
  await deps.message("report", null, { report: out.report, status: out.status });
  await deps.log("learn", out.report.slice(0, 900), { status: out.status, credits: out.credits, steps: out.steps });
  return out;
}

/* =========================================================================== the orchestrator (manager) */

export interface GoalTask {
  key: string;
  title: string;
  brief: string;
  role: RoleKey;
  depends_on: string[];
  priority: number;
}

export interface GoalPlan {
  understanding: string;
  tasks: GoalTask[];
  risks: string[];
  estimate: number;
  question: string | null;
}

/** the manager's plan → a valid DAG (unknown roles → closest role, unknown deps dropped, cycles rejected) */
export function parseGoalPlan(raw: string, available: RoleKey[]): GoalPlan | null {
  const j = firstJsonObject(raw) as Record<string, unknown> | null;
  if (!j) return null;
  const tasks = (Array.isArray(j.tasks) ? j.tasks : [])
    .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
    .slice(0, 12)
    .map((t, i) => {
      const role = String(t.role ?? "");
      return {
        key: (str(t.key, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "") || `t${i + 1}`).slice(0, 40),
        title: str(t.title, 300),
        brief: str(t.brief, 2000),
        role: (available.includes(role as RoleKey) ? role : available.includes("custom") ? "custom" : available[0] ?? "custom") as RoleKey,
        depends_on: arr(t.depends_on, 6).map((x) => x.toLowerCase().replace(/[^a-z0-9_-]/g, "")),
        priority: Math.max(1, Math.min(4, Math.round(Number(t.priority) || 2))),
      };
    })
    .filter((t) => t.title);
  // unique keys
  const seen = new Set<string>();
  for (const t of tasks) {
    while (seen.has(t.key)) t.key = `${t.key}x`;
    seen.add(t.key);
  }
  for (const t of tasks) t.depends_on = t.depends_on.filter((d) => seen.has(d) && d !== t.key);
  if (hasCycle(tasks)) return null;
  const q = str(j.question, 500);
  return { understanding: str(j.understanding, 600), tasks, risks: arr(j.risks, 5), estimate: Math.max(0, Math.min(500, Number(j.estimate) || 0)), question: q && !/^(none|null)$/i.test(q) ? q : null };
}

export function hasCycle(tasks: { key: string; depends_on: string[] }[]): boolean {
  const by = new Map(tasks.map((t) => [t.key, t.depends_on]));
  const state = new Map<string, 1 | 2>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const d of by.get(k) ?? []) if (visit(d)) return true;
    state.set(k, 2);
    return false;
  };
  return tasks.some((t) => visit(t.key));
}

/** who does what: the employee with the role, the least loaded first; else the role's lead / manager */
export function assign(tasks: GoalTask[], members: { id: string; role: RoleKey; status: string; load: number }[]): Record<string, string | null> {
  const load = new Map(members.map((m) => [m.id, m.load]));
  const out: Record<string, string | null> = {};
  for (const t of tasks) {
    const pick = (role: RoleKey) =>
      members
        .filter((m) => m.role === role && m.status === "active")
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
    const chosen = pick(t.role) ?? (ROLES[t.role]?.reportsTo ? pick(ROLES[t.role].reportsTo!) : undefined) ?? pick("team_lead") ?? pick("manager");
    out[t.key] = chosen?.id ?? null;
    if (chosen) load.set(chosen.id, (load.get(chosen.id) ?? 0) + 1);
  }
  return out;
}

/** which board tasks can start now: pending, all dependencies done; a failed dependency blocks */
export function readyTasks<T extends { id: string; status: string; depends_on: string[] }>(tasks: T[]): { ready: T[]; blocked: T[] } {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const ready: T[] = [];
  const blocked: T[] = [];
  for (const t of tasks) {
    if (t.status !== "pending") continue;
    const deps = t.depends_on.map((d) => status.get(d));
    if (deps.some((s) => s === "failed" || s === "canceled")) blocked.push(t);
    else if (deps.every((s) => s === undefined || s === "done")) ready.push(t);
  }
  return { ready, blocked };
}

export function goalPrompt(goal: string, roles: { role: RoleKey; name: string; load: number }[]): string {
  return [
    `GOAL from the owner: ${asData("goal", goal, 2000)}`,
    `Your team (role · name · open tasks): ${roles.map((r) => `${r.role} · ${r.name} · ${r.load}`).join(" | ")}`,
    GOAL_PLANNING_GUIDE,
    "Make an execution plan with REAL dependencies (independent tasks run in parallel). 3–8 tasks, each owned by one role from the team. Customer-facing work is reviewed by quality control automatically — do not add review tasks.",
    'Answer JSON only: {"understanding": "the goal, measurable", "question": null or "ONE question if you truly cannot plan without it", "tasks": [{"key": "short_id", "title": "verb + output", "brief": "what exactly, with context", "role": "role_key", "depends_on": ["key"], "priority": 1-4}], "risks": ["…"], "estimate": credits}',
  ].join("\n");
}
