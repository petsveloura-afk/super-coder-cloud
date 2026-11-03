/**
 * Upgrade 8 / stage B3 — responsibility (RACI) and the approval matrix (pure, unit-tested).
 *
 *  RACI    for every kind of procedure: who does it (R), who approves (A), who is consulted (C), who is informed (I).
 *  Matrix  extra approval rules by action type and size (a discount above X, a deal above Y, a message to many, a bulk agent run).
 *
 * THE ONE RULE: the matrix and the RACI can only make the team STRICTER. `tighten()` turns an "execute" into an owner approval and
 * never turns an approval or a block into an execute; `effectiveApprover()` is always the owner for anything a customer sees, money
 * or irreversible, whatever the table says; and an override can never move the "A" of an owner-approved procedure to an employee.
 */
import type { Decision } from "./policy-core";
import type { Sensitivity } from "./tools-core";
import { ROLE_KEYS } from "./roles";
import { DEFAULT_SOPS } from "./sop-defaults-core";
import { effectiveSops, sopFor } from "./sop-core";
import type { Lang } from "./departments-core";

export const OWNER = "owner";
const ROLE_SET = new Set<string>(ROLE_KEYS);
const isRole = (v: unknown): v is string => typeof v === "string" && ROLE_SET.has(v);

/* ------------------------------------------------------------------ RACI */

export interface Raci {
  key: string;
  /** the role that does the work */
  R: string;
  /** who approves the result: a role, or "owner" */
  A: string;
  C: string[];
  I: string[];
}

const T = (key: string, R: string, A: string, C: string[], I: string[]): Raci => ({ key, R, A, C, I });

/** one row per default procedure; an owner override replaces a row (see mergeRaci) — a default itself is never edited */
export const DEFAULT_RACI: Raci[] = [
  T("sales_new_lead", "sales", "manager", ["customer_service"], ["marketing"]),
  T("sales_quote", "sales", OWNER, ["manager"], ["collections"]),
  T("sales_stuck_deal", "sales", "manager", ["customer_service"], ["analyst"]),
  T("mkt_weekly_content", "marketing", "manager", ["content_writer", "analyst"], ["sales"]),
  T("mkt_campaign_launch", "marketing", OWNER, ["content_writer", "sales"], ["customer_service"]),
  T("mkt_results_review", "analyst", "manager", ["marketing"], ["sales"]),
  T("svc_inquiry", "customer_service", "manager", ["sales"], []),
  T("svc_complaint", "customer_service", OWNER, ["manager", "quality_control"], ["sales"]),
  T("svc_review_reply", "reputation", "manager", ["customer_service"], ["marketing"]),
  T("ops_task_intake", "project_coordinator", "manager", ["team_lead"], []),
  T("ops_quality_check", "quality_control", "manager", ["project_coordinator"], []),
  T("ops_unblock", "project_coordinator", "manager", ["team_lead"], ["analyst"]),
  T("fin_overdue", "collections", OWNER, ["customer_service", "sales"], ["manager"]),
  T("fin_invoice_check", "collections", "manager", ["analyst"], []),
  T("fin_refund", "collections", OWNER, ["customer_service", "manager"], ["sales"]),
  T("mgmt_weekly_review", "manager", OWNER, ["analyst", "team_lead"], []),
  T("mgmt_goal_setting", "manager", OWNER, ["analyst"], ["team_lead"]),
  T("mgmt_incident", "manager", OWNER, ["quality_control"], ["customer_service"]),
];
export const RACI_MAP: Record<string, Raci> = Object.fromEntries(DEFAULT_RACI.map((r) => [r.key, r]));

/** the stored owner override of one row (every field optional) */
export interface RaciOverride {
  key: string;
  R?: string | null;
  A?: string | null;
  C?: string[] | null;
  I?: string[] | null;
}

const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * An owner's edit, cleaned. Roles must exist; R is a role; C / I are roles (max 6, no duplicates, never the R); A is a role or "owner" —
 * BUT a procedure whose default A is the owner keeps the owner as A (`cannot_lower`): editing the table never takes the owner out of a
 * decision they had.
 */
