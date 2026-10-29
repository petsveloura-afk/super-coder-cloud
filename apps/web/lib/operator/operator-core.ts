/**
 * Wave 54 — the AI Operator, pure logic (no I/O, unit-tested).
 *
 * The person writes an instruction in plain language ("create a task for Dana tomorrow at 10 to call Moshe Cohen,
 * move the Cohen deal to won and book a meeting with Yossi on Tuesday at 10"). The model returns a PLAN — a list
 * of tool calls from the fixed catalog below — which the server resolves against the real data, shows for
 * approval, and only then executes (through the person's own permissions / RLS).
 * Nothing here talks to the database or the model.
 */

export const OP_TOOLS = [
  "create_contact",
  "update_contact",
  "add_note",
  "add_tag",
  "remember",
  "create_task",
  "complete_task",
  "create_deal",
  "move_deal",
  "book_meeting",
  "schedule_message",
  "draft_campaign",
  "draft_post",
] as const;
export type OpTool = (typeof OP_TOOLS)[number];

export const OP_MAX_ACTIONS = 10;

export interface RawAction {
  tool: OpTool;
  args: Record<string, string | number>;
}

export interface ParsedPlan {
  reply: string;
  actions: RawAction[];
  dropped: number;
}

/** Arguments each tool accepts (everything else is dropped). */
const ARG_KEYS: Record<OpTool, string[]> = {
  create_contact: ["first_name", "last_name", "phone", "email", "company", "status", "note"],
  update_contact: ["contact", "status", "phone", "email", "company", "job_title"],
  add_note: ["contact", "body"],
  add_tag: ["contact", "tag"],
  remember: ["contact", "fact"],
  create_task: ["title", "due", "assignee", "contact", "description"],
  complete_task: ["task"],
  create_deal: ["title", "value", "contact", "stage"],
  move_deal: ["deal", "stage", "status", "lost_reason"],
  book_meeting: ["title", "contact", "start", "duration_min", "location", "host"],
  schedule_message: ["contact", "text", "at"],
  draft_campaign: ["name", "channel", "body", "subject", "status", "tags"],
  draft_post: ["body", "when", "platforms"],
};

/** Arguments that must be present for the action to make sense. */
const REQUIRED: Record<OpTool, string[]> = {
  create_contact: ["first_name"],
  update_contact: ["contact"],
  add_note: ["contact", "body"],
  add_tag: ["contact", "tag"],
  remember: ["contact", "fact"],
  create_task: ["title"],
  complete_task: ["task"],
  create_deal: ["title"],
  move_deal: ["deal"],
  book_meeting: ["start"],
  schedule_message: ["contact", "text"],
  draft_campaign: ["name", "channel", "body"],
  draft_post: ["body"],
};

export function isOpTool(v: unknown): v is OpTool {
  return typeof v === "string" && (OP_TOOLS as readonly string[]).includes(v);
}

function cleanValue(v: unknown, max = 2000): string | number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(", ").slice(0, max) || null;
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+\n/g, "\n").trim().slice(0, max);
  return s && !/^(?:null|none|n\/a|undefined|-)$/i.test(s) ? s : null;
}

