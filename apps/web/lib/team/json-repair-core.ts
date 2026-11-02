/**
 * Upgrade 4 — tolerant JSON recovery (pure). The strict parser in lib/social/brain-core.ts (parseWeekPlan) keeps its
 * exact behavior; this module is ONLY a fallback for answers it cannot read. Verified failure shapes (reproduced by
 * running the real parseWeekPlan): literal newlines inside strings, unescaped quotes inside Hebrew text (בע"מ),
 * trailing commas, an answer cut off mid-way (token limit), and a preamble that contains "[".
 */

export interface WeekPlanItem {
  post: string;
  pillar: string | null;
  scene: string | null;
  headline: string | null;
}

/** strips ``` fences and a BOM */
function unfence(raw: string): string {
  return (raw ?? "").replace(/^\uFEFF/, "").replace(/```(?:json)?/gi, "").trim();
}

/** removes trailing commas before } or ] (outside of strings it is safe enough: strings rarely contain ",}" ) */
export function stripTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

/** escapes raw control characters (real newlines / tabs) that appear inside JSON string literals */
export function escapeControlInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === "\\") {
        out += ch;
        esc = true;
      } else if (ch === '"') {
        // a quote that is not followed by a JSON structural character is part of the text (e.g. בע"מ) → escape it
        const next = s.slice(i + 1).match(/^\s*(.)/)?.[1] ?? "";
        if (next === "" || next === "," || next === "}" || next === "]" || next === ":") {
          inStr = false;
          out += ch;
        } else {
          out += '\\"';
        }
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "";
      else if (ch === "\t") out += "\\t";
      else out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

/** splits the text of a (possibly truncated) JSON array into its top-level object chunks, string-aware */
export function topLevelObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') {
        const next = s.slice(i + 1).match(/^\s*(.)/)?.[1] ?? "";
        if (next === "" || next === "," || next === "}" || next === "]" || next === ":") inStr = false;
      }
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(s.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out; // an unfinished last object (cut off) is simply not returned
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\\n/g, "\n").trim().slice(0, max) : "");

/** Tolerant version of parseWeekPlan: returns every COMPLETE post it can read, never invents one. */
export function parseWeekPlanTolerant(raw: string, max = 7): WeekPlanItem[] {
  const txt = unfence(raw);
  // start at the first "[" that is directly followed by an object (skips "[note]" in a preamble)
  const m = /\[\s*\{/.exec(txt);
  const body = m ? txt.slice(m.index) : txt;
  const items: WeekPlanItem[] = [];
  for (const chunk of topLevelObjects(body)) {
    try {
      const x = JSON.parse(stripTrailingCommas(escapeControlInStrings(chunk))) as Record<string, unknown>;
      const post = str(x.post, 2200) || str(x.text, 2200);
      if (post.length < 20) continue;
      items.push({ post, pillar: str(x.pillar, 80) || null, scene: str(x.scene, 400) || null, headline: str(x.headline, 120) || null });
    } catch {
      /* one unreadable object does not cost the rest */
    }
    if (items.length >= max) break;
  }
  return items;
}

/** one-line, honest diagnosis of why a plan answer could not be read (for logs / the failure queue) */
export function diagnosePlanAnswer(raw: string): "empty" | "no_json" | "truncated" | "malformed" | "ok" {
  const t = unfence(raw);
  if (!t) return "empty";
  if (!/\[\s*\{/.test(t)) return "no_json";
  const open = (t.match(/\{/g) ?? []).length;
  const close = (t.match(/\}/g) ?? []).length;
  if (!/\]\s*$/.test(t) && open > close) return "truncated";
  return parseWeekPlanTolerant(t).length ? "ok" : "malformed";
}

/**
 * Upgrade 6 (additive) — tolerant recovery of ONE JSON object (the employee's plan, the reviewer's verdict, the manager's
 * goal plan). Used ONLY after the strict `firstJsonObject` returned null, so a valid answer behaves exactly as before.
 * Handles: code fences / prose around the object, literal newlines and unescaped quotes inside strings, trailing commas,
 * smart quotes used as JSON quotes, and an answer cut off mid-way (it is closed at the last complete value — nothing is invented).
 */
function closeOpenStructures(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if ((ch === "}" || ch === "]") && stack.length) stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/[,:\s]+$/, "");
  // a dangling key without a value ("key") would break the parse → the caller trims back and retries
  return out + stack.reverse().join("");
}

export function firstJsonObjectTolerant(raw: string): Record<string, unknown> | null {
  const txt = unfence((raw ?? "").replace(/[\u201C\u201D]/g, '"'));
  const start = txt.indexOf("{");
  if (start < 0) return null;
  const body = txt.slice(start);
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(stripTrailingCommas(escapeControlInStrings(s)));
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  // 1 — the whole object as written (after cleanup)
  const end = body.lastIndexOf("}");
  if (end > 0) {
    const whole = attempt(body.slice(0, end + 1));
    if (whole) return whole;
  }
  // 2 — cut off: close what is open, trimming back to the previous comma until it parses (bounded)
  let cur = body;
  for (let i = 0; i < 60 && cur.length > 2; i++) {
    const closed = attempt(closeOpenStructures(cur));
    if (closed) return closed;
    const cut = cur.lastIndexOf(",");
    if (cut <= 0) break;
    cur = cur.slice(0, cut);
  }
  return null;
}