export function cleanRaci(raw: Record<string, unknown>): { ok: true; row: RaciOverride } | { ok: false; error: string } {
  const key = String(raw.key ?? "").trim();
  const base = RACI_MAP[key];
  if (!base) return { ok: false, error: "unknown_procedure" };
  const out: RaciOverride = { key };
  if (raw.R !== undefined && raw.R !== null && raw.R !== "") {
    if (!isRole(raw.R)) return { ok: false, error: "bad:R" };
    out.R = raw.R;
  }
  if (raw.A !== undefined && raw.A !== null && raw.A !== "") {
    const a = String(raw.A);
    if (a !== OWNER && !isRole(a)) return { ok: false, error: "bad:A" };
    if (base.A === OWNER && a !== OWNER) return { ok: false, error: "cannot_lower" };
    out.A = a;
  }
  const list = (v: unknown, name: "C" | "I"): string[] | null | { error: string } => {
    if (v === undefined || v === null) return null;
    const arr = Array.isArray(v) ? v.map(String) : String(v).split(/[,|;\s]+/).filter(Boolean);
    if (arr.some((x) => !isRole(x))) return { error: `bad:${name}` };
    return uniq(arr).slice(0, 6);
  };
  const c = list(raw.C, "C");
  if (c && !Array.isArray(c)) return { ok: false, error: c.error };
  const i = list(raw.I, "I");
  if (i && !Array.isArray(i)) return { ok: false, error: i.error };
  const r = out.R ?? base.R;
  if (c) out.C = c.filter((x) => x !== r);
  if (i) out.I = i.filter((x) => x !== r && !(out.C ?? base.C).includes(x));
  return { ok: true, row: out };
}

/** the effective row: the owner's override over the default; an override that would lower the owner's A is ignored */
export function mergeRaci(key: string, overrides: RaciOverride[] = []): Raci | null {
  const base = RACI_MAP[key];
  if (!base) return null;
  const o = overrides.find((x) => x.key === key);
  if (!o) return base;
  const A = o.A && (o.A === OWNER || isRole(o.A)) && !(base.A === OWNER && o.A !== OWNER) ? o.A : base.A;
  const R = o.R && isRole(o.R) ? o.R : base.R;
  return { key, R, A, C: (o.C ?? base.C).filter((x) => isRole(x) && x !== R), I: (o.I ?? base.I).filter((x) => isRole(x) && x !== R) };
}

export function allRaci(overrides: RaciOverride[] = []): Raci[] {
  return DEFAULT_RACI.map((r) => mergeRaci(r.key, overrides)!);
}

/** the RACI row of the procedure that fits a task text (the same retrieval as the procedure block); null when no procedure fits */
export function raciForTask(taskText: string, overrides: RaciOverride[] = [], lang: Lang = "he"): Raci | null {
  const hit = sopFor(taskText, effectiveSops([], lang), { max: 1 })[0];
  return hit ? mergeRaci(hit.sop.sop_key, overrides) : null;
}

/** who finally approves an action: the owner for anything a customer sees, money or irreversible — whatever the table says */
export function effectiveApprover(raci: Raci | null, sensitivity: Sensitivity): string {
  if (sensitivity !== "internal") return OWNER;
  return raci?.A ?? OWNER;
}

/** the `raci` option of sopPrompt (role keys; a name is shown by the screen) */
export const raciPromptOpt = (r: Raci | null) => (r ? { R: r.R, A: r.A, C: r.C, I: r.I } : null);

/* ------------------------------------------------------------------ the approval matrix */

export type RuleKind = "discount_pct" | "discount_amount" | "deal_value" | "broadcast" | "bulk_tool";

export interface MatrixRule {
  id: string;
  kind: RuleKind;
  tools: string[];
  /** percent (discount_pct), money amount (discount_amount, deal_value); unused by broadcast / bulk_tool */
  threshold: number;
  enabled: boolean;
  label: Record<Lang, string>;
}

const TEXT_TOOLS = ["inbox.send_message", "collections.send_reminder", "calendar.book", "deals.create"];

export const DEFAULT_MATRIX: MatrixRule[] = [
  { id: "discount_pct", kind: "discount_pct", tools: TEXT_TOOLS, threshold: 10, enabled: true, label: { he: "הנחה באחוזים מעל", en: "Discount (%) above", ar: "خصم بالنسبة المئوية فوق" } },
  { id: "discount_amount", kind: "discount_amount", tools: TEXT_TOOLS, threshold: 500, enabled: true, label: { he: "הנחה בסכום מעל", en: "Discount (amount) above", ar: "خصم بمبلغ فوق" } },
  { id: "deal_value", kind: "deal_value", tools: ["deals.create"], threshold: 20000, enabled: true, label: { he: "עסקה חדשה בשווי מעל", en: "New deal worth more than", ar: "صفقة جديدة بقيمة أكثر من" } },
  { id: "broadcast", kind: "broadcast", tools: ["inbox.send_message", "social.schedule_post"], threshold: 0, enabled: true, label: { he: "הודעה לרבים (\"כל הלקוחות\")", en: "Message to many (\"all customers\")", ar: "رسالة للجميع (\"كل العملاء\")" } },
  { id: "bulk_agents", kind: "bulk_tool", tools: ["agents.run_marketing", "agents.run_sales_manager"], threshold: 0, enabled: true, label: { he: "הרצת סוכן שפונה לרבים", en: "Running an agent that reaches many people", ar: "تشغيل وكيل يتواصل مع كثيرين" } },
];
export const MATRIX_IDS = DEFAULT_MATRIX.map((r) => r.id);

