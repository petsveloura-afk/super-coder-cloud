/**
 * Upgrade 8 / stage B1 — department structure (pure, unit-tested).
 *
 * Every business gets six default departments: sales, marketing, customer service, operations, finance, management. Each has a
 * name in three languages, a head (an existing employee), a member list, metrics, a credit budget and at most one active goal.
 * Employees are placed in a department automatically by their role; a MANUAL placement is kept and never overwritten.
 * A department's credit budget is honoured IN ADDITION to the existing daily cap (the tighter of the two wins) — never instead of it.
 */
export type Lang = "he" | "en" | "ar";

export const DEPT_KEYS = ["sales", "marketing", "service", "operations", "finance", "management"] as const;
export type DeptKey = (typeof DEPT_KEYS)[number];
export const isDeptKey = (v: unknown): v is DeptKey => typeof v === "string" && (DEPT_KEYS as readonly string[]).includes(v);

export interface DeptDef {
  key: DeptKey;
  name: Record<Lang, string>;
  /** business metrics the department is measured by (keys of reports-core METRIC_LABEL) */
  metrics: string[];
  /** goal metrics (goals-core) that belong to the department */
  goalMetrics: string[];
  /** roles that may lead it when nobody was picked, best first */
  headRoles: string[];
}

export const DEFAULT_DEPTS: DeptDef[] = [
  { key: "sales", name: { he: "מכירות", en: "Sales", ar: "المبيعات" }, metrics: ["leads", "deals_won", "revenue"], goalMetrics: ["deals_won", "revenue_won", "leads_new"], headRoles: ["sales"] },
  { key: "marketing", name: { he: "שיווק", en: "Marketing", ar: "التسويق" }, metrics: ["leads", "conversations"], goalMetrics: ["leads_new"], headRoles: ["marketing", "content_writer", "web_builder"] },
  { key: "service", name: { he: "שירות לקוחות", en: "Customer service", ar: "خدمة العملاء" }, metrics: ["conversations", "reply_minutes", "reviews_avg"], goalMetrics: ["reply_minutes", "reviews_avg", "conversations"], headRoles: ["customer_service", "reputation"] },
  { key: "operations", name: { he: "תפעול", en: "Operations", ar: "العمليات" }, metrics: ["conversations"], goalMetrics: [], headRoles: ["project_coordinator", "quality_control", "analyst"] },
  { key: "finance", name: { he: "כספים", en: "Finance", ar: "المالية" }, metrics: ["revenue"], goalMetrics: ["revenue_won"], headRoles: ["collections"] },
  { key: "management", name: { he: "ניהול", en: "Management", ar: "الإدارة" }, metrics: ["deals_won", "revenue"], goalMetrics: [], headRoles: ["manager", "team_lead"] },
];

export const DEPT_MAP: Record<DeptKey, DeptDef> = Object.fromEntries(DEFAULT_DEPTS.map((d) => [d.key, d])) as Record<DeptKey, DeptDef>;

/** the automatic placement of a role (extendable; an unknown / custom role goes to operations) */
export const ROLE_TO_DEPT: Record<string, DeptKey> = {
  manager: "management",
  team_lead: "management",
  customer_service: "service",
  reputation: "service",
  sales: "sales",
  marketing: "marketing",
  content_writer: "marketing",
  web_builder: "marketing",
  analyst: "operations",
  project_coordinator: "operations",
  quality_control: "operations",
  collections: "finance",
  custom: "operations",
};

export function deptForRole(role: string | null | undefined): DeptKey {
  return ROLE_TO_DEPT[String(role ?? "")] ?? "operations";
}

export const deptName = (k: DeptKey, l: Lang): string => DEPT_MAP[k]?.name[l] ?? k;

/* ------------------------------------------------------------------ placement */

export interface MemberLite {
  id: string;
  role_key: string;
  name?: string;
  status?: string;
  position?: number;
}
export interface Placement {
  member_id: string;
  dept_key: DeptKey;
  /** true = the owner placed this person; automatic runs never touch it */
  manual: boolean;
}

