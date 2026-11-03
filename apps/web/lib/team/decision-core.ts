/**
 * Upgrade 7 / stage E — decision and reflection (pure).
 *
 * "Human-like thinking", made measurable. The raw chain of thought is never shown or stored — only a DECISION RECORD:
 * what I understood, what I decided, why, how sure I am (calibrated), and what would change my mind. Everything the model
 * writes is checked by deterministic code, and the verdict of that code cannot be overridden by a model:
 *   - routing: a cheap fast path for simple tasks, the deep path (2–3 options + pre-mortem + an independent audit) ONLY for tasks
 *     that classifyRoute() — plain code, no model — marks as risky;
 *   - the record is append-only and hash-chained (tamper-evident);
 *   - an internal auditor (a DIFFERENT employee) reviews deep decisions;
 *   - lessons go to memory only as PROPOSALS until the owner confirms.
 */
import { firstJsonObject as firstJsonObjectStrict } from "@/lib/operator/operator-core";
import { firstJsonObjectTolerant } from "./json-repair-core";
import { inventedPrices, leaks } from "./safety-core";
import type { Cost } from "./understanding-core";

export type Lang = "he" | "en" | "ar";
export type Route = "fast" | "deep";
export type Sensitivity = "internal" | "customer" | "money" | "irreversible";

/* ------------------------------------------------------------------------------------------------ routing (code, not model) */

const HIGH_RISK_TEXT = /(החזר|זיכוי|מחיקה|למחוק|תביעה|עורך דין|משפט|הנחה|שינוי מחיר|העלאת מחיר|פיטור|סגירת חשבון|ביטול הזמנה|delete|refund|lawsuit|legal|attorney|discount|price change|terminate|chargeback|cancel all|حذف|استرجاع|دعوى|خصم|محامي)/i;

export interface RouteInput {
  steps?: { tool: string; sensitivity: Sensitivity }[];
  customerFacing?: boolean;
  recipients?: number;
  amounts?: number[];
  text?: string;
  cost?: Cost;
  confidence?: number;
  goalLinked?: boolean;
  /** an amount at or above this is "big money" for the business (default 1000) */
  bigAmount?: number;
}

/** deterministic: the deep path is for risk only. Returns every reason so the owner can see WHY a task was slowed down. */
export function classifyRoute(i: RouteInput): { route: Route; reasons: string[] } {
  const reasons: string[] = [];
  const sens = new Set((i.steps ?? []).map((s) => s.sensitivity));
  if (sens.has("money")) reasons.push("money_action");
  if (sens.has("irreversible")) reasons.push("irreversible_action");
  if (i.customerFacing && (i.recipients ?? 1) > 3) reasons.push("many_recipients");
  if ((i.amounts ?? []).some((a) => a >= (i.bigAmount ?? 1000))) reasons.push("large_amount");
  if (i.text && HIGH_RISK_TEXT.test(i.text)) reasons.push("high_risk_wording");
  if (i.cost === "high") reasons.push("high_cost_of_error");
  if (i.customerFacing && typeof i.confidence === "number" && i.confidence < 0.5) reasons.push("unsure_reading");
  if (i.goalLinked && sens.has("customer") && (i.recipients ?? 1) > 1) reasons.push("goal_with_customers");
  return { route: reasons.length ? "deep" : "fast", reasons };
}

/* ------------------------------------------------------------------------------------------------ the model's decision block */

export interface Option {
  id: string;
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  risk: "low" | "medium" | "high";
  reversible: boolean;
}
export interface FailureMode {
  cause: string;
  likelihood: "low" | "medium" | "high";
  mitigation: string;
}
export interface Premortem {
  failure_modes: FailureMode[];
  tripwires: string[];
}
export interface DecisionDraft {
  understood: string;
  decided: string;
  why: string;
  /** the model's own number, 0..1 (calibrated later) */
  confidence: number;
  would_change_mind: string[];
  options: Option[];
  chosen: string | null;
  premortem: Premortem | null;
}