export interface MatrixOverride {
  rule_id: string;
  enabled?: boolean | null;
  threshold?: number | null;
}

/** a threshold the owner typed: percent 0..100, money 0..1,000,000,000; null when unusable */
export function cleanThreshold(kind: RuleKind, v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  if (kind === "discount_pct") return n > 100 ? null : Math.round(n * 10) / 10;
  if (kind === "discount_amount" || kind === "deal_value") return n > 1_000_000_000 ? null : Math.floor(n);
  return 0;
}

export function cleanMatrixOverride(raw: Record<string, unknown>): { ok: true; row: MatrixOverride } | { ok: false; error: string } {
  const rule = DEFAULT_MATRIX.find((r) => r.id === String(raw.rule_id ?? ""));
  if (!rule) return { ok: false, error: "unknown_rule" };
  const row: MatrixOverride = { rule_id: rule.id };
  if (raw.enabled !== undefined && raw.enabled !== null) row.enabled = raw.enabled === true || raw.enabled === "true";
  if (raw.threshold !== undefined && raw.threshold !== null && raw.threshold !== "") {
    const th = cleanThreshold(rule.kind, raw.threshold);
    if (th === null) return { ok: false, error: "bad:threshold" };
    row.threshold = th;
  }
  return { ok: true, row };
}

/** the default matrix with the owner's switches and thresholds applied */
export function resolveMatrix(overrides: MatrixOverride[] = []): MatrixRule[] {
  return DEFAULT_MATRIX.map((r) => {
    const o = overrides.find((x) => x.rule_id === r.id);
    if (!o) return r;
    const th = o.threshold === undefined || o.threshold === null ? r.threshold : cleanThreshold(r.kind, o.threshold);
    return { ...r, enabled: typeof o.enabled === "boolean" ? o.enabled : r.enabled, threshold: th ?? r.threshold };
  });
}

/* ---- reading discounts and "everyone" out of free text (Hebrew / English / Arabic) */

const DISCOUNT_WORD = /(הנחה|הנחת|הנחות|קופון|discount|coupon|promo(?:tion)?|\boff\b|خصم|تخفيض|قسيمة)/i;
const CURRENCY = /(₪|ש"ח|שח|ש״ח|שקל|nis|ils|usd|\$|€|eur|£|gbp|דולר|يورو|دولار|شيكل|ريال)/i;
const BROADCAST = /(לכל הלקוחות|כל הלקוחות|כל אנשי הקשר|כל הרשימה|\ball (?:of )?(?:our )?(?:customers|contacts|clients|subscribers)\b|\bmailing list\b|\beveryone on (?:the|our) list\b|جميع العملاء|كل العملاء|كل جهات الاتصال)/i;

const num = (s: string) => Number(s.replace(/,/g, ""));
const near = (text: string, i: number, len: number, w = 28) => DISCOUNT_WORD.test(text.slice(Math.max(0, i - w), Math.min(text.length, i + len + w)));

/** the biggest discount stated in a text: a percentage and / or an amount (only numbers next to a discount word) */
export function discountsIn(text: string): { pct: number; amount: number } {
  let pct = 0;
  let amount = 0;
  const t = String(text ?? "");
  for (const m of t.matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?:%|٪|אחוז|percent)/gi)) {
    if (near(t, m.index ?? 0, m[0].length)) pct = Math.max(pct, num(m[1]!));
  }
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?!%|٪)(₪|ש"ח|שח|ש״ח|שקל|nis|ils|usd|\$|€|eur|£|gbp|דולר|يورو|دولار|شيكل|ريال)?/gi)) {
    const idx = m.index ?? 0;
    const before = t.slice(Math.max(0, idx - 2), idx);
    const hasCur = Boolean(m[2]) || CURRENCY.test(before);
    if (!hasCur || !near(t, idx, m[0].length)) continue;
    const v = num(m[1]!);
    if (Number.isFinite(v)) amount = Math.max(amount, v);
  }
  return { pct, amount };
}

export const mentionsBroadcast = (text: string): boolean => BROADCAST.test(String(text ?? ""));

