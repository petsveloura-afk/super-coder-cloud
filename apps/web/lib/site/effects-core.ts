/**
 * Site effects — the pure parts (unit-tested): reading a stats value ("1,200+", "98%", "₪350", "4.9★", "15 שנים")
 * into a number that can count up, and writing the counting value back in exactly the same shape.
 */
export interface CountTarget {
  value: number;
  prefix: string;
  suffix: string;
  decimals: number;
  grouping: boolean;
}

/** null when the text has no number to count (then the effect leaves it alone) */
export function countTarget(text: string | null | undefined): CountTarget | null {
  const s = (text ?? "").trim();
  const m = /^(\D*?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(.*)$/s.exec(s);
  if (!m) return null;
  const intPart = m[2]!;
  const decimals = m[3] ? Math.min(2, m[3].length) : 0;
  const value = Number(`${intPart.replace(/,/g, "")}${m[3] ? `.${m[3].slice(0, 2)}` : ""}`);
  if (!Number.isFinite(value) || value <= 0 || value > 1e9) return null;
  return { value, prefix: m[1] ?? "", suffix: m[4] ?? "", decimals, grouping: intPart.includes(",") };
}

export function formatCount(t: CountTarget, current: number): string {
  const v = Math.min(t.value, Math.max(0, current));
  let num = t.decimals ? v.toFixed(t.decimals) : String(Math.round(v));
  if (t.grouping) {
    const [i, d] = num.split(".");
    num = `${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${d ? `.${d}` : ""}`;
  }
  return `${t.prefix}${num}${t.suffix}`;
}

export const EFFECT_LEVELS = ["none", "subtle", "rich"] as const;
export const DIVIDERS = ["none", "wave", "curve", "slant"] as const;
