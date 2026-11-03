/**
 * Upgrade 7 / stage G — team coordination (pure): a shared board, schema-checked handoff contracts, arbitration between employees
 * (the owner's confirmed facts always win), an escalation ladder, a short daily stand-up, and load balancing with specialization.
 */
export type Lang = "he" | "en" | "ar";

/* ------------------------------------------------------------------------ handoff contract */
export interface HandoffContract {
  from_role: string;
  to_role: string;
  title: string;
  /** what must exist when the work is done */
  deliverable: string;
  /** checks the receiver (and the reviewer) can verify */
  acceptance: string[];
  /** facts / ids the receiver needs (never secrets) */
  inputs: string[];
  due_iso?: string;
}
const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
export function validateHandoff(raw: Record<string, unknown>, roles: string[]): { ok: true; contract: HandoffContract } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const from = s(raw.from_role, 40);
  const to = s(raw.to_role, 40);
  if (!roles.includes(to)) errors.push("unknown_to_role");
  if (!from) errors.push("missing_from_role");
  if (from && from === to) errors.push("handoff_to_self");
  const title = s(raw.title, 200);
  if (title.length < 3) errors.push("missing_title");
  const deliverable = s(raw.deliverable, 400);
  if (deliverable.length < 5) errors.push("missing_deliverable");
  const acceptance = (Array.isArray(raw.acceptance) ? raw.acceptance : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 6);
  if (!acceptance.length) errors.push("missing_acceptance");
  const inputs = (Array.isArray(raw.inputs) ? raw.inputs : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 8);
  if (inputs.some((i) => /(sk_live|api[_-]?key|password|סיסמה)/i.test(i))) errors.push("secret_in_inputs");
  const due = typeof raw.due_iso === "string" && !Number.isNaN(Date.parse(raw.due_iso)) ? raw.due_iso : undefined;
  return errors.length ? { ok: false, errors } : { ok: true, contract: { from_role: from, to_role: to, title, deliverable, acceptance, inputs, due_iso: due } };
}
/** the receiver's brief, built from the contract (so nothing is lost in the handoff) */
export function contractBrief(c: HandoffContract): string {
  return [`Handoff from ${c.from_role}: ${c.title}`, `Deliverable: ${c.deliverable}`, `Acceptance criteria:\n${c.acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n")}`, c.inputs.length ? `Inputs: ${c.inputs.join("; ")}` : "", c.due_iso ? `Due: ${c.due_iso}` : ""].filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------------ arbitration */
export type ClaimSource = "owner_confirmed" | "unconfirmed_fact" | "employee";
export interface Claim {
  member: string;
  role: string;
  subject: string;
  value: string;
  source: ClaimSource;
  confidence: number;
  at: number;
}
const RANK: Record<ClaimSource, number> = { owner_confirmed: 3, unconfirmed_fact: 2, employee: 1 };
/** who is the authority on which subject (a tie-breaker AFTER the source) */
const AUTHORITY: Record<string, string[]> = { price: ["sales", "manager"], hours: ["customer_service", "manager"], policy: ["manager", "quality_control"], offer: ["marketing", "sales"], contact: ["customer_service"] };
export interface Arbitration {
  winner: Claim | null;
  needsOwner: boolean;
  reason: "single" | "owner_confirmed" | "source" | "authority" | "confidence" | "recency" | "unresolved";
}
export function arbitrate(claims: Claim[], kind = "other"): Arbitration {
  const distinct = new Map<string, Claim[]>();
  for (const c of claims) distinct.set(c.value.trim().toLowerCase(), [...(distinct.get(c.value.trim().toLowerCase()) ?? []), c]);
  if (!claims.length) return { winner: null, needsOwner: false, reason: "single" };
  if (distinct.size === 1) return { winner: claims[0]!, needsOwner: false, reason: "single" };
  const owner = claims.filter((c) => c.source === "owner_confirmed");
  if (new Set(owner.map((c) => c.value.trim().toLowerCase())).size === 1) return { winner: owner[0]!, needsOwner: false, reason: "owner_confirmed" };
  if (owner.length) return { winner: null, needsOwner: true, reason: "unresolved" };
  const top = Math.max(...claims.map((c) => RANK[c.source]));
  let pool = claims.filter((c) => RANK[c.source] === top);
  if (new Set(pool.map((c) => c.value.trim().toLowerCase())).size === 1) return { winner: pool[0]!, needsOwner: false, reason: "source" };
  const auth = AUTHORITY[kind] ?? [];
  const byAuth = pool.filter((c) => auth.includes(c.role));
  if (byAuth.length && new Set(byAuth.map((c) => c.value.trim().toLowerCase())).size === 1 && byAuth.length < pool.length) return { winner: byAuth[0]!, needsOwner: false, reason: "authority" };
  if (byAuth.length) pool = byAuth;
  const sorted = [...pool].sort((a, b) => b.confidence - a.confidence);
  if (sorted[0]!.confidence - sorted[1]!.confidence >= 0.2) return { winner: sorted[0]!, needsOwner: false, reason: "confidence" };
  const byTime = [...pool].sort((a, b) => b.at - a.at);
  if (byTime[0]!.at - byTime[1]!.at >= 24 * 3_600_000 && Math.abs(byTime[0]!.confidence - byTime[1]!.confidence) < 0.2) return { winner: byTime[0]!, needsOwner: false, reason: "recency" };
  return { winner: null, needsOwner: true, reason: "unresolved" };
}

/* ------------------------------------------------------------------------ escalation ladder */
export const LADDER = ["self_retry", "peer_help", "team_lead", "manager", "owner"] as const;
export type Rung = (typeof LADDER)[number];
export function nextEscalation(i: { attempts: number; ageHours: number; severity: "low" | "medium" | "high"; current?: Rung }): Rung {
  let idx = i.current ? LADDER.indexOf(i.current) : -1;
  const want = i.severity === "high" ? 3 : i.severity === "medium" ? 2 : 1;
  const byAge = i.ageHours >= 48 ? 4 : i.ageHours >= 24 ? 3 : i.ageHours >= 8 ? 2 : i.ageHours >= 2 ? 1 : 0;
  const byTries = i.attempts >= 4 ? 4 : i.attempts >= 3 ? 3 : i.attempts >= 2 ? 2 : i.attempts >= 1 ? 1 : 0;
  const target = Math.max(i.attempts > 0 || i.ageHours >= 2 ? want : 0, byAge, byTries);
  idx = Math.max(idx + (i.current ? 1 : 0), target);
  if (i.severity === "high" && i.attempts >= 1) idx = Math.max(idx, 3);
  return LADDER[Math.min(LADDER.length - 1, idx)]!;
}

/* ------------------------------------------------------------------------ board + stand-up */
export interface BoardItem {
  id: string;
  title: string;
  member: string;
  status: "pending" | "in_progress" | "awaiting_approval" | "awaiting_input" | "blocked" | "done" | "failed";
  kind?: "task" | "blocker" | "finding" | "request" | "status";
  updated_at: number;
}
export function standup(items: BoardItem[], names: Record<string, string>, now: number, lang: Lang = "he", windowHours = 24): { lines: string[]; blocked: number; done: number; doing: number } {
  const since = now - windowHours * 3_600_000;
  const by = new Map<string, { done: string[]; doing: string[]; blocked: string[] }>();
  for (const it of items) {
    const e = by.get(it.member) ?? { done: [], doing: [], blocked: [] };
    if (it.status === "done" && it.updated_at >= since) e.done.push(it.title);
    else if (["in_progress", "pending"].includes(it.status) && it.kind !== "finding") e.doing.push(it.title);
    else if (["blocked", "failed", "awaiting_input", "awaiting_approval"].includes(it.status) || it.kind === "blocker") e.blocked.push(it.title);
    by.set(it.member, e);
  }
  const L = { he: ["סיים", "עובד על", "תקוע / ממתין"], en: ["Done", "Working on", "Blocked / waiting"], ar: ["أنجز", "يعمل على", "متوقف / ينتظر"] }[lang];
  const lines: string[] = [];
  let done = 0, doing = 0, blocked = 0;
  for (const [m, e] of by) {
    done += e.done.length; doing += e.doing.length; blocked += e.blocked.length;
    const parts = [e.done.length ? `${L[0]}: ${e.done.slice(0, 2).join("; ")}` : "", e.doing.length ? `${L[1]}: ${e.doing.slice(0, 2).join("; ")}` : "", e.blocked.length ? `${L[2]}: ${e.blocked.slice(0, 2).join("; ")}` : ""].filter(Boolean);
    if (parts.length) lines.push(`${names[m] ?? m} — ${parts.join(" | ")}`);
  }
  return { lines: lines.slice(0, 12), blocked, done, doing };
}

/* ------------------------------------------------------------------------ load balancing and specialization */
export interface Candidate {
  id: string;
  role: string;
  status: string;
  load: number;
  /** per-tag success history: tag → { done, failed } */
  history?: Record<string, { done: number; failed: number }>;
}
/** score = role fit + proven specialization − load penalty; never a paused employee */
export function pickAssignee(task: { role: string; tags?: string[] }, cands: Candidate[], opts: { maxLoad?: number } = {}): { id: string; score: number } | null {
  const max = opts.maxLoad ?? 8;
  const scored = cands
    .filter((c) => c.status === "active" && c.load < max)
    .map((c) => {
      const fit = c.role === task.role ? 10 : c.role === "team_lead" || c.role === "manager" ? 3 : 0;
      let spec = 0;
      for (const t of task.tags ?? []) {
        const h = c.history?.[t];
        if (h && h.done + h.failed >= 3) spec += 4 * ((h.done + 1) / (h.done + h.failed + 2) - 0.5);
      }
      return { id: c.id, score: Math.round((fit + spec - c.load * 1.5) * 100) / 100, fit };
    })
    .filter((c) => c.fit > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored[0] ? { id: scored[0].id, score: scored[0].score } : null;
}
