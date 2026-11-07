/**
 * Upgrade 9 — tools that close the "it said done but nothing exists" gap (pure data, additive). Merged into the catalog by
 * tools-core (TOOLS.push) and into an employee's allowed tools by withRoleExtras9 (never removes anything).
 *   • social.drafts      read  — the post drafts / scheduled posts that already exist (so a quality check reviews REAL drafts)
 *   • social.save_draft  write — saves a post the employee wrote AS-IS as a draft in the posts board. A draft never publishes:
 *                                the owner approves / schedules it on the posts board (internal sensitivity, like
 *                                social.draft_post).
 */
import type { ToolSpec } from "./tools-core";

export const UPGRADE9_TOOLS: ToolSpec[] = [
  { key: "social.drafts", kind: "read", sensitivity: "internal", permission: "campaigns.manage", args: { days: "number" }, about: "The post drafts and scheduled posts of the next / last N days (id, date, status, platforms, the text). Read this BEFORE reviewing, improving or scheduling posts — never say there is no draft without reading it." },
  { key: "social.save_draft", kind: "write", sensitivity: "internal", permission: "campaigns.manage", args: { "text!": "string", when_iso: "iso" }, about: "Save ONE finished post text exactly as written as a DRAFT on the posts board (a picture is added automatically). Drafts never publish by themselves — the owner approves them." },
];

export const ROLE_EXTRA_TOOLS9: Record<string, string[]> = {
  manager: ["social.drafts"],
  team_lead: ["social.drafts"],
  marketing: ["social.drafts", "social.save_draft"],
  content_writer: ["social.drafts", "social.save_draft"],
  // quality control can send work BACK to the writer with the exact fixes (before, it could only report)
  quality_control: ["social.drafts", "team.handoff"],
  analyst: ["social.drafts"],
};

export function withRoleExtras9(role: string, tools: string[]): string[] {
  return [...new Set([...(tools ?? []), ...(ROLE_EXTRA_TOOLS9[role] ?? [])])];
}
