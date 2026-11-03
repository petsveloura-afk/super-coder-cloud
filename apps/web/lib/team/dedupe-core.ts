/**
 * Upgrade 8 / stage A — duplicate goals and tasks (pure, unit-tested). A fingerprint of the INTENT (what + whom + when) catches
 * the same work created twice, even in different words or languages ("Publish posts" ≈ "פרסם פוסטים"). Duplicates are never
 * deleted: the plan marks them "merged" (a status + a pointer to the survivor), so the history stays.
 */
export type Lang = "he" | "en" | "ar";

const STOP = new Set(["the", "a", "an", "of", "for", "to", "and", "in", "on", "with", "של", "את", "על", "עם", "ו", "ל", "ב", "ה", "מה", "في", "من", "على", "و"]);

/** tiny multilingual concept lexicon: different words for the same idea map to ONE token */
const CONCEPTS: Record<string, string[]> = {
  publish: ["publish", "publishing", "פרסם", "פרסום", "פרסומים", "פרסמו", "انشر", "نشر"],
  post: ["post", "posts", "פוסט", "פוסטים", "منشور", "منشورات"],
  content: ["content", "copy", "תוכן", "محتوى"],
  define: ["define", "set", "הגדר", "הגדרת", "حدد", "تحديد"],
  plan: ["plan", "planning", "schedule", "תכנן", "תכנון", "תוכנית", "خطة", "تخطيط"],
  follow: ["follow", "followup", "follow-up", "מעקב", "עקוב", "متابعة"],
  lead: ["lead", "leads", "ליד", "לידים", "عملاء محتملين"],
  customer: ["customer", "customers", "client", "clients", "לקוח", "לקוחות", "عميل"],
  reply: ["reply", "respond", "answer", "response", "השב", "מענה", "תגובה", "رد", "الرد"],
  review: ["review", "reviews", "ביקורת", "ביקורות", "مراجعة", "مراجعات"],
  report: ["report", "summary", "דוח", "דו\"ח", "סיכום", "تقرير", "ملخص"],
  weekly: ["weekly", "week", "שבועי", "שבוע", "أسبوعي", "أسبوع"],
  invoice: ["invoice", "invoices", "חשבונית", "חשבוניות", "فاتورة", "فواتير"],
  overdue: ["overdue", "collections", "גבייה", "איחור", "متأخر", "تحصيل"],
  campaign: ["campaign", "campaigns", "קמפיין", "קמפיינים", "حملة", "حملات"],
  cta: ["cta", "קריאה לפעולה", "دعوة لاتخاذ إجراء"],
  site: ["site", "website", "אתר", "موقع"],
};
const TOKEN_TO_CONCEPT = new Map<string, string>();
for (const [c, ws] of Object.entries(CONCEPTS)) for (const w of ws) TOKEN_TO_CONCEPT.set(w.toLowerCase(), c);

const norm = (s: string) => s.toLowerCase().replace(/["'`״׳]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** the meaning tokens of a text: stop words dropped, known words mapped to a shared concept, sorted and de-duplicated */
export function intentTokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of norm(text).split(" ")) {
    if (!raw || STOP.has(raw)) continue;
    // Hebrew prefixes (ה / ל / ב / ו) glued to a word
    const stripped = /^[הלבו][א-ת]{3,}$/.test(raw) ? raw.slice(1) : raw;
    out.add(TOKEN_TO_CONCEPT.get(raw) ?? TOKEN_TO_CONCEPT.get(stripped) ?? stripped);
  }
  return [...out].sort();
}

