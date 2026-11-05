/**
 * Wave 67 — a clean "My team" memory tab (pure, unit-tested).
 *
 * Three things, all additive:
 *  1. DISPLAY: translate the English sentences the team itself writes into the business language (he / ar), merge
 *     duplicates into one row with a count, hide empty / expired rows. The database is never changed by this.
 *  2. A GATE in front of the memory write: empty text, "0 actions" results and duplicates are not saved as ACTIVE memory;
 *     assumptions are saved as "proposed" (the team reads only "active", the owner can confirm them).
 *  3. Both entry points have a "safe" wrapper that returns exactly the input when anything throws.
 */
export type Lang = "he" | "en" | "ar";

export interface MemoryLike {
  id: string;
  member_id: string | null;
  layer: string;
  kind: string;
  subject: string | null;
  content: string;
  status: string;
  created_at: string;
  expires_at?: string | null;
}

export interface NewMemoryLike {
  layer: "episodic" | "semantic";
  kind: string;
  content: string;
  subject?: string | null;
  confidence: number;
  status: "active" | "proposed";
}

const PUNCT = /[\s"'“”‘’`.,;:!?()[\]{}\-–—_*]+/g;
const PLACEHOLDER = /^(null|undefined|n\/a|none|nan)$/i;
const LABEL_ONLY = /^(approved without changes|lesson from [\w ]+|what worked|what did not work|communication style|assumptions|אושר ללא שינויים|הנחות|افتراضات)$/i;

/** empty, a placeholder ("null", "—") or a label with nothing after it ("Approved without changes: """) */
export function isEmptyMemoryContent(content: unknown): boolean {
  if (typeof content !== "string") return true;
  const t = content.replace(PUNCT, " ").trim();
  if (!t) return true;
  if (PLACEHOLDER.test(t)) return true;
  return LABEL_ONLY.test(t);
}

/** the comparison key of a sentence: case, quotes, punctuation and spacing do not make a different memory */
export function memoryKey(content: string): string {
  return String(content ?? "").toLowerCase().replace(PUNCT, " ").trim().slice(0, 400);
}

/* ------------------------------------------------------------------------------------------------ translation */

const PH = {
  approved: { he: "אושר ללא שינויים: ", ar: "تمت الموافقة دون تعديلات: " },
  raised: { he: "העלה התנגדות", ar: "أثار اعتراضًا" },
  upset: { he: "היה מוטרד באינטראקציה אחרונה — לטפל בו בזהירות נוספת.", ar: "كان منزعجًا في تفاعل حديث — تعامل معه بعناية إضافية." },
  deal: { he: "שיחה קודמת הסתיימה בעסקה.", ar: "انتهت محادثة سابقة بصفقة." },
  complaint: { he: "תלונה קודמת טופלה.", ar: "تمت معالجة شكوى سابقة." },
  lesson: { he: "לקח מעובד אחר בצוות: ", ar: "درس من موظف آخر في الفريق: " },
  worked: { he: "מה שעבד: ", ar: "ما نجح: " },
  because: { he: " — כי ", ar: " — لأن " },
  notWorked: { he: "מה שלא עבד: ", ar: "ما لم ينجح: " },
  outcome: { he: "תוצאה:", ar: "النتيجة:" },
  watch: { he: "בפעם הבאה לשים לב ל:", ar: "في المرة القادمة انتبه إلى:" },
  assumptions: { he: "הנחות: ", ar: "افتراضات: " },
  style: { he: "סגנון תקשורת: ", ar: "أسلوب التواصل: " },
} as const;

const STYLE: Record<string, { he: string; ar: string }> = {
  "writes briefly — keep replies short": { he: "כותב בקצרה — כדאי לענות בקצרה", ar: "يكتب باختصار — أجب باختصار" },
  "friendly and casual": { he: "ידידותי ונינוח", ar: "ودّي وغير رسمي" },
  "formal / businesslike": { he: "רשמי ועסקי", ar: "رسمي ومهني" },
};

const OBJECTION: Record<string, { he: string; ar: string }> = {
  price: { he: "מחיר", ar: "السعر" },
  timing: { he: "עיתוי", ar: "التوقيت" },
  trust: { he: "אמון", ar: "الثقة" },
  competitor: { he: "מתחרים", ar: "المنافسين" },
  need: { he: "צורך", ar: "الحاجة" },
};

const doneText = (lang: "he" | "ar", n: string) => (lang === "he" ? `בוצעו ${n} פעולות` : `تم تنفيذ ${n} إجراءات`);
const notDoneText = (lang: "he" | "ar", n: string) => (lang === "he" ? `${n} לא בוצעו` : `${n} لم تُنفَّذ`);
const waitingText = (lang: "he" | "ar", n: string) => (lang === "he" ? `${n} ממתינות לאישורך` : `${n} بانتظار موافقتك`);
const handedText = (lang: "he" | "ar", n: string) => (lang === "he" ? `${n} הועברו לעובד אחר` : `${n} حُوّلت لموظف آخر`);

/** display translation of the sentences the team writes itself; anything it does not recognise is returned as it is */
export function translateMemoryContent(content: string, lang: Lang, localize?: (s: string) => string): string {
  if (lang === "en" || typeof content !== "string") return content;
  try {
    const L = lang;
    let m: RegExpMatchArray | null;
    if ((m = content.match(/^Approved without changes: ([\s\S]*)$/))) return `${PH.approved[L]}${m[1] ?? ""}`;
    if ((m = content.match(/^Communication style: ([\s\S]*?)\.?$/))) {
      const hit = STYLE[(m[1] ?? "").trim()];
      return hit ? `${PH.style[L]}${hit[L]}.` : content;
    }
    if ((m = content.match(/^Raised an? ([\w-]+) objection\.?$/))) {
      const w = OBJECTION[(m[1] ?? "").toLowerCase()];
      return w ? `${PH.raised[L]} (${w[L]}).` : `${PH.raised[L]}.`;
    }
    if (/^Was upset in a recent interaction — handle with extra care\.?$/.test(content)) return PH.upset[L];
    if (/^A previous conversation ended in a deal\.?$/.test(content)) return PH.deal[L];
    if (/^A previous complaint was resolved\.?$/.test(content)) return PH.complaint[L];
    if ((m = content.match(/^Lesson from [^:]{1,60}: ([\s\S]*)$/))) return `${PH.lesson[L]}${m[1] ?? ""}`;
    if ((m = content.match(/^What worked \((?:fast|deep) path\): ([\s\S]*?) — because ([\s\S]*)$/))) return `${PH.worked[L]}${m[1] ?? ""}${PH.because[L]}${m[2] ?? ""}`;
    if ((m = content.match(/^What did NOT work: ([\s\S]*)$/))) {
      const rest = (m[1] ?? "").replace(/Outcome:/g, PH.outcome[L]).replace(/Next time watch for:/g, PH.watch[L]);
      return `${PH.notWorked[L]}${rest}`;
    }
    if (/\d+ action\(s\) done|\bAssumptions: /.test(content)) {
      let s = content
        .replace(/(\d+) action\(s\) done/g, (_a, n: string) => doneText(L, n))
        .replace(/(\d+) not done/g, (_a, n: string) => notDoneText(L, n))
        .replace(/(\d+) waiting for approval/g, (_a, n: string) => waitingText(L, n))
        .replace(/(\d+) handed over/g, (_a, n: string) => handedText(L, n))
        .replace(/\bAssumptions: /g, PH.assumptions[L]);
      const i = s.indexOf(": ");
      if (localize && i > 0 && i < 200) s = `${localize(s.slice(0, i))}${s.slice(i)}`;
      return s;
    }
  } catch {
    return content;
  }
  return content;
}

/* ------------------------------------------------------------------------------------------------ display view */

export type CleanMemory<T extends MemoryLike> = T & { count?: number; raw?: string };

/** the rows of the memory tab: translated, duplicates merged (newest kept, ×N shown), empty and expired rows hidden */
export function memoryView<T extends MemoryLike>(rows: T[], lang: Lang, opts: { now?: number; localize?: (s: string) => string } = {}): CleanMemory<T>[] {
  const now = opts.now ?? Date.now();
  const out: CleanMemory<T>[] = [];
  const seen = new Map<string, CleanMemory<T>>();
  for (const r of rows) {
    if (!r || r.status === "expired") continue;
    if (r.expires_at && Date.parse(r.expires_at) <= now) continue;
    if (isEmptyMemoryContent(r.content)) continue;
    const shown = translateMemoryContent(r.content, lang, opts.localize);
    const key = [r.member_id ?? "-", r.layer, r.kind, r.status, memoryKey(shown)].join("|");
    const hit = seen.get(key);
    if (hit) {
      hit.count = (hit.count ?? 1) + 1;
      continue;
    }
    const row: CleanMemory<T> = { ...r, content: shown, raw: r.content };
    seen.set(key, row);
    out.push(row);
  }
  return out;
}

/** memoryView that can never break the page: any error → the rows exactly as they came */
export function safeMemoryView<T extends MemoryLike>(rows: T[], lang: Lang, opts: { now?: number; localize?: (s: string) => string } = {}): T[] {
  try {
    return memoryView(rows, lang, opts);
  } catch {
    return rows;
  }
}

/* ------------------------------------------------------------------------------------------------ write gate */

const ZERO_ACTIONS = /(^|[\s,.;:])(?:0 action\(s\) done|בוצעו 0 פעולות|تم تنفيذ 0 إجراءات)(?=[\s,.;]|$)/;
const ASSUMPTIONS = /\s(?:Assumptions|הנחות|افتراضات): [\s\S]*$/;

export interface GateResult<T> {
  items: T[];
  /** short counters for the activity log, e.g. "zero=1" */
  notes: string[];
}

export interface ExistingMemory {
  layer: string;
  kind: string;
  content: string;
  status?: string;
}

/**
 * Decides what is written as memory. Only ever makes the write SMALLER or less authoritative:
 * empty text → not written; an outcome with 0 actions done → not written; an exact repeat → not written;
 * the "Assumptions: …" tail of an outcome → separate "proposed" item (the team reads only active memory).
 */
export function gateMemoryWrites<T extends NewMemoryLike>(items: T[], existing: ExistingMemory[] = []): GateResult<T> {
  const out: T[] = [];
  const haveActive = new Set<string>();
  const haveProposed = new Set<string>();
  for (const e of existing) {
    const k = `${e.layer}|${e.kind}|${memoryKey(e.content)}`;
    if ((e.status ?? "active") === "proposed") haveProposed.add(k);
    else if ((e.status ?? "active") === "active") haveActive.add(k);
  }
  const seen = new Set<string>();
  const c = { empty: 0, zero: 0, assumptions: 0, duplicate: 0 };
  const push = (it: T) => {
    const k = `${it.layer}|${it.kind}|${memoryKey(it.content)}`;
    const dup = it.status === "active" ? haveActive.has(k) : haveActive.has(k) || haveProposed.has(k);
    if (dup || seen.has(`${it.status}|${k}`)) {
      c.duplicate++;
      return;
    }
    seen.add(`${it.status}|${k}`);
    out.push(it);
  };
  for (const it of items) {
    if (isEmptyMemoryContent(it.content)) {
      c.empty++;
      continue;
    }
    if (it.status === "active" && it.kind === "outcome") {
      if (ZERO_ACTIONS.test(it.content)) {
        c.zero++;
        continue;
      }
      const a = it.content.match(ASSUMPTIONS);
      if (a) {
        const rest = it.content.slice(0, a.index ?? it.content.length).trim();
        if (!isEmptyMemoryContent(rest)) push({ ...it, content: rest });
        push({ ...it, kind: "fact", content: a[0].trim().slice(0, 600), subject: null, confidence: Math.min(it.confidence, 0.4), status: "proposed" } as T);
        c.assumptions++;
        continue;
      }
    }
    push(it);
  }
  const notes = (Object.keys(c) as (keyof typeof c)[]).filter((k) => c[k] > 0).map((k) => `${k}=${c[k]}`);
  return { items: out, notes };
}

/** the gate that can never lose a memory by failing: any error → every item exactly as it was passed in */
export function safeGateMemoryWrites<T extends NewMemoryLike>(items: T[], existing: ExistingMemory[] = []): GateResult<T> {
  try {
    return gateMemoryWrites(items, existing);
  } catch {
    return { items, notes: [] };
  }
}

/** "Memory gate: zero=1 duplicate=2" in the business language, for the activity log display */
export function localizeGateSummary(text: string, lang: Lang): string {
  if (lang === "en" || typeof text !== "string" || !text.startsWith("Memory gate: ")) return text;
  try {
    const names: Record<string, { he: string; ar: string }> = {
      empty: { he: "ריקים", ar: "فارغة" },
      zero: { he: "תוצאות עם 0 פעולות", ar: "نتائج بصفر إجراءات" },
      assumptions: { he: "הנחות (הועברו לאישור)", ar: "افتراضات (للمراجعة)" },
      duplicate: { he: "כפילויות", ar: "مكررات" },
    };
    const parts = text
      .slice("Memory gate: ".length)
      .split(" ")
      .map((p) => p.split("="))
      .filter((p) => p.length === 2 && names[p[0] ?? ""])
      .map((p) => `${names[p[0] ?? ""]![lang]} ${p[1]}`);
    if (!parts.length) return text;
    return `${lang === "he" ? "סינון זיכרון לא נשמר: " : "تم تخطي حفظ في الذاكرة: "}${parts.join(", ")}`;
  } catch {
    return text;
  }
}
