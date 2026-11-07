/**
 * Tool-argument repair (additive, pure — no I/O, unit-tested).
 *
 * Root cause it fixes: an employee PLANS its steps before it has read anything, so a step like "add a note to the lead" or
 * "create a follow-up task for each deal" is planned with arguments it cannot know yet — `contact_id: "the lead from step 1"`,
 * `due_iso: "2026-11-10 09:00 (ASSUMPTION)"`, `due_iso: "מחר"`. Strict validation then refused the step ("bad:contact_id",
 * "bad:due_iso"), the same refusal repeated for every similar step, and the task ended "partially done".
 *
 * Before validation each step's arguments are now repaired:
 *   • a date/time in any common form becomes a real ISO time: "2026-11-10 09:00", "10/11/2026 9:00" (day first, as written in
 *     Israel), "10.11", "today / tomorrow / מחר / היום / بكرة", "in 3 days / בעוד 3 ימים", words around it are ignored;
 *     an OPTIONAL date that still cannot be read is dropped (the task / message is created without it) instead of failing;
 *   • an id written inside text ("contact a19f…", "(id 9dfc…)") is extracted;
 *   • a contact that is not an id ("the lead", a name, a phone) is taken from what the employee already READ in this run:
 *     the contacts listed by earlier steps (unanswered inbox, contact search, reviews …). One known contact → used; several →
 *     the step runs once for each of them (up to 4) — exactly what "for each lead …" meant; none → a clear, short reason the
 *     employee understands (search the contact first), never a raw "bad:contact_id".
 *   • the same step failing the same way twice is not tried a third time in the same run (no wall of identical red lines).
 */

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_1 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ArgSpec = Record<string, string>;
export type RawArgs = Record<string, unknown>;

/** the first id inside a text, or null */
export function extractUuid(v: unknown): string | null {
  const m = String(v ?? "").match(UUID_G);
  return m ? m[0]!.toLowerCase() : null;
}

/** a local wall-clock time in a time zone → the real instant (ISO). Works for any IANA zone without a library. */
function zonedToIso(y: number, mo: number, d: number, h: number, mi: number, tz: string): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const offset = asLocal - guess;
    const out = new Date(guess - offset);
    return Number.isNaN(out.getTime()) ? null : out.toISOString();
  } catch {
    return new Date(guess).toISOString();
  }
}

function localParts(now: Date, tz: string): { y: number; mo: number; d: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    return { y: get("year"), mo: get("month"), d: get("day") };
  } catch {
    return { y: now.getUTCFullYear(), mo: now.getUTCMonth() + 1, d: now.getUTCDate() };
  }
}

