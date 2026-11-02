/**
 * The digital team — practical abilities (pure, unit-tested): role work templates, SLA tracking, quiet hours,
 * duplicate-task removal, a full handoff package to a person, digest reports, smarter contact search and the
 * fallback ladder for planning a week of posts.
 */

/* ------------------------------------------------------------------ work templates */

export interface WorkTemplate {
  id: string;
  role: string;
  /** the brief given to the employee (internal prompt, English) */
  brief: string;
}

export const WORK_TEMPLATES: WorkTemplate[] = [
  { id: "cs_followup_open", role: "customer_service", brief: "Go over open conversations that have no reply for more than 24 hours and draft short, polite follow-ups. Do not send anything without approval." },
  { id: "cs_complaints", role: "customer_service", brief: "Find recent unhappy customers, summarise each case in two lines, propose a resolution and flag the ones that need the owner." },
  { id: "sales_stale_leads", role: "sales", brief: "Find leads with no contact for 7+ days, rank them by likelihood to close and draft a personal follow-up for the top five." },
  { id: "sales_pipeline_review", role: "sales", brief: "Review open deals: what is stuck, why, and the one next action for each. Report the three most valuable deals first." },
  { id: "marketing_week_plan", role: "marketing", brief: "Plan next week's content: one clear goal, the posts, and what to measure. Use only facts the business stated." },
  { id: "marketing_campaign_check", role: "marketing", brief: "Check the running campaigns: results, what to stop, what to scale, one experiment for next week." },
  { id: "collections_overdue", role: "collections", brief: "List overdue invoices by amount and age, propose a reminder tone for each customer and flag any that need a call." },
  { id: "analyst_weekly", role: "analyst", brief: "Produce a short weekly business report: leads, deals, revenue, response times, three insights and one recommendation." },
  { id: "reputation_reviews", role: "reputation", brief: "Go over new reviews, draft replies (thank / apologise / invite offline) and flag any review that needs the owner." },
  { id: "manager_daily_brief", role: "manager", brief: "Write the owner's morning brief: what needs a decision today, what moved, what is at risk. At most 8 lines." },
];

export function templatesForRole(role: string): WorkTemplate[] {
  return WORK_TEMPLATES.filter((t) => t.role === role);
}

/* ------------------------------------------------------------------ SLA */

export interface SlaStatus {
  state: "ok" | "warning" | "breached" | "answered";
  minutes: number;
  targetMin: number;
}

/** first-response time against a target (default 60 minutes); warning at 75% of the target */
export function slaStatus(input: { receivedAt: string | number; firstReplyAt?: string | number | null; now: number; targetMin?: number }): SlaStatus {
  const target = input.targetMin ?? 60;
  const t0 = typeof input.receivedAt === "number" ? input.receivedAt : Date.parse(input.receivedAt);
  const t1 = input.firstReplyAt == null ? null : typeof input.firstReplyAt === "number" ? input.firstReplyAt : Date.parse(input.firstReplyAt);
  const minutes = Math.max(0, Math.round(((t1 ?? input.now) - t0) / 60_000));
  if (t1 !== null) return { state: minutes <= target ? "answered" : "breached", minutes, targetMin: target };
  return { state: minutes > target ? "breached" : minutes >= target * 0.75 ? "warning" : "ok", minutes, targetMin: target };
}

export function slaSummary(rows: SlaStatus[]): { total: number; breached: number; warning: number; avgMinutes: number } {
  const avg = rows.length ? rows.reduce((a, r) => a + r.minutes, 0) / rows.length : 0;
  return { total: rows.length, breached: rows.filter((r) => r.state === "breached").length, warning: rows.filter((r) => r.state === "warning").length, avgMinutes: Math.round(avg) };
}

/* ------------------------------------------------------------------ quiet hours */

function hourIn(tz: string, now: number): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(now));
    return Number(h) % 24;
  } catch {
    return new Date(now).getUTCHours();
  }
}

