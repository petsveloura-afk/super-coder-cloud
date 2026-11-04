// apps/web/lib/team/plus8b-hooks.ts  — חוזה בין שני המפתחים (חלק א יוצר stub, חלק ב דורס במימוש אמיתי)
import { gateOutbound, GATE_REASON_TEXT } from "./output-gate-core";
export type Plus8bLang = "he" | "en" | "ar";
export type Plus8bTaskCtx = { orgId: string; taskId: string; memberRole: string; title: string; brief: string; lang: Plus8bLang };
export async function preTask(_ctx: Plus8bTaskCtx): Promise<{ extraContext?: string; blocked?: { reason: string } }> { return {}; }
export function guardInbound(text: string): { text: string; flags: string[] } { return { text, flags: [] }; }
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
export function prioritizeTasks<T extends { id: string }>(tasks: T[]): T[] { return tasks; }
export async function dailyTick(_orgId: string, _lang: Plus8bLang): Promise<void> { return; }