const str = (v: unknown, n = 400) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const list = (v: unknown, n = 5, len = 240) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []);
const lvl = (v: unknown): "low" | "medium" | "high" => (v === "low" || v === "high" ? v : "medium");
const parseJson = (raw: string): unknown => firstJsonObjectStrict(raw) ?? firstJsonObjectTolerant(raw);

/** the model's JSON (a plan with a "decision" key, or the decision object itself) → a clean bounded draft; null when absent */
export function parseDecision(raw: string): DecisionDraft | null {
  const j = parseJson(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return null;
  const d = (j.decision && typeof j.decision === "object" ? j.decision : j.decided || j.why ? j : null) as Record<string, unknown> | null;
  if (!d) return null;
  const options: Option[] = (Array.isArray(d.options) ? d.options : [])
    .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
    .filter((o) => str(o.title))
    .slice(0, 3)
    .map((o, i) => ({ id: str(o.id, 20) || String.fromCharCode(65 + i), title: str(o.title, 120), summary: str(o.summary, 300), pros: list(o.pros, 4), cons: list(o.cons, 4), risk: lvl(o.risk), reversible: o.reversible !== false }));
  const pm = d.premortem && typeof d.premortem === "object" ? (d.premortem as Record<string, unknown>) : null;
  const premortem: Premortem | null = pm
    ? {
        failure_modes: (Array.isArray(pm.failure_modes) ? pm.failure_modes : [])
          .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
          .filter((f) => str(f.cause))
          .slice(0, 4)
          .map((f) => ({ cause: str(f.cause, 240), likelihood: lvl(f.likelihood), mitigation: str(f.mitigation, 240) })),
        tripwires: list(pm.tripwires, 4),
      }
    : null;
  const conf = Number(d.confidence);
  return {
    understood: str(d.understood, 400),
    decided: str(d.decided, 400),
    why: str(d.why, 600),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf > 1 ? conf / 100 : conf)) : 0.5,
    would_change_mind: list(d.would_change_mind, 4),
    options,
    chosen: str(d.chosen, 20) || null,
    premortem,
  };
}

export const DECISION_FORMAT_FAST = [
  'Also add ONE key "decision" to your JSON (a short record, not your inner thoughts):',
  '"decision": {"understood": "what you understood the request to be", "decided": "what you decided to do", "why": "the reason in one sentence", "confidence": 0.0-1.0, "would_change_mind": ["what new fact would change your decision"]}',
].join("\n");

export const DECISION_FORMAT_DEEP = [
  "This task is RISKY (see the reasons). Add ONE key \"decision\" to your JSON — a decision record, not your inner thoughts:",
  '"decision": {"understood": "…", "options": [{"id": "A", "title": "…", "summary": "…", "pros": ["…"], "cons": ["…"], "risk": "low|medium|high", "reversible": true|false} (2 or 3 genuinely different options)], "chosen": "A", "decided": "…", "why": "…", "confidence": 0.0-1.0,',
  ' "premortem": {"failure_modes": [{"cause": "assume it failed — the most likely reason", "likelihood": "low|medium|high", "mitigation": "what you do about it"} (2–3)], "tripwires": ["a signal that means stop and ask the owner"]}, "would_change_mind": ["…"]}',
  "Prefer the reversible option when the options are close. Do not claim certainty you do not have.",
].join("\n");

/* ------------------------------------------------------------------------------------------------ the deterministic audit */

export interface AuditResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

