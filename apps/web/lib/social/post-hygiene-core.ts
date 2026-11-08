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
const NOTES_HEADER = /^\s*(?:[#>*_\-•\s]*)\s*(?:הנחות(?:\s+עבודה)?|הנחת\s+עבודה|הערות(?:\s+(?:למנהל|לבעלים|לבעל\s+העסק|פנימיות))?|הערה(?:\s+פנימית)?|הסבר|הערות\s+עריכה|assumptions?|notes?(?:\s+(?:to|for)\s+(?:the\s+)?(?:owner|manager|team))?|internal\s+notes?|rationale|explanation|ملاحظات|ملاحظة|افتراضات|شرح|הנחיות(?:\s+(?:לפרסום|לצוות|לעורך|פנימיות))?|הוראות\s+(?:לצוות|פנימיות|לעורך|לפרסום|תזמון)|הערות\s+(?:מערכת|כלליות|והנחות|לעורך|לתזמון|לפרסום)|הערת\s+(?:מערכת|עורך)|הנחות\s+והערות|מידע\s+פנימי|לידיעת(?:ך|כם)|למנהל|לבעלים|המלצות\s+(?:לפרסום|לתזמון)|המלצת\s+תזמון|(?:שעת|מועד|זמן)\s+(?:פרסום\s+)?מומל(?:ץ|צת)(?:\s+לפרסום)?|הצע(?:ה|ות|ת)\s+(?:ל)?(?:תמונה|וידאו|סרטון|עיצוב|ויזואל)|רעיון\s+(?:ל)?(?:תמונה|עיצוב)|תמונה\s+מוצעת|נימוק|הנמקה|הסבר\s+(?:קצר|לבחירה)|שיקולים|צעדים\s+הבאים|instructions?(?:\s+(?:to|for)\s+(?:the\s+)?(?:team|editor|owner|manager))?|guidelines?|comments?|remarks?|(?:editor|system)(?:\'s)?\s+notes?|note\s+to\s+(?:the\s+)?editor|publishing\s+notes?|scheduling\s+notes?|draft\s+notes?|recommend(?:ation|ed\s+(?:time|posting\s+time))s?|(?:best|recommended)\s+(?:time|posting\s+time)(?:\s+to\s+post)?|(?:image|visual|photo|video)\s+(?:suggestions?|ideas?)|suggested\s+(?:image|visual)|reasoning|next\s+steps?|internal|تعليمات(?:\s+(?:للفريق|للمحرر|داخلية))?|إرشادات|ملاحظات\s+(?:للمدير|داخلية|النشر|المحرر)|ملاحظة\s+داخلية|توصيات\s+(?:النشر|الجدولة)|اقتراح(?:ات)?\s+(?:صورة|الصورة|تصميم)|(?:توقيت|موعد)\s+النشر\s+المقترح|أفضل\s+وقت\s+للنشر|الخطوات\s+التالية|تبرير)\s*(?:[*_]{1,2})?\s*[:：]/i;

/** a label line in front of the post itself: "**הפוסט:**", "טקסט הפוסט:", "Post text:", "نص المنشور:" — only the label goes */
const LABEL_LINE = /^\s*(?:[#>*_\s]*)\s*(?:הפוסט|פוסט|טקסט\s+הפוסט|נוסח\s+הפוסט|הפוסט\s+הסופי|post(?:\s+text)?|final\s+post|caption|المنشور|نص\s+المنشور|טקסט\s+לפרסום|הפוסט\s+לפרסום|פוסט\s+מוצע|הצעה\s+לפוסט|טיוטת\s+(?:ה)?פוסט|גרסה\s+סופית|נוסח\s+סופי|הטקסט|פוסט\s+ל(?:פייסבוק|אינסטגרם|טלגרם)|הפוסט\s+ל(?:פייסבוק|אינסטגרם|טלגרם)|post\s+copy|caption\s+text|proposed\s+post|draft\s+post|(?:facebook|instagram|telegram)\s+post|final\s+version|المنشور\s+المقترح|نص\s+للنشر|منشور\s+(?:فيسبوك|إنستغرام)|النسخة\s+النهائية)\s*(?:[*_]{1,2})?\s*[:：]\s*(?:[*_]{1,2})?\s*$/i;

/** words that only a report ABOUT a post contains — never the post a customer reads */
const META = /(מזהה\s+(?:ה)?פוסט|אישור\s+תזמון|(?:ה)?פוסט\s+(?:נשמר|תוזמן|הוכן)\s+(?:במערכת|כטיוטה|בהצלחה)|נשמר\s+כטיוטה|ממתין\s+לאישור\s+(?:ה)?בעלים|post\s+(?:draft\s+)?(?:id|saved|scheduled)\b|draft\s+saved|saved\s+as\s+(?:a\s+)?draft|waiting\s+for\s+the\s+owner|معرف\s+المنشور|تم\s+حفظ\s+المسودة|נוצרה\s+טיוטה|טיוטה\s+נוצרה|תוזמן\s+בהצלחה|תוזמן\s+ל(?:יום|תאריך|שעה)|נוסף\s+ללוח|הוספתי\s+ל(?:לוח|תזמון)|ממתין\s+לאישורך|מחכה\s+לאישור|הפוסט\s+ממתין|post\s+(?:was\s+)?(?:created|queued|added)\b|scheduled\s+for\s+\d|added\s+to\s+(?:the\s+)?(?:calendar|queue|board)|created\s+a\s+draft|awaiting\s+(?:your\s+)?approval|تمت\s+الجدولة|تم\s+إنشاء\s+مسودة|في\s+انتظار\s+الموافقة)/i;

/** a lead-in line of an AI reply in front of the post ("הנה הפוסט:", "Here is the post:", "إليك المنشور:") — dropped, the post stays */
const PREAMBLE = /^\s*[#>*_\s]*(?:הנה|להלן|בבקשה|בשמחה|בטח|כמובן|ברור|here(?:'s|\s+is|\s+are)|sure|certainly|of\s+course|below\s+is|ها\s+هو|إليك|تفضل|بالطبع)(?![\p{L}\p{N}])[^\n]{0,80}[:：]\s*[*_]{0,2}\s*$/iu;

/** the closing question / offer of an AI reply after the post ("רוצה שאשנה משהו?", "Let me know if you'd like changes") — it and what follows are cut */
const CHAT_TAIL = /^\s*[#>*_\-•\s]*(?:רוצה\s+ש(?:אשנה|אכתוב|אעדכן|אתאים)|רוצים\s+ש(?:אשנה|אכתוב|אעדכן|אתאים)|אשמח\s+(?:לשנות|לעדכן|להתאים)|תגיד(?:ו)?\s+לי\s+אם|let\s+me\s+know\s+if\s+you(?:'d|\s+would)?\s+like|would\s+you\s+like\s+me\s+to|do\s+you\s+want\s+me\s+to|i\s+can\s+also\s+(?:adjust|change|write)|هل\s+تريد\s+أن|أخبرني\s+إن|يسعدني\s+أن\s+أعدل)/iu;

/** a line that is only a code fence or a <post> tag around the text */
const WRAP_LINE = /^\s*(?:```[a-z]*|<\/?post>|<\/?draft>)\s*$/i;

/**
 * a heading line that stands ALONE and only titles a report / summary ("**תוצאה סופית**", "Final result:", "ملخص") — never part of a
 * sentence (the line must end right after the heading, so "סיכום השנה שלנו מדהים" is a post line, not a heading)
 */
const REPORT_HEADING = /^\s*[#>*_\-•\s]*(?:תוצאה\s+סופית|סיכום(?:\s+ביצוע)?|דוח(?:\s+ביצוע)?|המלצות|לוח\s+זמנים\s+לפרסום|final\s+result|summary|report|recommendations|publishing\s+schedule|نتيجة\s+نهائية|توصيات|جدول\s+النشر|ملخص)\s*[*_]{0,2}\s*[:：]?\s*[*_]{0,2}\s*$/iu;

/** a "field: value" line of a status report (status / id / platforms / publish time) — two or more of them = a report, not a post */
const REPORT_FIELD = /^\s*[#>*_\-•\s]*(?:סטטוס|מזהה|פלטפורמות?|ערוצים|מועד\s+פרסום|תאריך\s+פרסום|נושא\s+הפוסט|status|id|platforms?|channels?|scheduled\s+(?:for|at)|publish\s+time|الحالة|المعرف|المنصات|موعد\s+النشر)\s*(?:\([^)]*\))?\s*[*_]{0,2}\s*[:：]/iu;

/** true when the text has the shape of a status report (two or more report-field lines) */
export function hasReportShape(text: string): boolean {
  let n = 0;
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) if (REPORT_FIELD.test(line) && ++n >= 2) return true;
  return false;
}

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
    if (WRAP_LINE.test(line)) continue;
    if (LABEL_LINE.test(line)) continue;
    if (PREAMBLE.test(line) && !kept.some((k) => k.trim())) continue; // "הנה הפוסט:" in front of the post goes
    if (CHAT_TAIL.test(line) && kept.some((k) => k.trim())) break; // "רוצה שאשנה משהו?" after the post goes
    if (REPORT_HEADING.test(line) && !kept.some((k) => k.trim())) continue; // a title above the post ("תוצאה סופית") goes, the post stays
    kept.push(line);
  }
  let text = plainForSocial(kept.join("\n"));
  // a post wrapped in quotes as a whole ("…" / «…») loses the wrapping
  text = text.replace(/^["“”«](.*)["“”»]$/s, "$1").trim();
  if (UUID.test(text) || META.test(text) || hasReportShape(text)) return { ok: false, reason: "not_a_post" };
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

/**
 * Marked extraction: the same cleaning as cleanPostBody, but a refusal does not lose the text — the board still shows what is
 * saved, marked "not a post", so the owner can edit or cancel it (nothing is deleted).
 */
export type PostMark = { text: string; notAPost: boolean; reason?: "too_short" | "not_a_post" };

export function markPostBody(raw: string): PostMark {
  const c = cleanPostBody(raw);
  if (c.ok) return { text: c.text, notAPost: false };
  return { text: plainForSocial(raw) || String(raw ?? ""), notAPost: true, reason: c.reason };
}

/**
 * Soft warning for a PERSON's own post (never blocks, never changes the text — a person's post goes out exactly as written):
 * true when it contains a notes / instructions section or reads like a report, so the board can say "check before scheduling".
 */
export function suspectManualPost(p: { body: string; source?: string | null }): boolean {
  if (p.source === "agent") return false;
  const body = String(p.body ?? "");
  return body.replace(/\r\n?/g, "\n").split("\n").some((l) => NOTES_HEADER.test(l)) || UUID.test(body) || META.test(body) || hasReportShape(body);
}

/**
 * One rule for the board, the approve / schedule / publish-now actions and "approve all": an AGENT's post that is only notes or a
 * report is not a post. It is the same test the publishing guard applies, so the board never offers what publishing would refuse.
 */
export function isNotAPost(p: { body: string; source?: string | null }): boolean {
  return p.source === "agent" && !cleanPostBody(p.body).ok;
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
