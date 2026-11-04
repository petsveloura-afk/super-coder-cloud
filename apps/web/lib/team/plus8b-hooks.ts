// apps/web/lib/team/plus8b-hooks.ts  — חוזה בין שני המפתחים (חלק א יוצר stub, חלק ב דורס במימוש אמיתי)
import { gateOutbound, GATE_REASON_TEXT } from "./output-gate-core";
import { prioritizeByIntel, sanitizeInbound, type BoardRef, type TickTask } from "./team-intel-core";
export type Plus8bLang = "he" | "en" | "ar";
export type Plus8bTaskCtx = { orgId: string; taskId: string; memberRole: string; title: string; brief: string; lang: Plus8bLang };
// wave 64: the real pre-task hook — a short team briefing (time awareness, role boundary, colleagues' open work, urgency, the role's
// definition of "done", the roster for those who assign work). It only ADDS context and never blocks; any failure returns {}.
export async function preTask(ctx: Plus8bTaskCtx): Promise<{ extraContext?: string; blocked?: { reason: string } }> {
  try {
    const { briefingFor } = await import("./team-intel");
    const extraContext = await briefingFor(ctx);
    return extraContext ? { extraContext } : {};
  } catch {
    return {};
  }
}
// wave 64: outside text is data — hidden characters and fake control markers are neutralised, instruction-like text is labelled.
// Normal text comes back unchanged; a failure returns the text as it was.
export function guardInbound(text: string): { text: string; flags: string[] } {
  try {
    return sanitizeInbound(text);
  } catch {
    return { text, flags: [] };
  }
}
// wave 63: the real outbound gate (placeholders, leaked control lines, raw JSON, unfinished drafts) — see output-gate-core.ts.
// A failure inside the gate never blocks the team: it returns the text unchanged.
export function guardOutbound(text: string): { ok: boolean; text: string; reasons: string[] } {
  try {
    const g = gateOutbound(text);
    return { ok: g.ok, text: g.text, reasons: g.reasons.map((r) => GATE_REASON_TEXT[r]) };
  } catch {
    return { ok: true, text, reasons: [] };
  }
}
// wave 64: the real queue order — owner priority, due dates, age (no starvation), who is waiting, what unblocks other tasks.
// Stable: equal scores keep the incoming order. Any failure returns the tasks as they came.
export function prioritizeTasks<T extends { id: string }>(tasks: T[], ctx?: { board?: BoardRef[]; now?: number }): T[] {
  try {
    return prioritizeByIntel(tasks as (T & TickTask)[], ctx);
  } catch {
    return tasks;
  }
}
// wave 64: team harmony — routes tasks nobody owns and moves not-yet-started work off an overloaded employee to a free colleague
// with the same role (never the owner's own assignments; at most 3 changes, at most every 20 minutes per business).
export async function dailyTick(orgId: string, lang: Plus8bLang): Promise<void> {
  try {
    const { harmonyTick } = await import("./team-intel");
    await harmonyTick(orgId, lang);
  } catch {
    /* optional */
  }
}