/** checks the record can pass or fail WITHOUT any model; a failure here cannot be overridden by an auditor model */
export function auditDecision(d: DecisionDraft, ctx: { route: Route; known?: string; customerFacing?: boolean }): AuditResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (d.why.length < 10) failures.push("missing_reason");
  if (!d.decided) failures.push("missing_decision");
  if (!d.would_change_mind.length) failures.push("missing_change_my_mind");
  if (ctx.route === "deep") {
    if (d.options.length < 2) failures.push("deep_needs_options");
    else if (!d.chosen || !d.options.some((o) => o.id === d.chosen)) failures.push("chosen_not_among_options");
    if (!d.premortem || d.premortem.failure_modes.length < 2) failures.push("deep_needs_premortem");
    else {
      if (d.premortem.failure_modes.some((f) => !f.mitigation)) failures.push("failure_mode_without_mitigation");
      if (!d.premortem.tripwires.length) failures.push("deep_needs_tripwire");
      const openHigh = d.premortem.failure_modes.some((f) => f.likelihood === "high");
      if (openHigh && d.confidence >= 0.85) failures.push("confident_despite_high_risk_failure");
    }
    const chosen = d.options.find((o) => o.id === d.chosen);
    if (chosen && chosen.risk === "high" && d.options.some((o) => o.id !== chosen.id && o.reversible && o.risk !== "high") && !chosen.reversible) warnings.push("irreversible_risky_option_chosen_over_safer_one");
  }
  const text = `${d.understood} ${d.decided} ${d.why}`;
  if (leaks(text)) failures.push("leaks_internal_text");
  if (ctx.known !== undefined) {
    const bad = inventedPrices(text, ctx.known);
    if (bad.length) failures.push(`invented_price:${bad.join(",")}`);
  }
  if (d.confidence >= 0.95 && ctx.route === "deep") warnings.push("suspiciously_certain");
  if (ctx.route === "fast" && d.options.length === 0 && d.confidence < 0.4 && ctx.customerFacing) warnings.push("unsure_customer_facing_on_fast_path");
  return { passed: failures.length === 0, failures, warnings };
}

/* ------------------------------------------------------------------------------------------------ the separate auditor */

export type AuditVerdict = { verdict: "approve" | "revise" | "escalate"; issues: string[] };

/** who audits: never the author; quality control first, then the team lead, then the manager */
export function pickAuditor<T extends { id: string; role: string; status: string }>(members: T[], authorId: string): T | null {
  for (const role of ["quality_control", "team_lead", "manager"]) {
    const m = members.find((x) => x.role === role && x.status === "active" && x.id !== authorId);
    if (m) return m;
  }
  return null;
}

export function auditorPrompt(d: DecisionDraft, route: Route, reasons: string[]): string {
  return [
    "You are the INDEPENDENT auditor of another employee's decision. You did not write it. Look for what the author missed.",
    `Route: ${route}${reasons.length ? ` (risk reasons: ${reasons.join(", ")})` : ""}`,
    `Understood: ${d.understood}`,
    d.options.length ? `Options: ${d.options.map((o) => `${o.id}) ${o.title} [risk ${o.risk}, ${o.reversible ? "reversible" : "irreversible"}] pros: ${o.pros.join("; ")} cons: ${o.cons.join("; ")}`).join(" | ")}` : "",
    `Decided: ${d.decided} (chosen: ${d.chosen ?? "—"})`,
    `Why: ${d.why}`,
    `Author's confidence: ${Math.round(d.confidence * 100)}%`,
    d.premortem ? `Pre-mortem: ${d.premortem.failure_modes.map((f) => `${f.cause} [${f.likelihood}] → ${f.mitigation}`).join(" | ")}; tripwires: ${d.premortem.tripwires.join("; ")}` : "",
    `Would change mind if: ${d.would_change_mind.join("; ")}`,
    'Answer JSON only: {"verdict": "approve"|"revise"|"escalate", "issues": ["specific, numbered problems"]}. "escalate" = the owner must decide. Approve only if the reasoning holds and the risks are handled.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseAuditVerdict(raw: string): AuditVerdict | null {
  const j = parseJson(raw) as Record<string, unknown> | null;
  if (j && (j.verdict === "approve" || j.verdict === "revise" || j.verdict === "escalate")) return { verdict: j.verdict, issues: list(j.issues, 6) };
  return null;
}

