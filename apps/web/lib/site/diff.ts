/**
 * Wave 33 — "what did the agent change?" — pure, unit-tested, no dependencies.
 *
 * Compares two versions of a site (the editor state before and after an agent edit)
 * and reports which sections were added / changed / removed and which design or SEO
 * settings moved. The editor uses it to highlight sections, scroll to the first change
 * and show a readable summary — so an edit is never invisible.
 */
export interface DiffBlock {
  type: string;
  data: unknown;
}
export interface DiffSite {
  name?: string;
  theme?: Record<string, unknown>;
  seo?: { title?: string; description?: string };
  blocks: DiffBlock[];
}
export interface BlockChange {
  /** index in the NEW block list (for removed: index in the OLD list) */
  index: number;
  type: string;
  kind: "added" | "changed" | "removed";
}
export interface SiteDiff {
  blocks: BlockChange[];
  /** indexes (in the new list) of added + changed sections, ascending */
  touched: number[];
  added: number;
  changed: number;
  removed: number;
  /** theme keys whose value moved (template, accent, accent2, font, radius, mode, animations) */
  theme: string[];
  seo: boolean;
  name: boolean;
  /** true when nothing at all changed */
  empty: boolean;
}

const key = (b: DiffBlock) => `${b.type}\u0000${stableStringify(b.data)}`;

/** JSON.stringify with sorted keys, so key order never counts as a change. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function diffSites(prev: DiffSite, next: DiffSite): SiteDiff {
  const a = prev.blocks.map(key);
  const b = next.blocks.map(key);
  // longest common subsequence → the blocks that stayed exactly as they were
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const keptOld = new Set<number>();
  const keptNew = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      keptOld.add(i);
      keptNew.add(j);
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  const oldLeft = prev.blocks.map((_, i) => i).filter((i) => !keptOld.has(i));
  const newLeft = next.blocks.map((_, j) => j).filter((j) => !keptNew.has(j));
  // pair leftovers of the same type in order → "changed"; the rest are removed / added
  const usedOld = new Set<number>();
  const changes: BlockChange[] = [];
  for (const j of newLeft) {
    const type = next.blocks[j]!.type;
    const o = oldLeft.find((i) => !usedOld.has(i) && prev.blocks[i]!.type === type);
    if (o !== undefined) {
      usedOld.add(o);
      changes.push({ index: j, type, kind: "changed" });
    } else changes.push({ index: j, type, kind: "added" });
  }
  for (const i of oldLeft) if (!usedOld.has(i)) changes.push({ index: i, type: prev.blocks[i]!.type, kind: "removed" });

  const themeKeys = new Set([...Object.keys(prev.theme ?? {}), ...Object.keys(next.theme ?? {})]);
  const theme = [...themeKeys].filter((k) => stableStringify((prev.theme ?? {})[k] ?? null) !== stableStringify((next.theme ?? {})[k] ?? null));
  const seo = stableStringify(prev.seo ?? {}) !== stableStringify(next.seo ?? {});
  const name = (prev.name ?? "") !== (next.name ?? "");
  const touched = changes
    .filter((c) => c.kind !== "removed")
    .map((c) => c.index)
    .sort((x, y) => x - y);
  const count = (k: BlockChange["kind"]) => changes.filter((c) => c.kind === k).length;
  // a pure re-ordering (same blocks, different order) also counts as a change
  const reordered = changes.length === 0 && a.some((k, i) => k !== b[i]);
  return {
    blocks: changes.sort((x, y) => x.index - y.index),
    touched,
    added: count("added"),
    changed: count("changed"),
    removed: count("removed"),
    theme,
    seo,
    name,
    empty: !changes.length && !theme.length && !seo && !name && !reordered,
  };
}
