/**
 * The digital team — initiative, metrics, weekly team meeting and the business profile (pure, unit-tested).
 */
import type { RoleKey } from "./roles";

/* ------------------------------------------------------------------ controlled initiative */

export interface Signals {
  newLeadsUncontacted: number;
  negativeReviewsOpen: number;
  unansweredConversations: number;
  stuckDeals: number;
  overdueInvoices: number;
  leadsYesterday: number;
  leadsAvg: number;
  daysSinceLastPost: number | null;
}

export interface Proposal {
  key: string;
  role: RoleKey;
  title: string;
  brief: string;
  priority: number;
}

/** opportunities / problems an employee should act on — one per kind per day (key dedupes) */
export function initiatives(s: Signals, day: string): Proposal[] {
  const out: Proposal[] = [];
  if (s.newLeadsUncontacted > 0) out.push({ key: `leads:${day}`, role: "sales", priority: 1, title: `Reach ${s.newLeadsUncontacted} new lead(s) that got no reply`, brief: "Find the new leads (last 24h) with no outgoing message, qualify each and prepare a personal first message for approval." });
  if (s.negativeReviewsOpen > 0) out.push({ key: `reviews:${day}`, role: "reputation", priority: 1, title: `Answer ${s.negativeReviewsOpen} negative review(s)`, brief: "Read the unanswered reviews with 1–3 stars and draft a professional reply for each (draft only), plus a task for the owner." });
  if (s.unansweredConversations > 0) out.push({ key: `inbox:${day}`, role: "customer_service", priority: 1, title: `${s.unansweredConversations} conversation(s) waiting for an answer`, brief: "Find conversations where the customer is waiting, understand each and prepare an accurate answer for approval; escalate what needs a person." });
  if (s.stuckDeals > 0) out.push({ key: `deals:${day}`, role: "sales", priority: 2, title: `Revive ${s.stuckDeals} stuck deal(s)`, brief: "Review the deals with no activity for 7+ days, decide the next step for each and create tasks / follow-up drafts." });
  if (s.overdueInvoices > 0) out.push({ key: `invoices:${day}`, role: "collections", priority: 2, title: `${s.overdueInvoices} overdue invoice(s)`, brief: "Check the overdue invoices and prepare polite reminders with the payment link for approval." });
  if (s.leadsAvg >= 3 && s.leadsYesterday < s.leadsAvg * 0.5) out.push({ key: `drop:${day}`, role: "analyst", priority: 2, title: "Leads dropped sharply — find out why", brief: `Yesterday ${s.leadsYesterday} leads vs. an average of ${s.leadsAvg}. Check sources, posts and channels; separate facts from assumptions and recommend 1–3 actions.` });
  if (s.daysSinceLastPost !== null && s.daysSinceLastPost >= 5) out.push({ key: `posts:${day}`, role: "marketing", priority: 3, title: `No post for ${s.daysSinceLastPost} days`, brief: "Prepare the next post draft from the content pillars and what worked before." });
  return out;
}

/* ------------------------------------------------------------------ metrics per employee */

export interface MemberStats {
  done: number;
  failed: number;
  approvedClean: number;
  edited: number;
  rejected: number;
  escalations: number;
  avgMinutes: number | null;
  credits: number;
  approvalRate: number | null;
  rejectionRate: number | null;
}

export function memberStats(input: {
  tasks: { status: string; credits_used: number; started_at: string | null; finished_at: string | null; question?: string | null }[];
  approvals: { status: string; edited: boolean }[];
}): MemberStats {
  const done = input.tasks.filter((t) => t.status === "done").length;
  const failed = input.tasks.filter((t) => t.status === "failed").length;
  const durations = input.tasks.filter((t) => t.started_at && t.finished_at).map((t) => (Date.parse(t.finished_at!) - Date.parse(t.started_at!)) / 60_000).filter((x) => x >= 0);
  const decided = input.approvals.filter((a) => ["approved", "edited", "rejected", "executed", "failed"].includes(a.status));
  const approvedClean = decided.filter((a) => (a.status === "approved" || a.status === "executed") && !a.edited).length;
  const edited = decided.filter((a) => a.edited || a.status === "edited").length;
  const rejected = decided.filter((a) => a.status === "rejected").length;
  return {
    done,
    failed,
    approvedClean,
    edited,
    rejected,
    escalations: input.tasks.filter((t) => (t.question ?? "").startsWith("escalate:")).length,
    avgMinutes: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
    credits: input.tasks.reduce((a, t) => a + (t.credits_used || 0), 0),
    approvalRate: decided.length ? Math.round((approvedClean / decided.length) * 100) : null,
    rejectionRate: decided.length ? Math.round((rejected / decided.length) * 100) : null,
  };
}

