/**
 * Follow-up playbook (pure, unit-tested) — every follow-up of the same silence has its own job, like the best sales
 * teams do it, but always honest and respectful:
 *   nudge  (1st)        a short, personal pattern-interrupt about exactly what they wanted + a one-tap question
 *   angle  (middle)     a NEW reason: one real benefit / answer to their doubt from the business data, different words
 *   close  (last, 2+)   "closing the loop": we won't keep writing, the door stays open, how to come back — no guilt
 * Plus the rules that stop the agent from inventing pressure (fake "only 2 spots left", fake deadlines / discounts),
 * the night window, and what counts as "the customer already booked / bought".
 */
export type FollowupStage = "nudge" | "angle" | "close";

export function followupStage(step: number, max: number): FollowupStage {
  const s = Math.max(1, Math.round(Number(step) || 1));
  const m = Math.max(1, Math.round(Number(max) || 1));
  if (s >= m && m >= 2) return "close";
  if (s === 1) return "nudge";
  return "angle";
}

export const FOLLOWUP_HONESTY = [
  "Honesty rules (never break them):",
  "- NEVER invent scarcity, urgency, deadlines, discounts, prices, free slots or 'others are waiting'. Mention limited availability, a deadline or an offer ONLY if it appears in the business information or in the real free slots given to you.",
  "- Never guilt-trip, never accuse ('you didn't answer me'), never mention that you will contact them on another app, never pretend to be a human if asked.",
  "- One message, short, in the customer's language, no greeting formulas like 'Dear customer'.",
].join("\n");

const STAGE_TEXT: Record<FollowupStage, string> = {
  nudge:
    "This is the FIRST follow-up of this silence. Write ONE short, warm, personal follow-up (1–2 sentences) that refers to exactly what they asked about and ends with an easy one-tap question (yes/no or a choice between two options, e.g. two real time options if you have them). Fresh wording that stands out — not a reminder template.",
  angle:
    "The customer still has not answered your earlier follow-up. Write ONE short message (1–2 sentences) with a NEW angle: one concrete benefit or fact from the business information that answers what probably holds them back (or their stated doubt), then a soft yes/no question. Completely different words than before, zero pressure.",
  close:
    "This is the LAST follow-up of this silence. Write ONE respectful 'closing the loop' message (1–2 sentences): you understand the timing may not be right, you will not keep writing about this, and they can simply reply here whenever they want to continue. Warm, no guilt, no offer that is not in the business information.",
};

/** the instruction for this follow-up (stage + honesty rules) */
export function playbookInstruction(step: number, max: number): string {
  return `${STAGE_TEXT[followupStage(step, max)]}\n\n${FOLLOWUP_HONESTY}`;
}

/* ------------------------------------------------------------------ the night window */

const hm = (s: string | null | undefined): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** minutes since midnight in the business time zone (Asia/Jerusalem when unknown / invalid) */
export function localMinutes(now: Date, tz: string | null | undefined): number {
  const fmt = (zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(tz || "Asia/Jerusalem");
  } catch {
    parts = fmt("Asia/Jerusalem");
  }
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + m;
}

export const NIGHT_START = "21:30";
export const NIGHT_END = "08:30";

/**
 * Should a follow-up wait now? Only when the business did NOT set its own quiet hours (those are already enforced by
 * the database guard) and the night guard is on. Returns the minutes to wait until the morning, or 0.
 */
export function nightWaitMinutes(input: { now: Date; tz?: string | null; quietStart?: string | null; quietEnd?: string | null; nightGuard?: boolean | null }): number {
  if (input.nightGuard === false) return 0;
  if (hm(input.quietStart) !== null && hm(input.quietEnd) !== null) return 0;
  const lt = localMinutes(input.now, input.tz);
  const s = hm(NIGHT_START)!;
  const e = hm(NIGHT_END)!;
  if (lt >= s) return 24 * 60 - lt + e;
  if (lt < e) return e - lt;
  return 0;
}

/* ------------------------------------------------------------------ already booked / bought */

export interface ConversionFacts {
  /** start times of the contact's appointments that are scheduled / confirmed */
  upcomingAppointments: string[];
  /** close times of the contact's won deals */
  wonDeals: (string | null)[];
}

/** "converted" → the sales follow-up is no longer needed (an upcoming appointment, or a deal won in the last 30 days) */
export function convertedReason(f: ConversionFacts, now: Date = new Date()): "booked" | "bought" | null {
  const t = now.getTime();
  if (f.upcomingAppointments.some((s) => Date.parse(s) >= t - 60 * 60_000)) return "booked";
  if (f.wonDeals.some((c) => c !== null && Date.parse(c) >= t - 30 * 86_400_000)) return "bought";
  return null;
}

/** policy reader (defaults = the database defaults) */
export function followupPolicy(p: Record<string, unknown> | null | undefined) {
  const o = p ?? {};
  return {
    max: Math.max(1, Math.min(5, Number(o.followup_max ?? 1) || 1)),
    playbook: o.followup_playbook !== false,
    stopOnConvert: o.followup_stop_on_convert !== false,
    nightGuard: o.followup_night_guard !== false,
    crossChannel: o.followup_cross_channel === true,
    quietStart: typeof o.quiet_start === "string" ? o.quiet_start : null,
    quietEnd: typeof o.quiet_end === "string" ? o.quiet_end : null,
  };
}

/** channels a follow-up may move to when the WhatsApp window closed (a conversation the customer opened there) */
export const CROSS_CHANNELS = ["telegram", "email", "messenger", "instagram", "sms", "whatsapp"] as const;