/** quiet hours may wrap midnight (22 → 7). Customer-facing sends wait; internal work continues. */
export function isQuietHour(now: number, tz: string, startHour = 22, endHour = 7): boolean {
  if (startHour === endHour) return false;
  const h = hourIn(tz, now);
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

/* ------------------------------------------------------------------ duplicates */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** an open task that already exists for the same employee with (almost) the same title */
export function findDuplicateTask(next: { role: string; title: string }, open: { id: string; role: string; title: string }[]): string | null {
  const t = norm(next.title);
  if (!t) return null;
  const words = new Set(t.split(" "));
  for (const o of open) {
    if (o.role !== next.role) continue;
    const ot = norm(o.title);
    if (ot === t) return o.id;
    const ow = new Set(ot.split(" "));
    let inter = 0;
    for (const w of words) if (ow.has(w)) inter++;
    const sim = inter / (words.size + ow.size - inter);
    if (words.size >= 3 && sim >= 0.8) return o.id;
  }
  return null;
}

/* ------------------------------------------------------------------ handoff to a person */

export function handoffPackage(input: { reason: string; taskTitle: string; understanding?: string; contact?: string; lastMessages?: string[]; memories?: string[]; tried?: string[]; recommended?: string }): string {
  const lines = [
    `Reason for handing over: ${input.reason.replace(/_/g, " ")}`,
    `Task: ${input.taskTitle}`,
    input.understanding ? `Understanding: ${input.understanding}` : "",
    input.contact ? `Customer: ${input.contact}` : "",
    input.lastMessages?.length ? `Last messages:\n${input.lastMessages.slice(-5).map((m) => `  - ${m.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}` : "",
    input.memories?.length ? `Known about them:\n${input.memories.slice(0, 5).map((m) => `  - ${m.slice(0, 160)}`).join("\n")}` : "",
    input.tried?.length ? `Already done:\n${input.tried.slice(0, 6).map((m) => `  - ${m.slice(0, 160)}`).join("\n")}` : "",
    input.recommended ? `Recommended next step: ${input.recommended}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ digest */

export interface DigestFacts {
  period: "day" | "week";
  tasksDone: number;
  tasksFailed: number;
  pendingApprovals: number;
  slaBreached: number;
  avgResponseMin: number;
  learnings: number;
  health: "ok" | "degraded" | "down";
}

const DIGEST_TEXT = {
  he: { day: "דוח בוקר של הצוות", week: "דוח שבועי של הצוות", done: "משימות שהושלמו", failed: "משימות שנכשלו", approvals: "ממתינים לאישורך", sla: "חריגות זמן תגובה", avg: "זמן תגובה ממוצע (דקות)", learn: "לקחים חדשים", health: { ok: "הצוות תקין", degraded: "יש בעיות קטנות בצוות", down: "הצוות לא פעיל" } },
  en: { day: "Team morning report", week: "Team weekly report", done: "Tasks completed", failed: "Tasks failed", approvals: "Waiting for your approval", sla: "Response-time breaches", avg: "Average response time (min)", learn: "New lessons", health: { ok: "Team is healthy", degraded: "Minor team issues", down: "Team is not running" } },
  ar: { day: "تقرير الفريق الصباحي", week: "التقرير الأسبوعي للفريق", done: "مهام مكتملة", failed: "مهام فاشلة", approvals: "بانتظار موافقتك", sla: "تجاوزات زمن الرد", avg: "متوسط زمن الرد (دقائق)", learn: "دروس جديدة", health: { ok: "الفريق سليم", degraded: "مشاكل بسيطة في الفريق", down: "الفريق متوقف" } },
} as const;

/** a short management digest, plain text (the owner reads it in the activity feed or e-mail) */
export function renderDigest(f: DigestFacts, lang: "he" | "en" | "ar"): string {
  const t = DIGEST_TEXT[lang];
  return [`${f.period === "day" ? t.day : t.week}`, t.health[f.health], `• ${t.done}: ${f.tasksDone}`, `• ${t.failed}: ${f.tasksFailed}`, `• ${t.approvals}: ${f.pendingApprovals}`, `• ${t.sla}: ${f.slaBreached}`, `• ${t.avg}: ${f.avgResponseMin}`, `• ${t.learn}: ${f.learnings}`].join("\n");
}

/* ------------------------------------------------------------------ smarter contact search */

const FILLER = new Set("lead leads customer customers client clients contact contacts person people find search show the a an of לקוח לקוחות ליד לידים איש אנשי קשר חפש מצא תמצא את של عميل عملاء".split(" "));
const STATUS_WORDS: Record<string, string> = { lead: "lead", leads: "lead", ליד: "lead", לידים: "lead", customer: "customer", customers: "customer", לקוח: "customer", לקוחות: "customer" };

export interface ContactQuery {
  tokens: string[];
  status: string | null;
}

/** "Dana Levi" → tokens [dana, levi]; "new leads" → status lead; a full name matches first AND last name separately */
export function smartContactQuery(q: string): ContactQuery {
  const parts = String(q ?? "").replace(/[%,()*]/g, " ").toLowerCase().split(/\s+/).filter(Boolean);
  let status: string | null = null;
  for (const p of parts) if (STATUS_WORDS[p]) status = STATUS_WORDS[p]!;
  const tokens = parts.filter((p) => p.length >= 2 && !FILLER.has(p) && !/^(new|חדשים|חדש|recent|אחרונים)$/.test(p)).slice(0, 4);
  return { tokens, status };
}

/** PostgREST `or` filter for ONE token across the searchable columns */
export function orFilterFor(token: string): string {
  const t = token.replace(/[%,()*]/g, " ").trim().slice(0, 40);
  return ["first_name", "last_name", "email", "phone", "company_name"].map((c) => `${c}.ilike.%${t}%`).join(",");
}

/* ------------------------------------------------------------------ plan_week fallback ladder */

/** how many posts to ask for on each attempt: the full week, then a smaller batch, then one at a time */
export function planWeekLadder(requested: number): number[] {
  const n = Math.max(1, Math.min(7, Math.round(requested) || 7));
  return [...new Set([n, Math.min(n, 3), 1])];
}

/** only an unreadable / empty AI answer is worth another (smaller) attempt */
export function planWeekRetryable(error: string | null | undefined): boolean {
  return /ai\.failed|ai_failed|unreadable|parse|json/i.test(error ?? "");
}
