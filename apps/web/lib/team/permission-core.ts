/**
 * The digital team — a missing permission becomes a question to the owner, never a silent failure (pure, unit-tested).
 * When an employee's plan needs a platform tool it was not given, the engine opens ONE "grant permission" approval per task + tool:
 * the owner sees who needs what and why, approves in one click, the tool is added to that employee and the task runs again.
 */
export const GRANT_TOOL = "team.grant_tool";
export type Lang = "he" | "en" | "ar";

/** tools the owner can grant from an approval (every real platform tool except the team's own control tools) */
export function grantable(tool: string, known: Record<string, unknown>): boolean {
  return Boolean(known[tool]) && tool !== GRANT_TOOL && !tool.startsWith("team.");
}

export function grantPreview(lang: Lang, input: { member: string; tool: string; toolLabel?: string | null; task: string }): string {
  const what = input.toolLabel || input.tool;
  if (lang === "en") return `${input.member} needs permission to use "${what}" to finish: ${input.task}.\nApproving adds this permission to ${input.member} and runs the task again.`;
  if (lang === "ar") return `${input.member} يحتاج إذنًا لاستخدام "${what}" لإنهاء: ${input.task}.\nالموافقة تضيف هذا الإذن إلى ${input.member} وتشغّل المهمة من جديد.`;
  return `${input.member} צריך/ה הרשאה להשתמש ב"${what}" כדי לסיים את המשימה: ${input.task}.\nאישור מוסיף את ההרשאה ל${input.member} ומריץ את המשימה מחדש.`;
}

export function grantReason(lang: Lang, why: string): string {
  const w = why.slice(0, 300);
  if (lang === "en") return `Missing permission${w ? ` — ${w}` : ""}`;
  if (lang === "ar") return `إذن ناقص${w ? ` — ${w}` : ""}`;
  return `חסרה הרשאה${w ? ` — ${w}` : ""}`;
}

/** the employee's tools after the grant (no duplicates, nothing removed) */
export function withGrantedTool(tools: string[], tool: string): string[] {
  return tools.includes(tool) ? tools : [...tools, tool];
}
