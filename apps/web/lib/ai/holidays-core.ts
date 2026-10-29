/**
 * Wave 55 — Israeli (Jewish) holidays for the opening-hours calendar, computed with the Hebrew
 * calendar built into Intl (no table to maintain, correct every year). Pure, unit-tested.
 * Days when businesses in Israel are usually closed: Rosh Hashanah (2 days), Yom Kippur, Sukkot,
 * Simchat Torah / Shemini Atzeret, Pesach first and last day, Shavuot.
 */
export type HolidayKey = "rosh_hashana" | "yom_kippur" | "sukkot" | "simchat_torah" | "pesach" | "pesach_end" | "shavuot";

const RULES: { month: string; day: number; key: HolidayKey }[] = [
  { month: "Tishri", day: 1, key: "rosh_hashana" },
  { month: "Tishri", day: 2, key: "rosh_hashana" },
  { month: "Tishri", day: 10, key: "yom_kippur" },
  { month: "Tishri", day: 15, key: "sukkot" },
  { month: "Tishri", day: 22, key: "simchat_torah" },
  { month: "Nisan", day: 15, key: "pesach" },
  { month: "Nisan", day: 21, key: "pesach_end" },
  { month: "Sivan", day: 6, key: "shavuot" },
];

let fmt: Intl.DateTimeFormat | null = null;
function hebrewParts(date: Date): { month: string; day: number } | null {
  try {
    fmt ??= new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: "UTC", day: "numeric", month: "long" });
    const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
    return { month: p.month ?? "", day: Number(p.day ?? 0) };
  } catch {
    return null;
  }
}

/** Holiday dates ("YYYY-MM-DD", Gregorian) from `from` for `days` days, in order. */
export function israeliHolidays(from: string, days = 380): { date: string; key: HolidayKey }[] {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T12:00:00Z`) : new Date();
  const out: { date: string; key: HolidayKey }[] = [];
  for (let i = 0; i < Math.min(Math.max(days, 1), 800); i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const h = hebrewParts(d);
    if (!h) return [];
    const rule = RULES.find((r) => r.month === h.month && r.day === h.day);
    if (rule) out.push({ date: d.toISOString().slice(0, 10), key: rule.key });
  }
  return out;
}

/** Adds the holidays to existing closed dates (unique, sorted, bounded like the form: 60 — the oldest drop first). */
export function mergeClosedDates(existing: string[], add: string[], max = 60): string[] {
  return [...new Set([...existing, ...add].filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort().slice(-max);
}