export interface FinalAudit {
  verdict: "approve" | "revise" | "escalate";
  issues: string[];
  /** which layers ran */
  deterministic: boolean;
  model: "approve" | "revise" | "escalate" | "not_run" | "unreadable";
}

/** the two layers combined: code can only make the result stricter, never the model */
export function combineAudit(det: AuditResult, model: AuditVerdict | null | "not_run"): FinalAudit {
  const issues = [...det.failures];
  if (!det.passed) return { verdict: "revise", issues, deterministic: false, model: model === "not_run" ? "not_run" : model ? model.verdict : "unreadable" };
  if (model === "not_run") return { verdict: "approve", issues: [], deterministic: true, model: "not_run" };
  if (!model) return { verdict: "approve", issues: [], deterministic: true, model: "unreadable" };
  return { verdict: model.verdict, issues: model.issues, deterministic: true, model: model.verdict };
}

/* ------------------------------------------------------------------------------------------------ the append-only, hash-chained record */

export interface DecisionRecord extends DecisionDraft {
  id: string;
  seq: number;
  task_id: string;
  member_id: string | null;
  route: Route;
  route_reasons: string[];
  raw_confidence: number;
  audit: FinalAudit | null;
  created_at: string;
  prev_hash: string;
  hash: string;
}

/** cyrb53 — a small deterministic 53-bit hash (tamper EVIDENCE for the log, not a security boundary) */
export function hash53(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

const core = (r: Omit<DecisionRecord, "hash">) => JSON.stringify([r.seq, r.task_id, r.member_id, r.route, r.route_reasons, r.understood, r.decided, r.why, r.confidence, r.raw_confidence, r.would_change_mind, r.options, r.chosen, r.premortem, r.audit, r.created_at, r.prev_hash]);

export const GENESIS = "0".repeat(14);

/** returns a NEW log with the record appended; the input is never changed and no record is ever edited or removed */
export function appendRecord(log: readonly DecisionRecord[], draft: DecisionDraft, meta: { id: string; task_id: string; member_id: string | null; route: Route; route_reasons: string[]; confidence: number; audit: FinalAudit | null; now: number }): DecisionRecord[] {
  const last = log[log.length - 1];
  const base: Omit<DecisionRecord, "hash"> = { ...draft, id: meta.id, seq: (last?.seq ?? 0) + 1, task_id: meta.task_id, member_id: meta.member_id, route: meta.route, route_reasons: meta.route_reasons, confidence: Math.round(meta.confidence * 100) / 100, raw_confidence: draft.confidence, audit: meta.audit, created_at: new Date(meta.now).toISOString(), prev_hash: last?.hash ?? GENESIS };
  return [...log, { ...base, hash: hash53(core(base)) }];
}

export function verifyChain(log: readonly DecisionRecord[]): { ok: boolean; brokenAt: number | null } {
  let prev = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const r = log[i]!;
    const { hash, ...rest } = r;
    if (r.prev_hash !== prev || hash !== hash53(core(rest)) || r.seq !== i + 1) return { ok: false, brokenAt: i };
    prev = hash;
  }
  return { ok: true, brokenAt: null };
}

/* ------------------------------------------------------------------------------------------------ lessons (owner-approved only) */

export interface LessonProposal {
  layer: "semantic";
  kind: "fact" | "preference" | "correction" | "outcome";
  content: string;
  subject: string;
  confidence: number;
  /** ALWAYS proposed: nothing a decision teaches is active until the owner confirms it */
  status: "proposed";
  tags: string[];
}

export type Outcome = { result: "good" | "bad" | "unknown"; note?: string };

