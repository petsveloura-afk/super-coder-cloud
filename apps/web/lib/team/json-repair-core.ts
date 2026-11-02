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