/* ------------------------------------------------------------------ weekly team meeting */

export interface MeetingInput {
  members: { id: string; name: string; role: string }[];
  stats: Record<string, MemberStats>;
  learnings: { content: string; member_id: string | null; status: string }[];
  pendingApprovals: number;
  blocked: number;
}

/** the meeting's facts (pure) — the manager may phrase it, but these numbers are the source */
export function meetingFacts(m: MeetingInput): { done: number; credits: number; topMember: string | null; weakMember: string | null; learnings: number; recommendations: string[] } {
  const rows = m.members.map((x) => ({ x, s: m.stats[x.id] }));
  const done = rows.reduce((a, r) => a + (r.s?.done ?? 0), 0);
  const credits = rows.reduce((a, r) => a + (r.s?.credits ?? 0), 0);
  const ranked = rows.filter((r) => r.s && r.s.done + r.s.failed > 0).sort((a, b) => (b.s!.done - b.s!.failed) - (a.s!.done - a.s!.failed));
  const recs: string[] = [];
  for (const r of rows) {
    if (!r.s) continue;
    if (r.s.rejectionRate !== null && r.s.rejectionRate >= 40) recs.push(`rejections:${r.x.id}`);
    if (r.s.approvalRate !== null && r.s.approvalRate >= 90 && r.s.approvedClean >= 5) recs.push(`autonomy:${r.x.id}`);
    if (r.s.failed >= 3) recs.push(`failures:${r.x.id}`);
  }
  if (m.pendingApprovals >= 10) recs.push("approvals:backlog");
  if (m.blocked > 0) recs.push("blocked:tasks");
  return { done, credits, topMember: ranked[0]?.x.name ?? null, weakMember: ranked.length > 1 ? ranked[ranked.length - 1]!.x.name : null, learnings: m.learnings.length, recommendations: recs.slice(0, 6) };
}

/* ------------------------------------------------------------------ the live business profile */

export interface ProfileFacts {
  name: string;
  locale: string;
  timezone: string;
  currency: string;
  about: string;
  audience: string;
  tone: string;
  products: { name: string; price: number; description: string }[];
  faq: { q: string; a: string }[];
  policies: string[];
  hours: string;
  competitors: string;
  goals: string;
  numbers: { contacts: number; openDeals: number; pipelineValue: number; conversations30: number; reviewsAvg: number | null; reviewsCount: number; posts30: number; sites: string[] };
  topQuestions: string[];
}

export function profilePrompt(p: ProfileFacts): string {
  const lines = [
    `Name: ${p.name} · language ${p.locale} · time zone ${p.timezone} · currency ${p.currency}`,
    p.about ? `About (from the business): ${p.about.slice(0, 2500)}` : "",
    p.audience ? `Target audience: ${p.audience}` : "",
    p.tone ? `Brand voice: ${p.tone}` : "",
    p.hours ? `Business hours: ${p.hours}` : "",
    p.products.length ? `Products / services (exact prices):\n${p.products.slice(0, 15).map((x) => `  • ${x.name}${x.price > 0 ? ` — ${x.price} ${p.currency}` : ""}${x.description ? ` — ${x.description.slice(0, 140)}` : ""}`).join("\n")}` : "Products / services: not listed — never state prices.",
    p.policies.length ? `Policies: ${p.policies.join(" | ").slice(0, 1500)}` : "",
    p.faq.length ? `FAQ:\n${p.faq.slice(0, 8).map((f) => `  Q: ${f.q.slice(0, 160)}\n  A: ${f.a.slice(0, 300)}`).join("\n")}` : "",
    p.competitors ? `Competitors: ${p.competitors}` : "",
    p.goals ? `Goals: ${p.goals}` : "",
    `Live numbers: ${p.numbers.contacts} contacts · ${p.numbers.openDeals} open deals (${p.numbers.pipelineValue} ${p.currency}) · ${p.numbers.conversations30} conversations in 30 days · reviews ${p.numbers.reviewsAvg ?? "—"}★ (${p.numbers.reviewsCount}) · ${p.numbers.posts30} posts in 30 days${p.numbers.sites.length ? ` · sites: ${p.numbers.sites.join(", ")}` : ""}`,
    p.topQuestions.length ? `What customers ask most lately: ${p.topQuestions.slice(0, 5).map((q) => `"${q}"`).join(", ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** the text the invented-price check compares against (every number the business stated) */
export function knownFacts(p: ProfileFacts): string {
  return [p.about, ...p.products.map((x) => `${x.name} ${x.price} ${x.description}`), ...p.faq.map((f) => `${f.q} ${f.a}`), ...p.policies].join("\n");
}
