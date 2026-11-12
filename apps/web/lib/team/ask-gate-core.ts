/**
 * Questions to the owner — quality gate (pure, additive).
 *
 * Owners saw employees ask them things the team can read by itself ("what are the contact_id's of the 5 waiting chats?",
 * "how many new leads last month and the average reply time?") — often with raw database ids inside. A professional
 * employee looks it up first and asks the owner only what only the owner knows (a decision, a price, a preference).
 *
 *   • ownerQuestionCheck: a question that asks for data one of the employee's READ tools returns is sent back to the
 *     employee once, with the exact tool to use — the task continues instead of waiting for the owner.
 *   • ownerFacingText: ids never reach the owner (also for questions that were already asked).
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** what the owner reads: database ids removed (a list of ids in brackets disappears; a single id becomes "…") */
export function ownerFacingText(q: string | null | undefined): string {
  return String(q ?? "")
    .replace(/\(\s*(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*[,،;]?\s*(?:ו\s*)?)+\)/gi, "")
    .replace(UUID, "…")
    .replace(/\(\s*contact_id\s*\)/gi, "")
    .replace(/\b(contact_id|post_id|deal_id|task_id|review_id|site_id)s?\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([?.,!])/g, "$1")
    .trim();
}

interface DataAsk {
  /** the read tool that answers it */
  tool: string;
  re: RegExp;
}

// ordered: the first match wins
const DATA_ASKS: DataAsk[] = [
  { tool: "inbox.thread", re: /(contact_id|מזה(ה|י)\s*(ה)?(לקוח|שיח)|מה(ו|י)?\s+(ה)?נושא\s+(ה)?(מדויק\s+)?(של\s+)?(ה)?פני|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|על\s+מה\s+(ה)?(לקוח|הם)\s+(פנ|שא|כתב)|what\s+(did|does)\s+(the\s+)?customer\s+(ask|want|write)|which\s+contact)/i },
  { tool: "inbox.unanswered", re: /(שיחות\s+(ה)?ממתינות|ממתינ(ים|ות)\s+למענה|מי\s+מחכה|waiting\s+(chats|conversations|customers))/i },
  { tool: "crm.recent_leads", re: /(כמה\s+לידים|מספר\s+(ה)?לידים|לידים\s+חדשים|new\s+leads|how\s+many\s+leads|number\s+of\s+leads)/i },
  { tool: "analytics.day_metrics", re: /(זמן\s+(ה)?תגובה|זמן\s+מענה|response\s+time|reply\s+time|conversion\s+rate|שיעור\s+(ה)?המרה)/i },
  { tool: "social.performance", re: /(מדד\s+(ה)?מעורבות|engagement|ביצועי\s+(ה)?פוסטים|post\s+performance)/i },
  { tool: "deals.pipeline", re: /(כמה\s+עסקאות|עסקאות\s+פתוחות|open\s+deals|pipeline)/i },
  { tool: "appointments.upcoming", re: /(פגישות\s+(ה)?קרובות|מה\s+ביומן|upcoming\s+(meetings|appointments))/i },
  { tool: "social.drafts", re: /(אילו\s+טיוטות|הטיוטות\s+(ה)?קיימות|which\s+drafts|existing\s+drafts)/i },
];

export type OwnerQuestionCheck = { ok: true; question: string } | { ok: false; tool: string; hint: string };

/**
 * ok → ask the owner (the text already cleaned of ids). not ok → the employee should read it with `tool` first.
 * `alreadyRedirected` = tools this task was already sent to once — the second time the question goes to the owner
 * (cleaned), so a task can never loop.
 */
export function ownerQuestionCheck(question: string, memberTools: readonly string[], alreadyRedirected: ReadonlySet<string> = new Set()): OwnerQuestionCheck {
  const q = String(question ?? "");
  for (const a of DATA_ASKS) {
    if (!a.re.test(q)) continue;
    if (!memberTools.includes(a.tool) || alreadyRedirected.has(a.tool)) break;
    return { ok: false, tool: a.tool, hint: `Do not ask the owner for data the team can read: use ${a.tool} now, then continue the task. Ask the owner only what only the owner can decide or know.` };
  }
  return { ok: true, question: ownerFacingText(q) || q.trim() };
}

/** a one-tap answer for the owner when an employee still asks for data ("check it yourselves") */
export function selfServeAnswer(lang: "he" | "en" | "ar"): string {
  if (lang === "en") return "Please look it up yourselves with the team's tools (conversations, leads, metrics, drafts) and continue — I don't have more information than the system.";
  if (lang === "ar") return "يرجى التحقق بأنفسكم باستخدام أدوات الفريق (المحادثات، العملاء المحتملون، المؤشرات، المسودات) والمتابعة — ليس لدي معلومات أكثر من النظام.";
  return "תבדקו בעצמכם עם הכלים של הצוות (שיחות, לידים, נתונים, טיוטות) ותמשיכו — אין לי מידע מעבר למה שיש במערכת.";
}

/**
 * The owner's answer as a lasting team fact (subject = a stable key of the question, so a newer answer to the same
 * question replaces the older one). Null for escalations, empty answers and the "check it yourselves" reply.
 */
export function ownerAnswerMemory(question: string, answer: string): { subject: string; content: string } | null {
  const q = ownerFacingText(question).trim();
  const a = String(answer ?? "").trim();
  if (!q || !a || q.startsWith("escalate:") || a.length < 2) return null;
  if (["he", "en", "ar"].some((l) => a === selfServeAnswer(l as "he" | "en" | "ar"))) return null;
  const key = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .join("-");
  if (!key) return null;
  return { subject: `owner-answer:${key}`.slice(0, 120), content: `The owner was asked: "${q.slice(0, 600)}" and answered: "${a.slice(0, 1000)}". Use this answer; do not ask it again.`.slice(0, 2000) };
}
