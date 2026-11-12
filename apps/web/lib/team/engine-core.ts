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
import { GRANT_TOOL, grantPreview, grantReason, grantable } from "./permission-core";
import { cleanPostBody } from "@/lib/social/post-hygiene-core";
import { DELIVERY_RULES, FINISH_RESERVE, completionVerdict, continuationBrief, continuationTitle, extractPosts, wantsOutput, wantsPosts } from "./execution-plus-core";
import { firstJsonObject as firstJsonObjectStrict } from "@/lib/operator/operator-core";
import { firstJsonObjectTolerant } from "./json-repair-core";
import { ROLES, type RoleKey, type Autonomy } from "./roles";
import { playbookPrompt } from "./playbooks";
import { TOOL_MAP, toolsPrompt, validateArgs } from "./tools-core";
import { SAME_FAILURE_LIMIT, failureKey, knownContactIds, repairArgs } from "./arg-repair-core";
import { budgetStop, decide, isLoop } from "./policy-core";
import { memoryPrompt, recall, type MemoryItem } from "./memory-core";
import { SAFETY_RULES, asData, escalationSignal, inventedPrices, leaks } from "./safety-core";
import { DIAGNOSTIC_METHOD, GOAL_PLANNING_GUIDE, REPORT_STANDARD, WORKING_DOCTRINE, expertisePrompt, isDiagnosticTask } from "./doctrine";
import type { TaskKind } from "./routing-core";
import { checkRate, detectAnomalies, injectionNotice, injectionVerdict, needsDoubleApproval, rateLimitFor, recipientCapExceeded, redactSensitive, shouldFreeze, type ActionEvent } from "./safety-plus-core";
import { interactionGuidance, interactionPrompt, ownerPrompt, ownerStyle } from "./interaction-core";
import { clientMemories, clientMemoryPrompt, isClientSubject, learnFromInteraction, lessonToMemory } from "./memory-plus-core";
import { handoffPackage } from "./ops-core";
import { ownerQuestionCheck } from "./ask-gate-core";
import { masteryPrompt } from "./mastery-core";

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
  /** (optional) the business's time zone — dates the employee writes ("tomorrow 9:00") are read in it */
  tz?: string;
  interactive: boolean;
  ai(kind: TaskKind, system: string, user: string, maxTokens: number): Promise<AiResult>;
  runTool(tool: string, args: Record<string, string | number>): Promise<ToolRun>;
  log(phase: Phase, summary: string, details?: Record<string, unknown>, ok?: boolean): Promise<void>;
  approval(input: { tool: string; payload: Record<string, unknown>; preview: string; reason: string; sensitivity: string; /** upgrade 3: needs two explicit confirmations */ double?: boolean }): Promise<string | null>;
  handoff(input: { role: string; title: string; brief: string }): Promise<{ ok: boolean; taskId?: string; error?: string }>;
  /** upgrade 9: the SAME employee continues this task in a new run (a limit stopped the work before the end) */
  continueLater?(input: { title: string; brief: string }): Promise<{ ok: boolean; taskId?: string }>;
  message(kind: "request" | "answer" | "clarify" | "handoff" | "report" | "review", toMember: string | null, body: Record<string, unknown>): Promise<void>;
  remember(items: { layer: "episodic" | "semantic"; kind: MemoryItem["kind"]; content: string; subject?: string | null; confidence: number; status: "active" | "proposed" }[]): Promise<void>;
  context(): Promise<TeamContext>;
  /** upgrade 3 (all optional — without them the engine behaves exactly as before) */
  /** a lesson for the WHOLE team (shared memory, proposed until the owner confirms) */
  share?(items: { layer: "episodic" | "semantic"; kind: MemoryItem["kind"]; content: string; subject?: string | null; confidence: number; status: "active" | "proposed"; tags?: string[] }[]): Promise<void>;
  /** per-customer memory (keyed by contact; never mixed between customers) */
  rememberClient?(contactId: string, items: { layer: "episodic" | "semantic"; kind: MemoryItem["kind"]; content: string; subject: string; confidence: number; status: "active" | "proposed" }[]): Promise<void>;
  /** epoch ms of this employee's earlier calls of a tool (for the rate limit across tasks) */
  recentCalls?(tool: string, sinceMs: number): Promise<number[]>;
  /** the business's operating rules */
  ops?: { quietNow: boolean; quietEnabled: boolean; rateLimits: boolean; anomalyFreeze: boolean; recipientCap: number };
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
  /** upgrade 9: asked to produce something but produced nothing (or a limit stopped it) — honest "partially done" */
  partial?: boolean;
  partialReason?: string | null;
  /** upgrade 9: post drafts saved on the posts board by this run */
  drafts?: number;
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
  deliverable: { type: "none" | "text" | "report" | "message" | "review_reply" | "reminder" | "post"; customer_facing: boolean; contact_id?: string; review_id?: string; instructions: string };
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
  const types = ["none", "text", "report", "message", "review_reply", "reminder", "post"] as const;
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