/**
 * The placement of every employee: a manual one is kept as it is; everybody else follows the role mapping. Returns the full list
 * (existing manual rows first untouched) and the rows that are new or changed so the server writes only those.
 */
export function placeMembers(members: MemberLite[], existing: Placement[]): { all: Placement[]; toWrite: Placement[] } {
  const byMember = new Map(existing.map((p) => [p.member_id, p]));
  const all: Placement[] = [];
  const toWrite: Placement[] = [];
  for (const m of members) {
    const cur = byMember.get(m.id);
    if (cur?.manual && isDeptKey(cur.dept_key)) {
      all.push(cur);
      continue;
    }
    const want = deptForRole(m.role_key);
    const next: Placement = { member_id: m.id, dept_key: want, manual: false };
    all.push(next);
    if (!cur || cur.dept_key !== want) toWrite.push(next);
  }
  return { all, toWrite };
}

/** the owner moves an employee by hand */
export function manualPlacement(memberId: string, dept: string): Placement | null {
  return isDeptKey(dept) ? { member_id: memberId, dept_key: dept, manual: true } : null;
}

/* ------------------------------------------------------------------ the head of a department */

/**
 * The head: the one the owner picked if still in the department and active; otherwise the best-fitting active employee by
 * `headRoles` order, then the lowest position. Management is led by the manager. null when the department is empty.
 */
export function headOf(dept: DeptKey, members: MemberLite[], placements: Placement[], pickedId?: string | null): MemberLite | null {
  const inDept = members.filter((m) => placements.find((p) => p.member_id === m.id)?.dept_key === dept && m.status !== "paused");
  if (!inDept.length) return null;
  const picked = pickedId ? inDept.find((m) => m.id === pickedId) : undefined;
  if (picked) return picked;
  const order = DEPT_MAP[dept].headRoles;
  const rank = (m: MemberLite) => {
    const i = order.indexOf(m.role_key);
    return i === -1 ? 99 : i;
  };
  return [...inDept].sort((a, b) => rank(a) - rank(b) || (a.position ?? 0) - (b.position ?? 0))[0] ?? null;
}

/* ------------------------------------------------------------------ views */

export interface DeptRow {
  dept_key: DeptKey;
  head_member_id: string | null;
  /** daily credit budget for the department; 0 = no department budget */
  credit_budget: number;
}

export interface TaskLite {
  id: string;
  status: string;
  assignee_id: string | null;
  credits_used?: number;
  created_at?: string;
  finished_at?: string | null;
  updated_at?: string;
  title?: string;
  priority?: number;
}

export interface GoalLite {
  id: string;
  title: string;
  metric: string;
  status: string;
}

export interface DeptStats {
  open: number;
  working: number;
  blocked: number;
  waiting: number;
  done30: number;
  failed30: number;
  /** 0..1 of finished tasks that succeeded; null with no finished task */
  successRate: number | null;
  avgMinutes: number | null;
  credits24h: number;
  /** open tasks per active member — load */
  load: number;
}

const OPEN = new Set(["pending", "in_progress", "awaiting_approval", "awaiting_input", "blocked", "requires_connection"]);

export function deptStats(memberIds: string[], tasks: TaskLite[], now: number): DeptStats {
  const ids = new Set(memberIds);
  const mine = tasks.filter((t) => t.assignee_id && ids.has(t.assignee_id));
  const open = mine.filter((t) => OPEN.has(t.status));
  const done = mine.filter((t) => t.status === "done");
  const failed = mine.filter((t) => t.status === "failed");
  const mins = done.filter((t) => t.created_at && t.finished_at).map((t) => (Date.parse(t.finished_at!) - Date.parse(t.created_at!)) / 60_000).filter((x) => Number.isFinite(x) && x >= 0);
  return {
    open: open.length,
    working: mine.filter((t) => t.status === "in_progress").length,
    blocked: mine.filter((t) => t.status === "blocked" || t.status === "requires_connection").length,
    waiting: mine.filter((t) => t.status === "awaiting_approval" || t.status === "awaiting_input").length,
    done30: done.length,
    failed30: failed.length,
    successRate: done.length + failed.length ? done.length / (done.length + failed.length) : null,
    avgMinutes: mins.length ? Math.round(mins.reduce((s, x) => s + x, 0) / mins.length) : null,
    credits24h: mine.filter((t) => Date.parse(t.updated_at ?? t.created_at ?? "") > now - 86_400_000).reduce((s, t) => s + (t.credits_used ?? 0), 0),
    load: memberIds.length ? Math.round((open.length / memberIds.length) * 10) / 10 : 0,
  };
}