function addDays(p: { y: number; mo: number; d: number }, n: number) {
  const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** "9", "9:30", "21:05" → [h, m] (default 09:00 when no time is written) */
function timeOf(text: string): [number, number] {
  const m = text.match(/(?:^|[^\d])([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const h = text.match(/(?:at|ב-?|בשעה|الساعة)\s*([01]?\d|2[0-3])(?!\d)/i);
  if (h) return [Number(h[1]), 0];
  return [9, 0];
}

/**
 * Any common written date/time → an ISO instant (in the business's time zone when no zone is written), or null.
 * A full ISO string with a zone is kept exactly.
 */
export function repairIso(v: unknown, now: Date = new Date(), tz = "Asia/Jerusalem"): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  // a full ISO with an explicit zone → as is
  const isoZ = raw.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/);
  if (isoZ) {
    const t = Date.parse(isoZ[0]);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  // YYYY-MM-DD[ T]HH:MM (no zone) → the business's local time
  const ymd = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
  if (ymd) return zonedToIso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), ymd[4] ? Number(ymd[4]) : 9, ymd[5] ? Number(ymd[5]) : 0, tz);
  // DD/MM/YYYY or DD.MM.YY or DD/MM (day first)
  const dmy = raw.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/);
  if (dmy) {
    const today = localParts(now, tz);
    let y = dmy[3] ? Number(dmy[3]) : today.y;
    if (y < 100) y += 2000;
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const [h, mi] = timeOf(raw.replace(dmy[0], " "));
    let iso = zonedToIso(y, mo, d, h, mi, tz);
    // no year written and the date already passed → next year
    if (iso && !dmy[3] && Date.parse(iso) < now.getTime() - 86_400_000) iso = zonedToIso(y + 1, mo, d, h, mi, tz);
    return iso;
  }
  // relative words
  const today = localParts(now, tz);
  const [h, mi] = timeOf(raw);
  const inDays = raw.match(/(?:in|בעוד|خلال|بعد)\s*(\d{1,3})\s*(?:days?|ימים|יום|أيام|يوم)/i);
  if (inDays) {
    const p = addDays(today, Number(inDays[1]));
    return zonedToIso(p.y, p.mo, p.d, h, mi, tz);
  }
  const inHours = raw.match(/(?:in|בעוד|خلال|بعد)\s*(\d{1,3})\s*(?:hours?|שעות|שעה|ساعات|ساعة)/i);
  if (inHours) return new Date(now.getTime() + Number(inHours[1]) * 3_600_000).toISOString();
  if (/מחרתיים|day after tomorrow|بعد\s*بكرة/i.test(raw)) {
    const p = addDays(today, 2);
    return zonedToIso(p.y, p.mo, p.d, h, mi, tz);
  }
  if (/מחר|tomorrow|بكرة|غدا|غداً/i.test(raw)) {
    const p = addDays(today, 1);
    return zonedToIso(p.y, p.mo, p.d, h, mi, tz);
  }
  if (/היום|today|اليوم/i.test(raw)) {
    const iso = zonedToIso(today.y, today.mo, today.d, h, mi, tz);
    return iso && Date.parse(iso) > now.getTime() ? iso : new Date(now.getTime() + 3_600_000).toISOString();
  }
  if (/next week|שבוע הבא|בשבוע הבא|الأسبوع القادم/i.test(raw)) {
    const p = addDays(today, 7);
    return zonedToIso(p.y, p.mo, p.d, h, mi, tz);
  }
  // last resort: the engine's own parser (English month names etc.)
  const t = Date.parse(raw.replace(/\(.*?\)/g, "").trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** contact ids an employee has already SEEN in this run (from earlier steps' summaries), in order, without duplicates */
export function knownContactIds(summaries: string[]): string[] {
  const out: string[] = [];
  for (const s of summaries) {
    // "contact <id>" (inbox), "(id <id>, lead…)" (contact search), "contact_id <id>"
    const re = /(?:contact(?:_id)?|\(id)\s*[:=]?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(s ?? "")))) {
      const id = m[1]!.toLowerCase();
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

export interface RepairResult {
  /** the arguments to validate (repaired) */
  args: RawArgs;
  /** when the step should run for several contacts: one argument set per contact (the first is `args`) */
  fanOut: RawArgs[];
  /** what was repaired (for the log), short */
  notes: string[];
  /** a clear reason when the step cannot run (instead of a raw validation code) */
  blocked: string | null;
}

/** 4, not 5: five identical write actions in a row are treated as an anomaly by the safety layer (safety-plus-core) */
export const MAX_FANOUT = 4;

/**
 * Repairs one step's arguments against the tool's spec. `known` = the contact ids already read in this run.
 * Never throws; arguments that need no repair are returned unchanged.
 */
export function repairArgs(spec: ArgSpec, raw: unknown, ctx: { known: string[]; now?: Date; tz?: string }): RepairResult {
  const src: RawArgs = raw && typeof raw === "object" ? { ...(raw as RawArgs) } : {};
  const notes: string[] = [];
  let fanOut: RawArgs[] = [];
  let blocked: string | null = null;
  for (const [name0, type] of Object.entries(spec)) {
    const required = name0.endsWith("!");
    const name = required ? name0.slice(0, -1) : name0;
    const v = src[name];
    if (v === undefined || v === null || v === "") continue;
    if (type === "iso") {
      if (!Number.isNaN(Date.parse(String(v))) && /\d{4}-\d{2}-\d{2}T/.test(String(v))) continue;
      const iso = repairIso(v, ctx.now ?? new Date(), ctx.tz ?? "Asia/Jerusalem");
      if (iso) {
        if (iso !== v) notes.push(`${name}: "${String(v).slice(0, 40)}" → ${iso.slice(0, 16)}`);
        src[name] = iso;
      } else if (!required) {
        delete src[name];
        notes.push(`${name}: unreadable date dropped`);
      }
    } else if (type === "uuid") {
      if (UUID_1.test(String(v))) continue;
      const inside = extractUuid(v);
      if (inside) {
        src[name] = inside;
        notes.push(`${name}: id taken from the text`);
        continue;
      }
      if (name === "contact_id") {
        if (ctx.known.length === 1) {
          src[name] = ctx.known[0]!;
          notes.push(`contact_id: "${String(v).slice(0, 30)}" → the contact read earlier`);
        } else if (ctx.known.length > 1) {
          const list = ctx.known.slice(0, MAX_FANOUT);
          src[name] = list[0]!;
          fanOut = list.map((id) => ({ ...src, [name]: id }));
          notes.push(`contact_id: "${String(v).slice(0, 30)}" → each of the ${list.length} contacts read earlier`);
        } else if (required) {
          blocked = "no contact id yet — find the contact first (crm.find_contacts / inbox.unanswered), then use its id";
        } else {
          delete src[name];
          notes.push("contact_id: not a contact id — left out");
        }
      } else if (!required) {
        delete src[name];
        notes.push(`${name}: not an id — left out`);
      } else {
        blocked = `${name} must be an id read from an earlier step`;
      }
    }
  }
  if (fanOut.length) fanOut = fanOut.map((f) => ({ ...src, ...f, contact_id: f.contact_id }));
  return { args: src, fanOut, notes, blocked };
}

/** the same tool failing the same way: stop after this many identical failures in one run */
export const SAME_FAILURE_LIMIT = 2;

export function failureKey(tool: string, error: string | null | undefined): string {
  return `${tool}::${String(error ?? "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "#").slice(0, 80)}`;
}