// upgrade 6: strict parse first (unchanged behaviour); only when it fails, a tolerant recovery (weak / fallback models)
const firstJsonObject = (raw: string): unknown => firstJsonObjectStrict(raw) ?? firstJsonObjectTolerant(raw);

/** upgrade 6: summary wording per business language (English text is exactly what it was before) */
const REPORT_TEXT: Record<"he" | "en" | "ar", { done: (n: number) => string; notDone: (n: number) => string; waiting: (n: number) => string; handed: (n: number) => string; assumptions: string }> = {
  en: { done: (n) => `${n} action(s) done`, notDone: (n) => `${n} not done`, waiting: (n) => `${n} waiting for approval`, handed: (n) => `${n} handed over`, assumptions: "Assumptions" },
  he: { done: (n) => `בוצעו ${n} פעולות`, notDone: (n) => `${n} לא בוצעו`, waiting: (n) => `${n} ממתינות לאישורך`, handed: (n) => `${n} הועברו לעובד אחר`, assumptions: "הנחות" },
  ar: { done: (n) => `تم تنفيذ ${n} إجراءات`, notDone: (n) => `${n} لم تُنفَّذ`, waiting: (n) => `${n} بانتظار موافقتك`, handed: (n) => `${n} حُوّلت لموظف آخر`, assumptions: "افتراضات" },
};

const LANG = { he: "Hebrew", en: "English", ar: "Arabic" } as const;

/** upgrade 9: report lines (business language) */
const DRAFTS_TEXT: Record<"he" | "en" | "ar", (n: number) => string> = {
  he: (n) => `📝 ${n} טיוטות פוסטים נשמרו בלוח הפרסומים ומחכות לאישורך.`,
  en: (n) => `📝 ${n} post draft(s) saved on the posts board, waiting for your approval.`,
  ar: (n) => `📝 تم حفظ ${n} مسودات منشورات في لوحة المنشورات بانتظار موافقتك.`,
};
const PARTIAL_TEXT: Record<"he" | "en" | "ar", string> = {
  he: "⚠️ הושלם חלקית: התוצר המבוקש לא נוצר במלואו — אפשר ללחוץ \"נסה שוב עכשיו\" או לחדד את ההוראה.",
  en: "⚠️ Partially done: the requested result was not fully produced — press \"Try again now\" or sharpen the instruction.",
  ar: "⚠️ اكتمل جزئيًا: لم تُنتَج النتيجة المطلوبة بالكامل — اضغط \"أعد المحاولة الآن\" أو وضّح التعليمات.",
};

/** the employee's system prompt: identity + playbook + safety + business + memory + tools */
/** agent coordination (additive): the employee works next to the smart team, the conversation agent and the operator — never against them */
export const COORDINATION_RULES = [
  "WORKING WITH THE OTHER AGENTS: this business also runs a conversation agent (answers customers live), a smart team (collections, re-engagement, review requests, abandoned carts, a sales manager) and an operator.",
  "- Before you message a customer or open a follow-up, read the customer's brief: when it says \"handled now by other agents\", do NOT repeat that work — report it and move on.",
  "- A customer in a live conversation is answered by the conversation agent; you never answer in parallel to it.",
  "- When a tool answers \"not sent — … already handles this customer\", that is SUCCESS of the coordination, not a failure: do not retry.",
  "- The owner's confirmed business facts are shared by every agent; never state anything that contradicts them.",
].join("\n");

