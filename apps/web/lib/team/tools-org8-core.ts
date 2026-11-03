/**
 * Upgrade 8 / stage B — additional tools and role grants for the professional organisation (pure data). Merged into the catalog by
 * tools-core (TOOLS.push) and into an employee's allowed tools by withRoleExtrasOrg8 — a SEPARATE function: withRoleExtras,
 * withRoleExtras7 and withRoleExtras7c are unchanged. Everything here is internal: nothing contacts a customer or spends money.
 * `sop.propose` only PROPOSES: a change to a procedure waits for the owner.
 */
import type { ToolSpec } from "./tools-core";

export const UPGRADE8_ORG_TOOLS: ToolSpec[] = [
  { key: "sop.lookup", kind: "read", sensitivity: "internal", permission: "ai.use", args: { "query!": "string" }, about: "Find the company's standard operating PROCEDURE (SOP) for a kind of task: purpose, steps, success measure, escalation conditions and what needs the owner's approval. A procedure never replaces the approval rules." },
  { key: "sop.propose", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "title!": "string", "body!": "string", sop_key: "string", dept: "string", trigger: "string", purpose: "string", success_metric: "string", escalation: "string", approvals: "string" }, about: "PROPOSE a new procedure or a change to one (body = the steps separated by |; dept: sales|marketing|service|operations|finance|management; approvals = what needs the owner's approval, separated by |). It waits for the owner — it is never applied by you." },
];

/** every employee may look a procedure up; the manager and the team lead may propose (department heads get the grant at run time) */
export const ROLE_EXTRA_TOOLS_ORG8: Record<string, string[]> = {
  manager: ["sop.lookup", "sop.propose"],
  team_lead: ["sop.lookup", "sop.propose"],
  customer_service: ["sop.lookup"],
  sales: ["sop.lookup"],
  marketing: ["sop.lookup"],
  content_writer: ["sop.lookup"],
  web_builder: ["sop.lookup"],
  analyst: ["sop.lookup"],
  project_coordinator: ["sop.lookup"],
  quality_control: ["sop.lookup"],
  collections: ["sop.lookup"],
  reputation: ["sop.lookup"],
  custom: ["sop.lookup"],
};

/** union, order-preserving, never removes anything the member already has (applied after withRoleExtras7c) */
export function withRoleExtrasOrg8(role: string, tools: string[]): string[] {
  return [...new Set([...(tools ?? []), ...(ROLE_EXTRA_TOOLS_ORG8[role] ?? [])])];
}

/** a department head who is not a manager / team lead also gets the right to propose */
export function withHeadGrant(tools: string[], isHead: boolean): string[] {
  return isHead ? [...new Set([...(tools ?? []), "sop.lookup", "sop.propose"])] : tools;
}
