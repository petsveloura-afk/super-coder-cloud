/**
 * Upgrade 8 / stage B2 — standard operating procedures (SOP) with versions (pure, unit-tested).
 *
 * A procedure = purpose, trigger, steps, owner, success measure, escalation conditions, what needs approval, department.
 * Every change is a NEW VERSION (append-only: the old row is closed with valid_to, never edited or deleted) with a source and a date.
 * A change an employee suggests waits for the owner; only the owner's own edit becomes current at once.
 * Retrieval is by relevance (trigger + title, Hebrew / Arabic prefixes handled) and goes into the employee's context as a SEPARATE block.
 * A procedure never lowers the approval rules: customer-facing, money and irreversible actions still need the owner.
 */
import { DEFAULT_SOPS, DEFAULT_SOP_MAP, type DefaultSop } from "./sop-defaults-core";
import { isDeptKey, type DeptKey, type Lang } from "./departments-core";
import { jaccard, tokens } from "./memory-plus-core";

export type SopSource = "default" | "owner" | "agent";
export type SopStatus = "current" | "proposed" | "superseded" | "rejected";

export interface SopContent {
  title: string;
  purpose: string;
  trigger: string;
  steps: string[];
  owner_role: string;
  success_metric: string;
  escalation: string;
  approvals: string[];
  dept: DeptKey;
  lang: Lang;
}
export interface NewSop extends SopContent {
  sop_key: string;
}
export interface SopVersion extends NewSop {
  id: string;
  version: number;
  status: SopStatus;
  source: SopSource;
  proposed_by: string | null;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

const clean = (s: unknown, max: number): string =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** a list typed as "a | b | c" or an array → clean items (max `n` items of `len` chars) */
export function cleanList(v: unknown, n: number, len: number): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/\s*[|\n;]\s*/);
  return raw.map((x) => clean(x, len)).filter(Boolean).slice(0, n);
}

/** a stable key: a typed key if it is valid, else letters / digits of the title, else a short hash (Hebrew titles have no latin letters) */
export function sopKeyFor(title: string, given?: unknown): string {
  const g = String(given ?? "").trim().toLowerCase();
  if (/^[a-z0-9_]{3,40}$/.test(g)) return g;
  const latin = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  if (latin.length >= 3) return `c_${latin}`;
  let h = 5381;
  for (const ch of String(title ?? "")) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return `c_${h.toString(36)}`;
}

export type NormalizedSop = { sop: NewSop } | { rejected: string };

export function normalizeSop(raw: Record<string, unknown>, fallbackLang: Lang = "he"): NormalizedSop {
  const title = clean(raw.title, 120);
  if (title.length < 3) return { rejected: "bad:title" };
  const steps = cleanList(raw.steps ?? raw.body, 12, 300);
  if (!steps.length) return { rejected: "bad:steps" };
  const dept = isDeptKey(raw.dept) ? raw.dept : isDeptKey(raw.dept_key) ? raw.dept_key : "operations";
  const lang = raw.lang === "en" || raw.lang === "ar" || raw.lang === "he" ? raw.lang : fallbackLang;
  return {
    sop: {
      sop_key: sopKeyFor(title, raw.sop_key),
      title,
      purpose: clean(raw.purpose, 400),
      trigger: clean(raw.trigger ?? raw.trigger_text, 400),
      steps,
      owner_role: clean(raw.owner_role, 40) || "manager",
      success_metric: clean(raw.success_metric, 300),
      escalation: clean(raw.escalation, 400),
      approvals: cleanList(raw.approvals, 8, 200),
      dept,
      lang,
    },
  };
}

/** what "the same content" means (so saving the same text twice does not create a version) */
export function contentFingerprint(c: Pick<SopContent, "title" | "purpose" | "trigger" | "steps" | "success_metric" | "escalation" | "approvals" | "dept" | "owner_role">): string {
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return [c.dept, n(c.owner_role), n(c.title), n(c.purpose), n(c.trigger), c.steps.map(n).join("¦"), n(c.success_metric), n(c.escalation), c.approvals.map(n).join("¦")].join("§");
}

/* ------------------------------------------------------------------ versions: append-only */

export type SopPlan =
  | { action: "create"; version: number }
  | { action: "new_version"; version: number; supersedesId: string }
  | { action: "propose"; version: number; againstId: string | null }
  | { action: "duplicate"; id: string | null };

/**
 * How a change is stored. `history` = every stored version of ONE procedure key.
 *  - owner: becomes current at once (a previous current is closed, not deleted)
 *  - agent: always a PROPOSAL — it waits for the owner, even for a brand-new procedure
 *  - identical content to the current version (or to an open proposal) is a duplicate; identical to the built-in default with nothing stored is too
 */