export function employeeSystem(m: EngineMember, ctx: TeamContext, lang: "he" | "en" | "ar", task: string): string {
  const mem = recall(ctx.memories.filter((x) => !isClientSubject(x.subject)), task, m.id, 12);
  return [
    `You are ${m.name}, ${m.role.replace(/_/g, " ")} in this business's team. You work like a senior professional employee of the business — not a chatbot. Write everything the business or its customers will read in ${LANG[lang]}, using ONLY that language's script — never mix in words from another language or script (keep brand names, tool keys and JSON keys as they are).`,
    m.tone ? `Your personality and tone: ${m.tone.slice(0, 400)}` : "",
    playbookPrompt(m.role, ctx.playbookExtra),
    WORKING_DOCTRINE,
    expertisePrompt(m.role),
    // round 11: owner mindset, self-sufficiency and the profession's master playbook
    masteryPrompt(m.role),
    isDiagnosticTask(task) ? DIAGNOSTIC_METHOD : "",
    m.instructions ? `The owner's own instructions for you:\n${m.instructions.slice(0, 6000)}` : "",
    SAFETY_RULES,
    COORDINATION_RULES,
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
  ' "deliverable": {"type": "none|text|report|message|review_reply|reminder|post", "customer_facing": true|false, "contact_id": "uuid when the deliverable is a message/reminder to a customer", "review_id": "uuid for review_reply", "instructions": "what the final output must contain"},',
  ' "risks": ["…"], "estimate": {"credits": n, "minutes": n}}',
  "Use only your tools. Read before you write. Never invent ids — get them from read tools. Prefer the smallest plan that does the job well.",
  "Ids and dates: a write step that needs an id you have not read yet (contact_id, deal_id …) belongs in the NEXT round — read first, set more=true, then write with the real ids from the results. Dates as ISO 8601 (2026-11-10T09:00:00+02:00).",
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
  // upgrade 9: writing + checking the final output has its own small reserve, so the per-task limit never cuts the last step
  const stopFinal = () => budgetStop({ depth: task.depth, maxDepth: settings.max_depth, steps: 0, maxSteps, credits: task.credits_used + out.credits, maxCredits: maxCredits + FINISH_RESERVE, dayCredits: settings.day_credits + out.credits, dayCap: settings.daily_credit_cap });
  /** upgrade 9: the limit that stopped planned work in this run (for the continuation + the honest verdict) */
  let limitStop: string | null = null;
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
    await deps.message("handoff", null, { package: handoffPackage({ reason: signal, taskTitle: task.title, lastMessages: [task.brief], recommended: "Handle this one personally." }) }).catch(() => undefined);
    return out;
  }
  // upgrade 2 (additive): a clearly upset customer, or a repeat complaint, also goes to a person
  const customerRole = member.role === "customer_service" || member.role === "sales" || member.role === "reputation";
  if (!signal && customerRole) {
    const ig = interactionGuidance({ message: `${task.title}\n${task.brief}`.slice(0, 2000) });
    if (ig.escalate) {
      out.status = "awaiting_input";
      out.question = `escalate:${ig.escalate}`;
      await deps.log("understand", `Needs a person: ${ig.escalate.replace(/_/g, " ")}.`, { signal: ig.escalate, emotion: ig.read.emotion });
      await deps.message("handoff", null, { package: handoffPackage({ reason: ig.escalate, taskTitle: task.title, understanding: `${ig.read.emotion}, urgency ${Math.round(ig.read.urgency * 100)}%`, lastMessages: [task.brief], recommended: "Call or write to the customer personally, acknowledge the problem first." }) }).catch(() => undefined);
      return out;
    }
  }

  // 2 — context
  const ctx = await deps.context();
  await deps.log("context", `Loaded the business profile, ${ctx.memories.length} memories and the ${member.role.replace(/_/g, " ")} playbook.`, { memories: ctx.memories.length, reviewer: ctx.reviewer?.name ?? null });
  const system = employeeSystem(member, ctx, deps.lang, `${task.title} ${task.brief}`);
  // upgrade 2 (additive): sensitive numbers are masked before the prompt, the customer's emotion / style / objection guide the tone, an attack-like text is flagged as data
  const taskText = [
    `TASK: ${task.title}`,
    task.brief ? asData("task brief", redactSensitive(task.brief).text, 4000) : "",
    task.answer ? `The owner answered your question: ${asData("owner answer", redactSensitive(task.answer).text, 1500)}` : "",
    customerRole && task.brief ? interactionPrompt({ message: task.brief.slice(0, 1500) }) : "",
    task.brief ? injectionNotice(injectionVerdict(task.brief)) : "",
  ]
    .filter(Boolean)
    .join("\n");

  // upgrade 3 (additive): protections that watch this run — rate limits, a recipient cap, unusual behaviour freezes WRITE actions only
  const ran: ActionEvent[] = [];
  const recipients = new Set<string>();
  let frozen: string | null = null;
  // upgrade 5: the daily credit cap stopped the planned steps before any ran — the task is HELD (and resumed by itself), not "done"
  let capHold = false;

  // 1 + 3 — understand and plan (bounded act rounds: read → decide → write)
  const results: { tool: string; ok: boolean; summary: string }[] = [];
  let plan: PlanModel | null = null;
  /** permission requests already opened in this run (one per tool) */
  const askedGrant = new Set<string>();
  // round 11: data questions are sent back to the employee once per tool (they read it instead of waiting for the owner)
  const askRedirected = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const b = stop();
    if (b) {
      await deps.log("system", `Stopped: ${b}.`, { reason: b }, false);
      limitStop = b;
      break;
    }
    const prompt = round === 0 ? `${taskText}\n\n${PLAN_FORMAT}\n${DELIVERY_RULES}` : `${taskText}\n\nResults so far:\n${results.map((r) => `- ${r.tool}: ${r.ok ? "ok" : "failed"} — ${asData(r.tool, r.summary, 1500)}`).join("\n")}\n\nDecide the NEXT steps (or none) and the deliverable.\n${PLAN_FORMAT}`;
    const res = await deps.ai("plan", system, prompt, 1500);
    out.credits += res.credits;
    if (!res.ok) return fail("failed", res.error ?? "ai_failed", "The AI did not answer (all engines busy) — the task will be retried.");
    let parsedRaw = parsePlanModel(res.text);
    if (!parsedRaw && !stop()) {
      // upgrade 6b: ONE repair attempt — the model is told its answer was unreadable and asked for the JSON only
      const fix = await deps.ai("plan", system, `${prompt}\n\nYour previous answer could not be read as JSON. Answer again with ONE valid JSON object only — no text before or after it, no code fences, double quotes only, escape quotes and line breaks inside strings.`, 1500);
      out.credits += fix.credits;
      if (fix.ok) parsedRaw = parsePlanModel(fix.text);
      await deps.log("system", parsedRaw ? "The first answer was unreadable — the second attempt worked." : "The first answer was unreadable and the second attempt failed too.", {}, !!parsedRaw);
    }
    if (!parsedRaw) {
      // stability (additive): the AI answered, only not in the plan format — the work is NOT thrown away any more.
      // Later rounds: continue with what is already done. First round: work directly on the task (write the result).
      if (round > 0 && plan) {
        await deps.log("system", "The next steps could not be read — continuing with what is already done.", {}, false);
        break;
      }
      parsedRaw = { understanding: task.title, missing: [], question: null, assumptions: [], steps: [], more: false, deliverable: { type: wantsPosts(`${task.title} ${task.brief}`) ? "post" : "text", customer_facing: false, instructions: task.brief || task.title }, risks: [], estimate: { credits: 2, minutes: 1 } } as PlanModel;
      await deps.log("system", "The plan format was not readable — working directly on the task instead.", {}, true);
    }
    const parsed = parsedRaw;
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
      // upgrade 9: the task asks to PRODUCE something (posts, a text …) but the plan produces nothing → the output is written anyway
      if (parsed.deliverable.type === "none" && wantsOutput(`${task.title} ${task.brief}`)) {
        parsed.deliverable = { ...parsed.deliverable, type: wantsPosts(`${task.title} ${task.brief}`) ? "post" : "text", instructions: parsed.deliverable.instructions || parsed.understanding || task.title };
        await deps.log("plan", "The task asks for a result — the final output will be written.", {});
      }
      await deps.log("plan", `${parsed.steps.length} steps · deliverable: ${parsed.deliverable.type}${parsed.deliverable.customer_facing ? " (customer-facing)" : ""} · est. ${parsed.estimate.credits} credits`, { steps: parsed.steps.map((s) => ({ tool: s.tool, why: s.why })), risks: parsed.risks });
    }
    // 4 — execute
    // upgrade 2 (additive): independent read-only tools start together (same checks as below); results are consumed in plan order
    const prefetch = new Map<PlanStep, Promise<ToolRun>>();
    // identical failures per tool in this round (see arg-repair-core.SAME_FAILURE_LIMIT)
    const sameFail = new Map<string, number>();
    {
      const reads = parsed.steps
        .filter((st) => {
          const spec = TOOL_MAP[st.tool];
          if (!spec || spec.kind !== "read") return false;
          return validateArgs(st.tool, st.args).ok && decide(st.tool, member, settings, { interactive: deps.interactive }).do === "execute";
        })
        .slice(0, Math.max(0, maxSteps - out.steps));
      if (reads.length > 1) {
        for (const st of reads) {
          const vv = validateArgs(st.tool, st.args);
          if (vv.ok) prefetch.set(st, retryTool(deps, st.tool, vv.args));
        }
      }
    }
    for (const step of parsed.steps) {
      const b2 = stop();
      if (b2) {
        await deps.log("system", `Stopped the remaining steps: ${b2.replace(/_/g, " ")}.`, { reason: b2 }, false);
        limitStop = b2;
        if (b2 === "daily_credit_cap") capHold = true;
        break;
      }
      out.steps++;
      if (!TOOL_MAP[step.tool]) {
        results.push({ tool: step.tool, ok: false, summary: "unknown tool" });
        await deps.log("execute", `Blocked: "${step.tool}" is not a platform tool.`, { tool: step.tool }, false);
        continue;
      }
      // argument repair (additive): dates in any common form, ids written inside text, and "the lead from step 1" resolved from
      // what this employee already read — several contacts → the step runs for each of them (see arg-repair-core)
      {
        const rep = repairArgs(TOOL_MAP[step.tool]!.args, step.args, { known: knownContactIds(results.map((r) => r.summary)), tz: deps.tz ?? "Asia/Jerusalem" });
        if (rep.blocked) {
          results.push({ tool: step.tool, ok: false, summary: rep.blocked });
          await deps.log("execute", `${step.tool}: ${rep.blocked}.`, { tool: step.tool, repair: "blocked" }, false);
          continue;
        }
        if (rep.fanOut.length > 1) {
          const at = parsed.steps.indexOf(step);
          parsed.steps.splice(at + 1, 0, ...rep.fanOut.slice(1).map((args) => ({ ...step, args })));
        }
        step.args = rep.args;
        if (rep.notes.length) await deps.log("execute", `${step.tool}: arguments completed (${rep.notes.join("; ").slice(0, 200)}).`, { tool: step.tool, repair: rep.notes }, true);
      }
      // the same tool failing the same way twice is not tried again in this run (no wall of identical failures)
      if ([...sameFail.entries()].some(([k, n]) => k.startsWith(`${step.tool}::`) && n >= SAME_FAILURE_LIMIT)) {
        results.push({ tool: step.tool, ok: false, summary: "skipped: the same step already failed twice in this run" });
        continue;
      }
      const v = validateArgs(step.tool, step.args);
      if (!v.ok) {
        sameFail.set(failureKey(step.tool, v.error), (sameFail.get(failureKey(step.tool, v.error)) ?? 0) + 1);
        results.push({ tool: step.tool, ok: false, summary: v.error });
        await deps.log("execute", `${step.tool}: invalid arguments (${v.error}).`, { tool: step.tool }, false);
        continue;
      }
      const d = decide(step.tool, member, settings, { interactive: deps.interactive });
      if (d.do === "blocked") {
        // missing permission (additive): instead of failing silently, ask the owner ONCE per task + tool to grant it —
        // approving adds the tool to this employee and the task runs again
        if (d.why === "tool_not_allowed" && grantable(step.tool, TOOL_MAP) && !askedGrant.has(step.tool)) {
          askedGrant.add(step.tool);
          const id = await deps.approval({ tool: GRANT_TOOL, payload: { tool: step.tool }, preview: grantPreview(deps.lang, { member: member.name, tool: step.tool, task: task.title }), reason: grantReason(deps.lang, step.why ?? ""), sensitivity: "internal" });
          if (id) {
            out.approvals.push(id);
            results.push({ tool: step.tool, ok: false, summary: "waiting for the owner to grant this permission" });
            await deps.log("execute", `Not allowed: ${step.tool} (${d.why.replace(/_/g, " ")}).`, { tool: step.tool, why: d.why }, false);
            await deps.log("approval", `Asked the owner for permission to use ${step.tool}.`, { tool: step.tool, why: d.why });
            continue;
          }
        }
        results.push({ tool: step.tool, ok: false, summary: `blocked: ${d.why}` });
        await deps.log("execute", `Not allowed: ${step.tool} (${d.why.replace(/_/g, " ")}).`, { tool: step.tool, why: d.why }, false);
        continue;
      }
      if (step.tool === "team.ask_user") {
        const gate = ownerQuestionCheck(String(v.args.question ?? ""), member.tools ?? [], askRedirected);
        if (!gate.ok) {
          askRedirected.add(gate.tool);
          results.push({ tool: step.tool, ok: false, summary: gate.hint });
          await deps.log("understand", `Looked it up instead of asking the owner (${gate.tool}).`, { tool: gate.tool }, true);
          continue;
        }
        out.status = "awaiting_input";
        out.question = gate.question;
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
      // upgrade 3: write actions only (reads always continue)
      const spec = TOOL_MAP[step.tool]!;
      if (spec.kind !== "read" && deps.ops) {
        let blockedBy: string | null = null;
        if (frozen && deps.ops.anomalyFreeze) blockedBy = `paused_${frozen}`;
        if (!blockedBy && deps.ops.rateLimits) {
          const prior = (await deps.recentCalls?.(step.tool, 60_000).catch(() => [] as number[])) ?? [];
          const mine = ran.filter((e) => e.tool === step.tool).map((e) => e.at);
          const rc = checkRate([...prior, ...mine], Date.now(), rateLimitFor(step.tool, spec.sensitivity, spec.kind));
          if (!rc.ok) blockedBy = `rate_limited_${Math.ceil(rc.retryAfterMs / 1000)}s`;
        }
        const cid = typeof v.args.contact_id === "string" ? v.args.contact_id : "";
        if (!blockedBy && cid && spec.sensitivity !== "internal") {
          recipients.add(cid);
          if (recipientCapExceeded(recipients.size, deps.ops.recipientCap)) blockedBy = "recipient_cap";
        }
        if (blockedBy) {
          results.push({ tool: step.tool, ok: false, summary: `held: ${blockedBy}` });
          await deps.log("execute", `Held back: ${step.tool} (${blockedBy.replace(/_/g, " ")}).`, { tool: step.tool, protection: blockedBy }, false);
          continue;
        }
      }
      if (d.do === "approve") {
        const id = await deps.approval({ tool: step.tool, payload: v.args, preview: JSON.stringify(v.args).slice(0, 1500), reason: step.why || d.why, sensitivity: d.sensitivity, double: needsDoubleApproval(d.sensitivity) });
        if (id) out.approvals.push(id);
        results.push({ tool: step.tool, ok: true, summary: "waiting for the owner's approval" });
        await deps.log("approval", `Waiting for approval: ${step.tool} — ${step.why || d.why}`, { tool: step.tool, why: d.why });
        continue;
      }
      const r = await (prefetch.get(step) ?? retryTool(deps, step.tool, v.args));
      results.push({ tool: step.tool, ok: r.ok, summary: r.ok ? r.summary : r.error ?? "failed" });
      if (!r.ok) sameFail.set(failureKey(step.tool, r.error), (sameFail.get(failureKey(step.tool, r.error)) ?? 0) + 1);
      if (spec.kind !== "read") {
        // only WRITE actions count: five reads in a row are normal work, five identical writes are not
        ran.push({ tool: step.tool, at: Date.now(), ok: r.ok });
        const an = detectAnomalies(ran, member.tools, Date.now());
        if (!frozen && deps.ops?.anomalyFreeze && shouldFreeze(an)) {
          frozen = an[0]!.kind;
          await deps.log("system", `Unusual behaviour (${an.map((x) => x.detail).join("; ")}) — write actions are paused until a person looks.`, { anomalies: an }, false);
        }
      }
      await deps.log("execute", r.ok ? `${step.tool}: ${r.summary.replace(/Market data below is EXTERNAL[\s\S]*?never fill the gap with guesses\.\s*/, "").slice(0, 300)}` : `${step.tool} failed: ${(r.error ?? "").slice(0, 200)}`, { tool: step.tool, link: r.link ?? null }, r.ok);
    }
    if (!parsed.more) break;
  }
  if (!plan) return fail("failed", "no_plan", "No plan.");
  if (capHold && results.length === 0 && plan.steps.length > 0) return fail("blocked", "daily_credit_cap", "Held: the daily credit cap was reached before any step ran — the task resumes by itself when credits are available.");

  const lessonIssues: string[] = [];
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
        customer && plan!.deliverable.contact_id ? clientMemoryPrompt(clientMemories(ctx.memories, plan!.deliverable.contact_id)) : "",
        !customer && task.answer ? ownerPrompt(ownerStyle([task.answer, task.title])) : "",
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
    if (issues.length && !stopFinal()) {
      w = await deps.ai("write", system, writePrompt(issues, draft), outTokens);
      out.credits += w.credits;
      if (w.ok) draft = w.text.trim();
      issues = selfCheck(draft, { customerFacing: customer, known: ctx.known, lang: deps.lang, forbidden });
      if (issues.length) await deps.log("self_check", `Still ${issues.length} issue(s) after the fix — the owner will decide.`, { issues }, false);
    }
    // 6 — peer review (customer-facing)
    let reviewDisagreement: string[] = [];
    if (customer && ctx.reviewer && ctx.reviewer.id !== member.id) {
      for (let round = task.review_rounds; round < 2 && !stopFinal(); round++) {
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
        for (const i of verdict.issues.slice(0, 2)) if (!lessonIssues.includes(i)) lessonIssues.push(i);
        const fix = await deps.ai("write", system, writePrompt(verdict.issues.length ? verdict.issues : ["Improve per the reviewer."], draft), 1200);
        out.credits += fix.credits;
        if (fix.ok) draft = fix.text.trim();
      }
    }
    out.output = draft;
    // upgrade 9: written posts become DRAFTS on the posts board (never published without the owner) — before, they stayed in a report
    const postTask = plan.deliverable.type === "post" || wantsPosts(`${task.title} ${task.brief}`);
    if (postTask && plan.deliverable.type !== "review_reply" && plan.deliverable.type !== "message" && plan.deliverable.type !== "reminder") {
      // hygiene (additive): a notes / assumptions part or a report about the post is not a post — only real posts are saved,
      // cleaned of markdown, each once
      const posts = [...new Set(extractPosts(draft).map((x) => cleanPostBody(x)).flatMap((c) => (c.ok ? [c.text] : [])))];
      const dd = decide("social.save_draft", member, settings, { interactive: deps.interactive });
      if (posts.length && dd.do === "execute") {
        let saved = 0;
        for (const p of posts) {
          const r = await retryTool(deps, "social.save_draft", { text: p });
          if (r.ok) saved++;
        }
        out.drafts = saved;
        if (saved) out.steps += 1;
        await deps.log("deliver", saved ? `Saved ${saved} post draft(s) on the posts board — waiting for the owner's approval there.` : "The post drafts could not be saved.", { tool: "social.save_draft", link: "/social" }, saved > 0);
      } else if (posts.length && dd.do === "blocked" && dd.why === "tool_not_allowed" && grantable("social.save_draft", TOOL_MAP)) {
        const id = await deps.approval({ tool: GRANT_TOOL, payload: { tool: "social.save_draft" }, preview: grantPreview(deps.lang, { member: member.name, tool: "social.save_draft", task: task.title }), reason: grantReason(deps.lang, "save the written posts as drafts"), sensitivity: "internal" });
        if (id) out.approvals.push(id);
      }
    }
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
        } else if (d.do === "approve" || unresolved || (deps.ops?.quietEnabled && deps.ops.quietNow && customer)) {
          const quiet = !unresolved && d.do !== "approve";
          const reason = unresolved ? `Quality review did not fully approve: ${[...reviewDisagreement, ...issues].slice(0, 3).join("; ")}` : quiet ? "Quiet hours — a customer message waits for the owner." : plan.deliverable.instructions || plan.understanding;
          const sens = d.do === "approve" ? d.sensitivity : TOOL_MAP[tool]!.sensitivity;
          const id = await deps.approval({ tool, payload: v.args, preview: draft.slice(0, 1500), reason, sensitivity: sens, double: needsDoubleApproval(sens) });
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
  // upgrade 9: a limit stopped the planned work → the same employee continues in a new run (bounded by the depth limit)
  if ((limitStop === "task_credit_limit" || limitStop === "step_limit") && deps.continueLater && task.depth < settings.max_depth && out.status !== "failed") {
    const c = await deps.continueLater({ title: continuationTitle(task.title, deps.lang), brief: continuationBrief({ title: task.title, done: results, reason: limitStop }) }).catch(() => ({ ok: false }) as { ok: boolean; taskId?: string });
    if (c.ok && c.taskId) {
      out.handoffs.push(c.taskId);
      await deps.log("system", "A limit stopped the work before the end — the rest continues automatically in a new run.", { reason: limitStop, task: c.taskId });
    }
  }
  // upgrade 9: honest completion — asked to produce something and nothing was produced → "partially done", with the reason
  {
    const v = completionVerdict({
      task: `${task.title} ${task.brief}`,
      expectsPosts: wantsPosts(`${task.title} ${task.brief}`),
      produced: { drafts: out.drafts ?? 0, writes: ran.filter((e) => e.ok).length, approvals: out.approvals.length, handoffs: out.handoffs.length, deliverableChars: (out.output ?? "").length, stopped: Boolean(limitStop) },
    });
    if (v.partial && out.status === "done") {
      out.partial = true;
      out.partialReason = v.reason;
      await deps.log("system", `Partially done: ${String(v.reason).replace(/_/g, " ")}.`, { reason: v.reason }, false);
    }
  }
  // 8 — summarize + learn
  const did = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  // upgrade 6: the summary is written in the business language (it was English even for Hebrew businesses)
  const L = REPORT_TEXT[deps.lang] ?? REPORT_TEXT.en;
  out.report = [
    plan.understanding || task.title,
    `${L.done(did)}${failed ? `, ${L.notDone(failed)}` : ""}${out.approvals.length ? `, ${L.waiting(out.approvals.length)}` : ""}${out.handoffs.length ? `, ${L.handed(out.handoffs.length)}` : ""}.`,
    plan.assumptions.length ? `${L.assumptions}: ${plan.assumptions.join("; ")}` : "",
    out.drafts ? DRAFTS_TEXT[deps.lang](out.drafts) : "",
    out.partial ? PARTIAL_TEXT[deps.lang] : "",
  ]
    .filter(Boolean)
    .join(" ");
  await deps.remember([{ layer: "episodic", kind: "outcome", content: `${task.title}: ${out.report}`.slice(0, 1500), subject: null, confidence: 0.6, status: "active" }]);
  // upgrade 3 (additive): what this conversation taught about THIS customer, and what the whole team can learn from the review
  try {
    const cid = plan.deliverable.contact_id;
    if (cid && deps.rememberClient && customerRole) {
      const ig = interactionGuidance({ message: `${task.title}\n${task.brief}`.slice(0, 2000) });
      const items = learnFromInteraction({ contactId: cid, emotion: ig.read.emotion, objection: ig.objection, register: ig.style.register });
      if (items.length) await deps.rememberClient(cid, items);
    }
    if (deps.share && lessonIssues.length) {
      await deps.share([lessonToMemory({ fromRole: member.role, content: lessonIssues.slice(0, 2).join("; "), forRoles: [member.role] })]);
    }
  } catch {
    /* learning is a bonus — it never fails a finished task */
  }
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