export interface MatrixHit {
  ruleId: string;
  kind: RuleKind;
  /** the value found (percent / amount); 0 for kinds without one */
  value: number;
  threshold: number;
  sensitivity: Sensitivity;
}

const strings = (args: Record<string, string | number>) => Object.values(args).filter((v): v is string => typeof v === "string").join(" \n ");

/** the first enabled rule that the action trips, or null. Pure: same input, same answer. */
export function matrixCheck(tool: string, args: Record<string, string | number>, rules: MatrixRule[] = DEFAULT_MATRIX): MatrixHit | null {
  const text = strings(args);
  const money = tool === "collections.send_reminder" || tool === "agents.run_collections";
  const sensitivity: Sensitivity = money ? "money" : "customer";
  for (const r of rules) {
    if (!r.enabled || !r.tools.includes(tool)) continue;
    if (r.kind === "bulk_tool") return { ruleId: r.id, kind: r.kind, value: 0, threshold: 0, sensitivity };
    if (r.kind === "broadcast") {
      if (mentionsBroadcast(text)) return { ruleId: r.id, kind: r.kind, value: 0, threshold: 0, sensitivity };
      continue;
    }
    if (r.kind === "deal_value") {
      const v = Number(args.value);
      if (Number.isFinite(v) && v > r.threshold) return { ruleId: r.id, kind: r.kind, value: v, threshold: r.threshold, sensitivity: "money" };
      continue;
    }
    const d = discountsIn(text);
    if (r.kind === "discount_pct" && d.pct > r.threshold) return { ruleId: r.id, kind: r.kind, value: d.pct, threshold: r.threshold, sensitivity };
    if (r.kind === "discount_amount" && d.amount > r.threshold) return { ruleId: r.id, kind: r.kind, value: d.amount, threshold: r.threshold, sensitivity };
  }
  return null;
}

/**
 * Combines the existing policy decision with the matrix. It can only move toward the owner:
 *   blocked → blocked, approve → approve (untouched), execute → approve when the matrix hit. Never the other way.
 */
export function tighten(base: Decision, hit: MatrixHit | null): Decision {
  if (!hit || base.do !== "execute") return base;
  return { do: "approve", sensitivity: hit.sensitivity, why: `raci:${hit.ruleId}` };
}

/** is `b` at least as strict as `a`? (execute < approve < blocked) — used by the tests and as a runtime assertion */
export const strictness = (d: Decision): number => (d.do === "execute" ? 0 : d.do === "approve" ? 1 : 2);

export function holdReason(hit: MatrixHit, lang: Lang): string {
  const v = hit.value;
  const th = hit.threshold;
  const t: Record<RuleKind, Record<Lang, string>> = {
    discount_pct: { he: `הנחה של ${v}% (מעל ${th}%) — נדרש אישור הבעלים לפי מטריצת האישורים`, en: `A ${v}% discount (above ${th}%) needs the owner's approval under the approval matrix`, ar: `خصم ${v}٪ (فوق ${th}٪) يحتاج موافقة المالك حسب مصفوفة الموافقات` },
    discount_amount: { he: `הנחה בסך ${v} (מעל ${th}) — נדרש אישור הבעלים לפי מטריצת האישורים`, en: `A discount of ${v} (above ${th}) needs the owner's approval under the approval matrix`, ar: `خصم بمبلغ ${v} (فوق ${th}) يحتاج موافقة المالك حسب مصفوفة الموافقات` },
    deal_value: { he: `עסקה בשווי ${v} (מעל ${th}) — נדרש אישור הבעלים לפי מטריצת האישורים`, en: `A deal worth ${v} (above ${th}) needs the owner's approval under the approval matrix`, ar: `صفقة بقيمة ${v} (فوق ${th}) تحتاج موافقة المالك حسب مصفوفة الموافقات` },
    broadcast: { he: "הודעה לרבים — נדרש אישור הבעלים לפי מטריצת האישורים", en: "A message to many people needs the owner's approval under the approval matrix", ar: "رسالة لعدد كبير من الناس تحتاج موافقة المالك حسب مصفوفة الموافقات" },
    bulk_tool: { he: "הרצת סוכן שפונה לרבים — נדרש אישור הבעלים לפי מטריצת האישורים", en: "Running an agent that reaches many people needs the owner's approval under the approval matrix", ar: "تشغيل وكيل يتواصل مع كثيرين يحتاج موافقة المالك حسب مصفوفة الموافقات" },
  };
  return t[hit.kind][lang];
}

/** the procedure keys that exist (so a stored override of a removed key is ignored) */
export const RACI_KEYS = DEFAULT_SOPS.map((s) => s.key);