export function planSopChange(history: SopVersion[], incoming: NewSop, source: SopSource): SopPlan {
  const fp = contentFingerprint(incoming);
  const cur = history.find((h) => h.status === "current") ?? null;
  const open = history.find((h) => h.status === "proposed" && contentFingerprint(h) === fp);
  if (open) return { action: "duplicate", id: open.id };
  if (cur && contentFingerprint(cur) === fp) return { action: "duplicate", id: cur.id };
  if (!cur && !history.length) {
    const d = DEFAULT_SOP_MAP[incoming.sop_key];
    if (d && fingerprintOfDefault(d, incoming.lang) === fp) return { action: "duplicate", id: null };
  }
  const version = history.reduce((m, h) => Math.max(m, h.version), 0) + 1;
  if (source === "agent") return { action: "propose", version, againstId: cur?.id ?? null };
  return cur ? { action: "new_version", version, supersedesId: cur.id } : { action: "create", version };
}

function fingerprintOfDefault(d: DefaultSop, lang: Lang): string {
  const t = d.text[lang];
  return contentFingerprint({ title: t.title, purpose: t.purpose, trigger: t.trigger, steps: t.steps, success_metric: t.success_metric, escalation: t.escalation, approvals: t.approvals, dept: d.dept, owner_role: d.owner_role });
}

/** the owner's answer to a proposal: accepting makes it current (the old current is closed), rejecting closes the proposal */
export function decideSopProposal(versions: SopVersion[], proposedId: string, accept: boolean, now = Date.now()): { ok: true; becomeCurrent?: string; closeCurrent?: string; reject?: string; at: string } | { ok: false; error: string } {
  const p = versions.find((v) => v.id === proposedId);
  if (!p || p.status !== "proposed") return { ok: false, error: "not_proposed" };
  const at = new Date(now).toISOString();
  if (!accept) return { ok: true, reject: p.id, at };
  const cur = versions.find((v) => v.sop_key === p.sop_key && v.status === "current");
  return { ok: true, becomeCurrent: p.id, closeCurrent: cur?.id, at };
}

export const historyOfSop = (all: SopVersion[], key: string): SopVersion[] => all.filter((v) => v.sop_key === key).sort((a, b) => b.version - a.version);

/* ------------------------------------------------------------------ the effective set (stored current, else the default) */

export interface SopView extends SopContent {
  sop_key: string;
  id: string | null;
  version: number;
  source: SopSource;
  isDefault: boolean;
  /** all-language words of the default (so a Hebrew task finds an English-saved procedure of the same key) */
  extraTerms: string;
  proposals: SopVersion[];
  valid_from: string | null;
}

function defaultView(d: DefaultSop, lang: Lang): SopView {
  const t = d.text[lang];
  return { sop_key: d.key, id: null, version: 0, source: "default", isDefault: true, title: t.title, purpose: t.purpose, trigger: t.trigger, steps: t.steps, owner_role: d.owner_role, success_metric: t.success_metric, escalation: t.escalation, approvals: t.approvals, dept: d.dept, lang, extraTerms: allLangText(d), proposals: [], valid_from: null };
}
const allLangText = (d: DefaultSop): string => (["he", "en", "ar"] as Lang[]).map((l) => `${d.text[l].title} ${d.text[l].trigger}`).join(" ");

/** one view per procedure key: the stored current version if there is one, else the built-in default in `lang`; proposals attached */
export function effectiveSops(stored: SopVersion[], lang: Lang): SopView[] {
  const byKey = new Map<string, SopVersion[]>();
  for (const v of stored) byKey.set(v.sop_key, [...(byKey.get(v.sop_key) ?? []), v]);
  const out: SopView[] = [];
  for (const d of DEFAULT_SOPS) {
    const hist = byKey.get(d.key) ?? [];
    const cur = hist.find((h) => h.status === "current");
    const proposals = hist.filter((h) => h.status === "proposed");
    out.push(cur ? { ...cur, id: cur.id, isDefault: false, extraTerms: allLangText(d), proposals, valid_from: cur.valid_from } : { ...defaultView(d, lang), proposals });
    byKey.delete(d.key);
  }
  for (const [key, hist] of byKey) {
    const cur = hist.find((h) => h.status === "current");
    const proposals = hist.filter((h) => h.status === "proposed");
    if (cur) out.push({ ...cur, id: cur.id, isDefault: false, extraTerms: "", proposals, valid_from: cur.valid_from });
    else if (proposals.length) out.push({ ...proposals[0]!, id: null, version: 0, source: "agent", isDefault: false, extraTerms: "", proposals, valid_from: null, sop_key: key });
  }
  return out;
}

/* ------------------------------------------------------------------ retrieval by relevance */

const HE_PREFIX = "הבלוכמש";
/** words with up to two Hebrew prefixes (or the Arabic "ال") also reduced, so "לליד" finds "ליד" and "المبيعات" finds "مبيعات" */
export function sopTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of tokens(text)) {
    out.add(w);
    if (/^[֐-׿]/.test(w)) {
      let x = w;
      for (let i = 0; i < 2; i++) {
        if (x.length > 3 && HE_PREFIX.includes(x[0]!)) {
          x = x.slice(1);
          out.add(x);
        } else break;
      }
    } else if (/^[؀-ۿ]/.test(w) && w.startsWith("ال") && w.length > 4) out.add(w.slice(2));
  }
  return out;
}

export interface SopHit {
  sop: SopView;
  score: number;
  matched: string[];
}