/** Jaccard similarity of the intent of two texts, 0..1 */
export function intentSimilarity(a: string, b: string): number {
  const x = new Set(intentTokens(a));
  const y = new Set(intentTokens(b));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

/** a short stable hash (FNV-1a, 32 bit) — enough for a fingerprint, no secrets involved */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const DEDUPE_WINDOW_MS = 48 * 3_600_000;

/** intent + recipient + time window → one fingerprint (the same intent to the same person in the same window collides) */
export function fingerprint(input: { title: string; recipient?: string | null; at?: number; windowMs?: number }): string {
  const w = input.windowMs ?? DEDUPE_WINDOW_MS;
  const bucket = Math.floor((input.at ?? 0) / w);
  return fnv(`${intentTokens(input.title).join("|")}#${(input.recipient ?? "").toLowerCase().trim()}#${bucket}`);
}

export interface WorkItem {
  id: string;
  title: string;
  recipient?: string | null;
  role?: string | null;
  assignee?: string | null;
  status: string;
  created_at: string | number;
  /** goal = a goal row, task = an ordinary task */
  kind?: "goal" | "task";
}

const OPEN = new Set(["draft", "pending", "in_progress", "awaiting_approval", "awaiting_input", "blocked", "requires_connection"]);
const RANK: Record<string, number> = { done: 6, in_progress: 5, awaiting_approval: 4, awaiting_input: 4, pending: 3, requires_connection: 2, blocked: 2, draft: 1 };
const ts = (v: string | number) => (typeof v === "number" ? v : Date.parse(v));

/** is `next` the same work as `existing` (same owner or none, same recipient, inside the window, same intent)? */
export function isSameIntent(next: Pick<WorkItem, "title" | "recipient" | "assignee" | "role" | "kind">, ex: WorkItem, now: number, o: { threshold?: number; windowMs?: number } = {}): boolean {
  if ((next.kind ?? "task") !== (ex.kind ?? "task")) return false;
  if (next.assignee && ex.assignee && next.assignee !== ex.assignee) return false;
  if (!next.assignee && next.role && ex.role && next.role !== ex.role) return false;
  if ((next.recipient ?? "").toLowerCase() !== (ex.recipient ?? "").toLowerCase()) return false;
  if (now - ts(ex.created_at) > (o.windowMs ?? DEDUPE_WINDOW_MS)) return false;
  const x = intentTokens(next.title);
  if (x.length < 2) return norm(next.title) === norm(ex.title) && norm(next.title).length > 0;
  return intentSimilarity(next.title, ex.title) >= (o.threshold ?? 0.75);
}

/** the id of an existing OPEN item that already covers the new one, or null — used before creating a goal / task */
export function findExisting(next: Pick<WorkItem, "title" | "recipient" | "assignee" | "role" | "kind">, open: WorkItem[], now: number): string | null {
  for (const ex of open) if (OPEN.has(ex.status) || ex.status === "done") if (isSameIntent(next, ex, now)) return ex.id;
  return null;
}

export interface MergeStep {
  id: string;
  mergedInto: string;
  status: "merged";
  reason: string;
}

/**
 * The merge plan: groups of the same intent among OPEN items; the survivor is the most advanced (ties: the oldest).
 * The others are MARKED "merged" (never deleted). Done / failed / canceled items are left alone.
 */
export function planMerge(items: WorkItem[], now: number, o: { threshold?: number; windowMs?: number } = {}): { steps: MergeStep[]; groups: number } {
  const open = items.filter((i) => OPEN.has(i.status)).sort((a, b) => ts(a.created_at) - ts(b.created_at));
  const used = new Set<string>();
  const steps: MergeStep[] = [];
  let groups = 0;
  for (const a of open) {
    if (used.has(a.id)) continue;
    const group = [a, ...open.filter((b) => b.id !== a.id && !used.has(b.id) && isSameIntent(b, a, Math.max(now, ts(b.created_at) + 1), { ...o, windowMs: o.windowMs ?? DEDUPE_WINDOW_MS * 7 }))];
    if (group.length < 2) continue;
    groups++;
    const survivor = [...group].sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || ts(x.created_at) - ts(y.created_at))[0]!;
    for (const g of group) {
      used.add(g.id);
      if (g.id !== survivor.id) steps.push({ id: g.id, mergedInto: survivor.id, status: "merged", reason: "same_intent" });
    }
  }
  return { steps, groups };
}