/** what a finished decision taught — only when the outcome is known; never active without the owner */
export function lessonFromDecision(r: Pick<DecisionRecord, "decided" | "why" | "route" | "would_change_mind" | "premortem" | "confidence">, outcome: Outcome): LessonProposal | null {
  if (outcome.result === "unknown") return null;
  const good = outcome.result === "good";
  if (!good && !outcome.note && !r.would_change_mind.length && !r.premortem) return null;
  const content = good ? `What worked (${r.route} path): ${r.decided} — because ${r.why}`.slice(0, 500) : `What did NOT work: ${r.decided}. ${outcome.note ? `Outcome: ${outcome.note}. ` : ""}Next time watch for: ${[...r.would_change_mind, ...(r.premortem?.tripwires ?? [])].slice(0, 2).join("; ") || "the pre-mortem failure causes"}`.slice(0, 500);
  return { layer: "semantic", kind: good ? "outcome" : "correction", content, subject: `decision:${r.route}`, confidence: good ? 0.55 : 0.65, status: "proposed", tags: ["decision", good ? "worked" : "failed"] };
}

/* ------------------------------------------------------------------------------------------------ wording */

const L: Record<Lang, { understood: string; decided: string; why: string; sure: string; change: string; deep: string; fast: string; options: string; premortem: string; audit: Record<FinalAudit["verdict"], string> }> = {
  he: { understood: "מה הבנתי", decided: "מה החלטתי", why: "למה", sure: "מידת הביטחון", change: "מה היה משנה את דעתי", deep: "מסלול עמוק (משימה בסיכון)", fast: "מסלול מהיר", options: "אפשרויות שבדקתי", premortem: "מה עלול להשתבש", audit: { approve: "המבקר אישר", revise: "המבקר ביקש תיקון", escalate: "המבקר ביקש החלטת בעלים" } },
  en: { understood: "What I understood", decided: "What I decided", why: "Why", sure: "How sure I am", change: "What would change my mind", deep: "Deep path (risky task)", fast: "Fast path", options: "Options I weighed", premortem: "What could go wrong", audit: { approve: "Auditor approved", revise: "Auditor asked for a fix", escalate: "Auditor asked for the owner's decision" } },
  ar: { understood: "ما فهمته", decided: "ما قررته", why: "لماذا", sure: "درجة الثقة", change: "ما الذي سيغيّر رأيي", deep: "المسار العميق (مهمة محفوفة بالمخاطر)", fast: "المسار السريع", options: "الخيارات التي درستها", premortem: "ما الذي قد يسوء", audit: { approve: "وافق المدقق", revise: "طلب المدقق تصحيحا", escalate: "طلب المدقق قرار المالك" } },
};
export const decisionLabels = (lang: Lang) => L[lang];

/** the owner-facing text of a record (short; no raw reasoning) */
export function renderRecord(r: DecisionRecord, lang: Lang): string {
  const t = L[lang];
  const out = [`${r.route === "deep" ? t.deep : t.fast} · ${t.sure}: ${Math.round(r.confidence * 100)}%`, `${t.understood}: ${r.understood}`];
  if (r.options.length) out.push(`${t.options}: ${r.options.map((o) => `${o.id}) ${o.title}`).join(" / ")}`);
  out.push(`${t.decided}: ${r.decided}`, `${t.why}: ${r.why}`);
  if (r.premortem?.failure_modes.length) out.push(`${t.premortem}: ${r.premortem.failure_modes.map((f) => `${f.cause} → ${f.mitigation}`).join("; ")}`);
  if (r.would_change_mind.length) out.push(`${t.change}: ${r.would_change_mind.join("; ")}`);
  if (r.audit) out.push(t.audit[r.audit.verdict] + (r.audit.issues.length ? `: ${r.audit.issues.join("; ")}` : ""));
  return out.join("\n");
}

/** one line to append to an approval's reason, so the owner sees the reasoning next to the button */
export function approvalNote(r: Pick<DecisionRecord, "understood" | "decided" | "why" | "confidence" | "route">, lang: Lang): string {
  const t = L[lang];
  return `[${r.route === "deep" ? t.deep : t.fast}; ${t.sure} ${Math.round(r.confidence * 100)}%] ${t.decided}: ${r.decided} — ${r.why}`.slice(0, 600);
}