/** First JSON object in a model answer (tolerates code fences and prose around it). */
export function firstJsonObject(raw: string): unknown {
  const txt = (raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(txt.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The model's answer → a clean plan: known tools only, known args only, required args present, bounded. */
export function parsePlan(raw: string): ParsedPlan {
  const j = firstJsonObject(raw) as { reply?: unknown; actions?: unknown } | null;
  const reply = typeof j?.reply === "string" ? j.reply.trim().slice(0, 600) : "";
  const list = Array.isArray(j?.actions) ? (j!.actions as unknown[]) : [];
  const actions: RawAction[] = [];
  let dropped = 0;
  for (const item of list) {
    const a = item as { tool?: unknown; args?: unknown };
    if (!isOpTool(a?.tool) || actions.length >= OP_MAX_ACTIONS) {
      dropped++;
      continue;
    }
    const src = (a.args && typeof a.args === "object" ? a.args : {}) as Record<string, unknown>;
    const args: Record<string, string | number> = {};
    for (const k of ARG_KEYS[a.tool]) {
      const v = cleanValue(src[k], k === "body" || k === "text" || k === "description" ? 4000 : 300);
      if (v !== null) args[k] = v;
    }
    if (REQUIRED[a.tool].some((k) => args[k] === undefined || args[k] === "")) {
      dropped++;
      continue;
    }
    actions.push({ tool: a.tool, args });
  }
  return { reply, actions, dropped };
}

/* ---------------------------------------------------------------- time */

/** "2026-11-03T10:00" (wall clock in `timeZone`) → UTC ISO string; null when not a valid local date-time. */
export function wallTimeToUtc(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec((local ?? "").trim());
  if (!m) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((local ?? "").trim());
    if (!d) return null;
    return wallTimeToUtc(`${d[1]}-${d[2]}-${d[3]}T09:00`, timeZone);
  }
  const [y, mo, da, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const offsetAt = (ms: number): number => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
      return asUtc - ms;
    } catch {
      return 0;
    }
  };
  // two passes handle DST switches
  let ts = guess - offsetAt(guess);
  ts = guess - offsetAt(ts);
  const out = new Date(ts);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

/** "now" as the model should see it, in the business time zone: "2026-10-29 Thursday 22:30". */
export function localNowText(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")} ${g("weekday")} ${g("hour")}:${g("minute")}`;
  } catch {
    return now.toISOString().slice(0, 16).replace("T", " ");
  }
}

/* ---------------------------------------------------------------- matching names */

const norm = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[^\p{L}\p{N}\s@.+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Best match of a free-text name in a list of options (exact > starts-with > all words contained). */
export function matchOption<T extends { label: string }>(list: T[], query: string): { match: T | null; candidates: T[] } {
  const q = norm(query);
  if (!q) return { match: null, candidates: [] };
  const exact = list.filter((o) => norm(o.label) === q);
  if (exact.length === 1) return { match: exact[0]!, candidates: exact };
  const starts = list.filter((o) => norm(o.label).startsWith(q) || (q.startsWith(norm(o.label)) && norm(o.label).length >= 2));
  if (starts.length === 1) return { match: starts[0]!, candidates: starts };
  const words = q.split(" ").filter((w) => w.length >= 2);
  const all = list.filter((o) => words.length > 0 && words.every((w) => norm(o.label).includes(w)));
  if (all.length === 1) return { match: all[0]!, candidates: all };
  const cands = (exact.length ? exact : starts.length ? starts : all).slice(0, 5);
  return { match: null, candidates: cands };
}

/** "$2" → 2 (a reference to an earlier action in the same plan), otherwise null. */
export function planRef(v: unknown): number | null {
  const m = /^\$(\d{1,2})$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** Phone for searching (digits; Israeli 05x → also 9725x). */
export function phoneDigits(v: string): string[] {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length < 7) return [];
  const out = new Set([d]);
  if (d.startsWith("972")) out.add(`0${d.slice(3)}`);
  if (d.startsWith("0")) out.add(`972${d.slice(1)}`);
  return [...out];
}

/* ---------------------------------------------------------------- the model's instructions */

export interface OperatorContext {
  lang: "he" | "en" | "ar";
  timeZone: string;
  nowText: string;
  me: string;
  members: string[];
  stages: string[];
  channels: string[];
  currency: string;
}

const LANG: Record<OperatorContext["lang"], string> = { he: "Hebrew", en: "English", ar: "Arabic" };

export function operatorSystemPrompt(c: OperatorContext): string {
  return [
    "You are the AI Operator of a business CRM. You turn the user's instruction into a precise PLAN of actions from a fixed tool catalog.",
    "You never invent data: names, phones, prices and dates come only from the instruction. If something essential is missing, leave that action out and say what is missing in \"reply\".",
    `Now: ${c.nowText} (${c.timeZone}). Write every date-time as local "YYYY-MM-DDTHH:mm" in this time zone (\"tomorrow at 10\" → the real date). A date without a time → 09:00.`,
    `The user is "${c.me}". Team members: ${c.members.join(", ") || "(only the user)"}. Use "me" for the user.`,
    `Pipeline stages: ${c.stages.join(", ") || "(default)"}. Currency: ${c.currency}. Campaign channels: ${c.channels.join(", ")}.`,
    "To refer to a contact created by an earlier action in the same plan, use \"$N\" (N = that action's number, starting at 1).",
    "Tools (tool name → args):",
    "- create_contact → first_name, last_name, phone, email, company, status(lead|qualified|customer|inactive), note   (needs a phone or an email)",
    "- update_contact → contact(name/phone/email/$N), status, phone, email, company, job_title",
    "- add_note → contact, body",
    "- add_tag → contact, tag",
    "- remember → contact, fact   (a lasting fact the AI agents should remember about this customer)",
    "- create_task → title, due(YYYY-MM-DDTHH:mm), assignee(member name|me), contact, description",
    "- complete_task → task(words from the task title)",
    "- create_deal → title, value(number), contact, stage(stage name)",
    "- move_deal → deal(words from the deal title or the contact's name), stage(stage name) or status(won|lost|open), lost_reason",
    "- book_meeting → title, contact, start(YYYY-MM-DDTHH:mm), duration_min, location, host(member name|me)",
    "- schedule_message → contact, text(the exact message to send the customer), at(YYYY-MM-DDTHH:mm; omit = in a few minutes)",
    "- draft_campaign → name, channel, body(the full message), subject(email only), status(audience: lead|qualified|customer|inactive), tags(comma separated)",
    "- draft_post → body(the full social post), when(YYYY-MM-DDTHH:mm), platforms(facebook,instagram)",
    `Write every text the customer will read (messages, campaign and post bodies) in ${LANG[c.lang]}, ready to send, natural and professional.`,
    `"reply": one or two short sentences in ${LANG[c.lang]} that tell the user what you are going to do (or what is missing).`,
    'Answer with JSON ONLY: {"reply": "...", "actions": [{"tool": "...", "args": {...}}]} — at most 10 actions, in the order they should run. If the instruction asks for nothing actionable, return an empty "actions" list and answer in "reply".',
  ].join("\n");
}

/* ---------------------------------------------------------------- outcome */

export function runStatus(results: { ok: boolean }[]): "executed" | "partial" | "failed" {
  if (!results.length) return "failed";
  const ok = results.filter((r) => r.ok).length;
  return ok === results.length ? "executed" : ok > 0 ? "partial" : "failed";
}

/** Example instructions shown as one-click chips (i18n keys under operator.examples.*). */
export const OP_EXAMPLES = ["task", "deal", "meeting", "contact", "campaign", "followup"] as const;
