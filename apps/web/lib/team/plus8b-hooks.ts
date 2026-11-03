// apps/web/lib/team/plus8b-hooks.ts  — חוזה בין שני המפתחים (חלק א יוצר stub, חלק ב דורס במימוש אמיתי)
export type Plus8bLang = "he" | "en" | "ar";
export type Plus8bTaskCtx = { orgId: string; taskId: string; memberRole: string; title: string; brief: string; lang: Plus8bLang };
export async function preTask(_ctx: Plus8bTaskCtx): Promise<{ extraContext?: string; blocked?: { reason: string } }> { return {}; }
export function guardInbound(text: string): { text: string; flags: string[] } { return { text, flags: [] }; }
export function guardOutbound(text: string): { ok: boolean; text: string; reasons: string[] } { return { ok: true, text, reasons: [] }; }
export function prioritizeTasks<T extends { id: string }>(tasks: T[]): T[] { return tasks; }
export async function dailyTick(_orgId: string, _lang: Plus8bLang): Promise<void> { return; }
