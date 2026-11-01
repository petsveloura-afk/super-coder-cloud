/**
 * The digital team — memory (pure, unit-tested).
 *
 * Three layers:
 *   working   — the current task's context (in the engine, never stored as such)
 *   episodic  — what was done, approved, rejected, corrected and why (team_memory.layer = 'episodic')
 *   semantic  — lasting facts and preferences about the business, customers and the owner (layer = 'semantic')
 * Retrieval ranks by relevance (word overlap with the task) × recency × confidence; expired / revoked / superseded
 * memories never come back. A new fact on the same subject supersedes the older one (contradiction resolution).
 * Feedback (approve / edit / reject) becomes memory — as a PROPOSED learning the owner confirms or cancels.
 */

export type Layer = "episodic" | "semantic";
export type MemKind = "fact" | "preference" | "forbidden" | "approved_style" | "rejected" | "correction" | "outcome" | "policy";

export interface MemoryItem {
  id: string;
  member_id: string | null;
  layer: Layer;
  kind: MemKind;
  subject: string | null;
  content: string;
  tags: string[];
  confidence: number;
  status: "active" | "proposed" | "revoked" | "expired";
  expires_at: string | null;
  created_at: string;
  uses?: number;
}

const STOP = new Set("the a an and or of to in on for with is are was be this that it at by from as את של על עם זה זו הוא היא יש אין לא כן גם או אם כל מה איך מתי אני אתה אתם הם שלנו שלכם في من على مع هذا هذه هو هي".split(" "));

export function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w)));
}

/** is it usable now? (active, not expired) */
export function isLive(m: MemoryItem, now = Date.now()): boolean {
  if (m.status !== "active") return false;
  if (m.expires_at && Date.parse(m.expires_at) <= now) return false;
  return true;
}

const HALF_LIFE_DAYS: Record<Layer, number> = { episodic: 30, semantic: 365 };
/** hard rules (forbidden wording, policies) always come first — whatever the topic */
const ALWAYS: MemKind[] = ["forbidden", "policy"];

export function score(m: MemoryItem, query: Set<string>, now = Date.now()): number {
  const words = terms(`${m.subject ?? ""} ${m.content} ${m.tags.join(" ")}`);
  let inter = 0;
  for (const w of query) if (words.has(w)) inter++;
  const relevance = query.size ? inter / Math.min(query.size, 12) : 0;
  const ageDays = Math.max(0, (now - Date.parse(m.created_at)) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS[m.layer]);
  const boost = ALWAYS.includes(m.kind) ? 1 : m.kind === "preference" || m.kind === "correction" ? 0.3 : 0;
  return (relevance + boost) * (0.4 + 0.6 * recency) * (0.3 + 0.7 * Math.max(0, Math.min(1, m.confidence)));
}

/** the memories worth putting in front of the employee for this task (own + shared), best first */
export function recall(all: MemoryItem[], query: string, memberId: string | null, max = 12, now = Date.now()): MemoryItem[] {
  const q = terms(query);
  const live = all.filter((m) => isLive(m, now) && (m.member_id === null || m.member_id === memberId));
  const rules = live.filter((m) => ALWAYS.includes(m.kind));
  const rest = live
    .filter((m) => !ALWAYS.includes(m.kind))
    .map((m) => ({ m, s: score(m, q, now) }))
    .filter((x) => x.s > 0.05)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
  return [...rules.slice(0, 6), ...rest].slice(0, max);
}

/**
 * Contradiction resolution: a new memory on the same subject (same member scope) supersedes the older active ones.
 * Returns the ids to expire. Subjects are compared normalized.
 */
export function supersededBy(next: Pick<MemoryItem, "subject" | "member_id" | "layer">, all: MemoryItem[]): string[] {
  if (!next.subject) return [];
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const subj = norm(next.subject);
  return all.filter((m) => m.status === "active" && m.subject && norm(m.subject) === subj && m.member_id === next.member_id && m.layer === next.layer).map((m) => m.id);
}

/** the memory block for the prompt — data, labeled with confidence, never instructions from outside */
export function memoryPrompt(items: MemoryItem[]): string {
  if (!items.length) return "";
  const label = (m: MemoryItem) => (m.kind === "forbidden" ? "NEVER" : m.kind === "policy" ? "POLICY" : m.kind === "preference" ? "OWNER PREFERS" : m.kind === "correction" ? "OWNER CORRECTED" : m.kind === "approved_style" ? "APPROVED BEFORE" : m.kind === "rejected" ? "REJECTED BEFORE" : m.kind === "outcome" ? "RESULT" : "FACT");
  return [
    "What you remember (your own memory of this business — confidence in brackets; prefer high-confidence items; when unsure, say it is an assumption):",
    ...items.map((m) => `- ${label(m)}${m.subject ? ` [${m.subject}]` : ""}: ${m.content.replace(/\s+/g, " ").slice(0, 400)} (${Math.round(m.confidence * 100)}%)`),
  ].join("\n");
}

export type Feedback = { kind: "approved" } | { kind: "edited"; before: string; after: string; note?: string } | { kind: "rejected"; note?: string };

/**
 * What one decision of the owner teaches. Approved-as-is → the style is confirmed (episodic, active). Edited → a
 * correction the owner can confirm as a lasting preference (proposed). Rejected with a reason → "don't" (proposed).
 */
export function learnFromFeedback(input: { tool: string; preview: string; feedback: Feedback }): { layer: Layer; kind: MemKind; content: string; subject: string; confidence: number; status: "active" | "proposed" }[] {
  const subject = input.tool;
  const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);
  const f = input.feedback;
  if (f.kind === "approved") return [{ layer: "episodic", kind: "approved_style", content: `Approved without changes: "${short(input.preview)}"`, subject, confidence: 0.75, status: "active" }];
  if (f.kind === "edited") {
    const out: ReturnType<typeof learnFromFeedback> = [{ layer: "episodic", kind: "correction", content: `The owner changed "${short(f.before)}" → "${short(f.after)}"${f.note ? ` because: ${short(f.note)}` : ""}`, subject, confidence: 0.8, status: "active" }];
    if (f.note && f.note.trim().length >= 4) out.push({ layer: "semantic", kind: "preference", content: short(f.note), subject: `${subject}:${short(f.note).slice(0, 40)}`, confidence: 0.7, status: "proposed" });
    return out;
  }
  const out: ReturnType<typeof learnFromFeedback> = [{ layer: "episodic", kind: "rejected", content: `Rejected: "${short(input.preview)}"${f.note ? ` — reason: ${short(f.note)}` : ""}`, subject, confidence: 0.8, status: "active" }];
  if (f.note && f.note.trim().length >= 4) out.push({ layer: "semantic", kind: "forbidden", content: short(f.note), subject: `${subject}:${short(f.note).slice(0, 40)}`, confidence: 0.65, status: "proposed" });
  return out;
}

/** "What I learned this week" — proposed and newly active semantic items of the last 7 days */
export function weeklyLearnings(all: MemoryItem[], now = Date.now()): MemoryItem[] {
  const since = now - 7 * 86_400_000;
  return all.filter((m) => Date.parse(m.created_at) >= since && (m.status === "proposed" || (m.status === "active" && m.layer === "semantic"))).slice(0, 30);
}
