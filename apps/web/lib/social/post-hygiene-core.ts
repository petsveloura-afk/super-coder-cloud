/**
 * Post hygiene (additive, pure — no I/O). What an AI employee hands over as "the post" is not always only the post: it can
 * carry its own working notes ("**הנחות:** …", "Assumptions: …"), markdown that Facebook prints literally ("**bold**"), or
 * even a report about the post instead of the post ("**אישור תזמון פוסט במערכת** מזהה פוסט (ID): bf18…"). Those reached the
 * posts board as drafts. Everything an agent saves as a post now passes through here first:
 *  - the notes / assumptions section (and everything after it) is cut away,
 *  - a label line such as "Post:" / "טקסט הפוסט:" is dropped,
 *  - markdown emphasis and headings become plain text (social networks do not render markdown),
 *  - a text that is a system report (ids, "draft saved", "scheduling confirmation") is refused — it is not a post.
 * The same module gives the board its "who wrote it" label and its date ordering.
 */

export type PostClean = { ok: true; text: string } | { ok: false; reason: "too_short" | "not_a_post" };

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** a heading-like line that opens the employee's own notes: "**הנחות:**", "## Assumptions", "הערות למנהל:", "ملاحظات:" */
const NOTES_HEADER = /^\s*(?:[#>*_\-•\s]*)\s*(?:הנחות(?:\s+עבודה)?|הנחת\s+עבודה|הערות(?:\s+(?:למנהל|לבעלים|לבעל\s+העסק|פנימיות))?|הערה(?:\s+פנימית)?|הסבר|הערות\s+עריכה|assumptions?|notes?(?:\s+(?:to|for)\s+(?:the\s+)?(?:owner|manager|team))?|internal\s+notes?|rationale|explanation|ملاحظات|ملاحظة|افتراضات|شرح)\s*(?:[*_]{1,2})?\s*[:：]/i;

/** a label line in front of the post itself: "**הפוסט:**", "טקסט הפוסט:", "Post text:", "نص المنشور:" — only the label goes */
const LABEL_LINE = /^\s*(?:[#>*_\s]*)\s*(?:הפוסט|פוסט|טקסט\s+הפוסט|נוסח\s+הפוסט|הפוסט\s+הסופי|post(?:\s+text)?|final\s+post|caption|المنشور|نص\s+المنشور)\s*(?:[*_]{1,2})?\s*[:：]\s*(?:[*_]{1,2})?\s*$/i;

/** words that only a report ABOUT a post contains — never the post a customer reads */
const META = /(מזהה\s+(?:ה)?פוסט|אישור\s+תזמון|(?:ה)?פוסט\s+(?:נשמר|תוזמן|הוכן)\s+(?:במערכת|כטיוטה|בהצלחה)|נשמר\s+כטיוטה|ממתין\s+לאישור\s+(?:ה)?בעלים|post\s+(?:draft\s+)?(?:id|saved|scheduled)\b|draft\s+saved|saved\s+as\s+(?:a\s+)?draft|waiting\s+for\s+the\s+owner|معرف\s+المنشور|تم\s+حفظ\s+المسودة)/i;

/** markdown → plain text the networks print as intended */
export function plainForSocial(text: string): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/(^|\s)\*([^*\n]+?)\*(?=\s|$|[.,!?])/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** the post an agent hands over → the post a customer will read (or a refusal when it is not a post) */
export function cleanPostBody(raw: string): PostClean {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (NOTES_HEADER.test(line)) break; // the notes section and everything after it are the employee's, not the customer's
    if (LABEL_LINE.test(line)) continue;
    kept.push(line);
  }
  let text = plainForSocial(kept.join("\n"));
  // a post wrapped in quotes as a whole ("…" / «…») loses the wrapping
  text = text.replace(/^["“”«](.*)["“”»]$/s, "$1").trim();
  if (UUID.test(text) || META.test(text)) return { ok: false, reason: "not_a_post" };
  if (text.length < 20) return { ok: false, reason: "too_short" };
  return { ok: true, text: text.slice(0, 5000) };
}

/**
 * The text that actually goes out for a post (publishing + the board). A person's post is sent exactly as written; an agent's
 * post is sent without its notes section and markdown (a post saved before this hygiene existed is cleaned on the way out).
 */
export function outgoingText(body: string, source: string | null | undefined): string {
  if (source !== "agent") return body;
  const c = cleanPostBody(body);
  return c.ok ? c.text : plainForSocial(body) || body;
}

/** is this body a report / notes rather than a post (used to tidy what is already on the board) */
export function looksLikeNotPost(body: string): boolean {
  return !cleanPostBody(body).ok;
}

export interface PostAuthorInput {
  source?: string | null;
  origin?: string | null;
  agent_name?: string | null;
}

/**
 * Who wrote the post — for the people who manage the board (the posts list is only loaded for "campaigns.manage"). The
 * employee's own name when the digital team wrote it; otherwise which engine (marketing agent / autopilot); null = a person.
 * Returned as an i18n key + params so it is shown in the business language.
 */
export function postAuthor(p: PostAuthorInput): { key: string; params?: Record<string, string> } | null {
  if (p.source !== "agent") return null;
  const name = String(p.agent_name ?? "").trim().slice(0, 60);
  if (name) return { key: "social.author.employee", params: { name } };
  if (p.origin === "studio") return { key: "social.author.team" };
  if (p.origin === "autopilot" || p.origin === "week" || p.origin === "holiday" || p.origin === "evergreen" || p.origin === "review" || p.origin === "repurpose") return { key: "social.author.autopilot" };
  return { key: "social.byAgent" };
}

export type PostSort = "newest" | "schedule";

interface Sortable {
  id: string;
  scheduled_at: string;
  created_at?: string | null;
}

const ts = (v: string | null | undefined) => {
  const n = Date.parse(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * A stable, explicit order (before: only by planned time — many agent drafts share "tomorrow 10:00", so their order changed
 * on every load). "newest" = the most recently created first; "schedule" = the planned publishing time, latest first. Ties
 * are broken by creation time and then id, so the same list always shows in the same order.
 */
export function sortPosts<T extends Sortable>(posts: readonly T[], mode: PostSort): T[] {
  return [...posts].sort((a, b) => {
    const primary = mode === "newest" ? ts(b.created_at) - ts(a.created_at) : ts(b.scheduled_at) - ts(a.scheduled_at);
    if (primary) return primary;
    const second = mode === "newest" ? ts(b.scheduled_at) - ts(a.scheduled_at) : ts(b.created_at) - ts(a.created_at);
    if (second) return second;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** created within the last day (and not by the viewer's own hand) → marked "new" on the board */
export function isFreshPost(p: { created_at?: string | null }, now: number, windowMs = 24 * 3_600_000): boolean {
  const c = ts(p.created_at);
  return c > 0 && now - c >= 0 && now - c < windowMs;
}

/**
 * The next free morning slot for an agent draft (before: every agent draft was planned for "tomorrow 10:00", so a batch of
 * them sat on the same minute). Given the times already taken, returns the first day from tomorrow whose slot is free.
 */
export function nextFreeSlot(taken: readonly string[], now: Date, hourUtc = 8, maxDays = 30): Date {
  const used = new Set(taken.map((x) => String(x).slice(0, 13)));
  for (let i = 1; i <= maxDays; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    d.setUTCHours(hourUtc, 0, 0, 0);
    if (!used.has(d.toISOString().slice(0, 13))) return d;
  }
  const d = new Date(now.getTime() + 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}
