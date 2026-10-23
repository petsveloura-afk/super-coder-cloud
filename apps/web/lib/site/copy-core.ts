/** Wave 17 — cleans an AI "improved text" answer (pure, unit-tested). */
export function cleanCopy(raw: string, originalLength: number): string | null {
  if (!raw) return null;
  let t = raw.trim();
  // drop a leading "Here is…:" line and surrounding quotes / code fences
  t = t.replace(/^```[a-z]*\s*|\s*```$/g, "").trim();
  t = t.replace(/^(?:here(?:'s| is)[^:\n]*:|הנה[^:\n]*:|إليك[^:\n]*:)\s*/i, "").trim();
  t = t.replace(/^["“”«»'״]+|["“”«»'״]+$/g, "").trim();
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  if (!t) return null;
  const max = Math.max(60, Math.round(originalLength * 2.5));
  return t.slice(0, Math.min(max, 3000));
}
