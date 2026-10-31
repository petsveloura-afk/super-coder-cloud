/**
 * Wave 59 — automatic outbound calls by the phone agent (pure, unit-tested):
 *   • a reminder call before an appointment (confirm / reschedule) — a service call to a customer who booked;
 *   • a call back to a lead that went quiet — ONLY to contacts who gave marketing consent (anti-spam law).
 * Business hours only, a daily cap, never twice for the same appointment / lead.
 */

export type CallPurpose = "reminder" | "callback" | "test" | "manual";

export const DAILY_CALL_CAP = 20;

/** Reminder window: appointments that start in 20–28 hours. */
export function reminderWindow(now: Date): { from: string; to: string } {
  return { from: new Date(now.getTime() + 20 * 3600_000).toISOString(), to: new Date(now.getTime() + 28 * 3600_000).toISOString() };
}

/** Calls go out only at a polite hour in the business's time zone (Sun–Thu 9–19, Fri 9–13, no Saturday). */
export function politeHour(now: Date, timeZone = "Asia/Jerusalem"): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  if (wd === "Sat") return false;
  if (wd === "Fri") return h >= 9 && h < 13;
  return h >= 9 && h < 19;
}

/** A lead worth a call back: became a lead 2–7 days ago, not won, and the customer has been quiet for 48h. */
export function callbackCandidate(input: { leadAt: string | null; lastCustomerAt: string | null; salesState: string | null; consent: boolean; optedOut: boolean; now: Date }): boolean {
  if (!input.consent || input.optedOut || !input.leadAt) return false;
  if (["won", "lost", "closed"].includes(String(input.salesState ?? ""))) return false;
  const age = input.now.getTime() - new Date(input.leadAt).getTime();
  if (age < 2 * 86_400_000 || age > 7 * 86_400_000) return false;
  const quiet = input.lastCustomerAt ? input.now.getTime() - new Date(input.lastCustomerAt).getTime() : Infinity;
  return quiet >= 48 * 3600_000;
}

/** What the agent should do in this call (added to the phone brain's system prompt). */
export function purposeBrief(purpose: CallPurpose | null | undefined, note?: string | null): string {
  const n = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (purpose === "reminder")
    return `CALL PURPOSE: a friendly reminder about the customer's appointment${n ? ` (${n})` : ""}. Greet, say who you are, remind the date and time, ask to confirm. If they cannot come, offer to reschedule (use the booking tool) or note it for the team. Keep it under a minute.`;
  if (purpose === "callback")
    return `CALL PURPOSE: a follow-up call to a customer who showed interest a few days ago${n ? ` (${n})` : ""}. Greet, say who you are and why you call, ask if it is a good time. If yes — continue from where they stopped and help them decide (one clear next step). If not — ask when to call back and end politely. If they ask not to be called — apologise, confirm and end.`;
  return "";
}