/**
 * The procedure that fits the task best (at most `max`, default 1). Needs a match on the TRIGGER or TITLE words — the steps alone
 * never select a procedure — and a minimum score, so an unrelated task gets no procedure at all (nothing is added to fill a block).
 */
export function sopFor(task: string, views: SopView[], opts: { max?: number; min?: number } = {}): SopHit[] {
  const q = sopTerms(task);
  if (!q.size) return [];
  const hits: SopHit[] = [];
  for (const v of views) {
    const key = sopTerms(`${v.title} ${v.trigger} ${v.extraTerms}`);
    const soft = sopTerms(v.purpose);
    const matched = [...q].filter((w) => key.has(w));
    if (!matched.length) continue;
    const softHits = [...q].filter((w) => !key.has(w) && soft.has(w)).length;
    const denom = Math.max(3, Math.min(q.size, 8));
    const score = (matched.length * 1 + softHits * 0.3) / denom + jaccard(q, key) * 0.5;
    hits.push({ sop: v, score, matched: matched.slice(0, 6) });
  }
  hits.sort((a, b) => b.score - a.score || a.sop.sop_key.localeCompare(b.sop.sop_key));
  return hits.filter((h) => h.score >= (opts.min ?? 0.3)).slice(0, opts.max ?? 1);
}

const SRC: Record<SopSource, Record<Lang, string>> = {
  default: { he: "ברירת מחדל", en: "default", ar: "افتراضي" },
  owner: { he: "הבעלים", en: "owner", ar: "المالك" },
  agent: { he: "עובד", en: "employee", ar: "موظف" },
};
export const sopSourceLabel = (s: SopSource, l: Lang) => SRC[s][l];

/** the procedure block of the employee's prompt — its own block, never mixed with the facts */
export function sopPrompt(hits: SopHit[], opts: { raci?: { R?: string; A?: string; C?: string[]; I?: string[] } | null } = {}): string {
  if (!hits.length) return "";
  const blocks = hits.map((h) => {
    const s = h.sop;
    const lines = [
      `[${s.title} — ${s.isDefault ? "default" : `v${s.version}`}${s.source === "owner" ? ", set by the owner" : ""}]`,
      s.purpose ? `Purpose: ${s.purpose}` : "",
      `Steps: ${s.steps.map((x, i) => `${i + 1}) ${x}`).join(" ")}`,
      s.success_metric ? `Success measure: ${s.success_metric}` : "",
      s.escalation ? `Escalate when: ${s.escalation}` : "",
      s.approvals.length ? `Needs the owner's approval: ${s.approvals.join("; ")}` : "",
    ];
    const r = opts.raci;
    if (r) lines.push(`Responsibility: ${[r.R ? `does it: ${r.R}` : "", r.A ? `approves: ${r.A}` : "", r.C?.length ? `consult: ${r.C.join(", ")}` : "", r.I?.length ? `inform: ${r.I.join(", ")}` : ""].filter(Boolean).join("; ")}`);
    return lines.filter(Boolean).join("\n");
  });
  return `Company procedure for this kind of task (follow it. It does NOT replace the approval rules: anything a customer sees, money or irreversible still waits for the owner's approval; if the procedure does not fit the case, say so instead of forcing it):\n${blocks.join("\n\n")}`;
}

/* ------------------------------------------------------------------ outcome line (business language) */

export type SopOutcome = { kind: "created"; title: string; version: number } | { kind: "changed"; title: string; version: number } | { kind: "proposed"; title: string } | { kind: "accepted"; title: string } | { kind: "rejected"; title: string } | { kind: "same"; title: string };

export function sopLine(o: SopOutcome, l: Lang): string {
  const t = o.title;
  const v = "version" in o ? o.version : 0;
  switch (o.kind) {
    case "created":
      return { he: `נהלים: "${t}" נשמר (גרסה ${v})`, en: `Procedure "${t}" saved (version ${v})`, ar: `الإجراء "${t}" حُفظ (النسخة ${v})` }[l];
    case "changed":
      return { he: `נהלים: "${t}" עודכן לגרסה ${v}`, en: `Procedure "${t}" updated to version ${v}`, ar: `الإجراء "${t}" حُدّث إلى النسخة ${v}` }[l];
    case "proposed":
      return { he: `נהלים: שינוי ב"${t}" ממתין לאישור הבעלים`, en: `A change to "${t}" is waiting for the owner`, ar: `تعديل على "${t}" بانتظار موافقة المالك` }[l];
    case "accepted":
      return { he: `נהלים: השינוי ב"${t}" אושר`, en: `The change to "${t}" was approved`, ar: `تمت الموافقة على التعديل في "${t}"` }[l];
    case "rejected":
      return { he: `נהלים: השינוי ב"${t}" נדחה`, en: `The change to "${t}" was rejected`, ar: `تم رفض التعديل في "${t}"` }[l];
    default:
      return { he: `נהלים: אין שינוי ב"${t}"`, en: `No change to "${t}"`, ar: `لا تغيير في "${t}"` }[l];
  }
}

/** roles allowed to PROPOSE a change: the manager and the team lead (department heads are added by the server by head lookup) */
export const SOP_PROPOSER_ROLES = ["manager", "team_lead"];