/** the one active goal that belongs to the department (by its metric); management takes any active goal nobody else owns */
export function goalForDept(dept: DeptKey, goals: GoalLite[]): GoalLite | null {
  const active = goals.filter((g) => g.status === "active");
  const own = active.find((g) => DEPT_MAP[dept].goalMetrics.includes(g.metric));
  if (own) return own;
  if (dept !== "management") return null;
  const claimed = new Set(DEFAULT_DEPTS.flatMap((d) => d.goalMetrics));
  return active.find((g) => !claimed.has(g.metric)) ?? null;
}

export interface DeptView {
  key: DeptKey;
  name: Record<Lang, string>;
  head_member_id: string | null;
  member_ids: string[];
  metrics: string[];
  credit_budget: number;
  stats: DeptStats;
  goal: GoalLite | null;
}

export function buildDepartments(input: { members: MemberLite[]; placements: Placement[]; rows: DeptRow[]; tasks: TaskLite[]; goals: GoalLite[]; now: number }): DeptView[] {
  const rowOf = new Map(input.rows.map((r) => [r.dept_key, r]));
  return DEFAULT_DEPTS.map((d) => {
    const ids = input.members.filter((m) => input.placements.find((p) => p.member_id === m.id)?.dept_key === d.key).map((m) => m.id);
    const row = rowOf.get(d.key);
    const head = headOf(d.key, input.members, input.placements, row?.head_member_id ?? null);
    return { key: d.key, name: d.name, head_member_id: head?.id ?? null, member_ids: ids, metrics: d.metrics, credit_budget: Math.max(0, Math.floor(row?.credit_budget ?? 0)), stats: deptStats(ids, input.tasks, input.now), goal: goalForDept(d.key, input.goals) };
  });
}

/* ------------------------------------------------------------------ credit budget (in addition to the daily cap) */

/**
 * The cap the engine should use for one task: the tighter of the business's daily cap and the department's budget, expressed in the
 * engine's own terms (cap + used). 0 = no cap on that side. The result never LOOSENS the existing daily cap.
 */
export function effectiveDailyCap(g: { cap: number; used: number }, d: { budget: number; used: number }): { cap: number; used: number; by: "none" | "business" | "department" } {
  const gRemain = g.cap > 0 ? Math.max(0, g.cap - g.used) : Infinity;
  const dRemain = d.budget > 0 ? Math.max(0, d.budget - d.used) : Infinity;
  if (gRemain === Infinity && dRemain === Infinity) return { cap: g.cap, used: g.used, by: "none" };
  if (dRemain < gRemain) {
    // the engine reads cap 0 as "no cap", so an exhausted budget is expressed as cap = used = at least 1
    if (dRemain === 0) {
      const at = Math.max(1, g.used);
      return { cap: at, used: at, by: "department" };
    }
    return { cap: g.used + dRemain, used: g.used, by: "department" };
  }
  return { cap: g.cap, used: g.used, by: "business" };
}

export function budgetLine(name: string, budget: number, used: number, lang: Lang): string {
  const l = {
    he: `תקציב קרדיטים למחלקת ${name}: נוצלו ${used} מתוך ${budget} היום`,
    en: `${name} department credit budget: ${used} of ${budget} used today`,
    ar: `ميزانية رصيد قسم ${name}: استُخدم ${used} من ${budget} اليوم`,
  };
  return l[lang];
}

/** a budget the owner typed: an integer 0..1,000,000 (0 = none) */
export function cleanBudget(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.floor(n);
}
