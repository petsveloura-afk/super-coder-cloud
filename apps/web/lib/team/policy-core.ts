/**
 * The digital team — who may do what, and when the person must approve (pure, unit-tested).
 *
 *   suggest  — the employee only proposes: every write action waits for approval
 *   approve  — internal actions run; anything customers see, money or irreversible waits for approval (default)
 *   auto     — internal actions run; customer-facing / money actions run ONLY when the person explicitly allowed that
 *              exact action for that employee (auto_actions); otherwise they wait for approval
 * Emergency stop freezes everything. A tool the employee does not have is blocked, never "approved".
 */
import { TOOL_MAP, type Sensitivity } from "./tools-core";
import type { Autonomy } from "./roles";

export type Decision = { do: "execute" } | { do: "approve"; sensitivity: Sensitivity; why: string } | { do: "blocked"; why: string };

export interface PolicyMember {
  tools: string[];
  autonomy: Autonomy;
  auto_actions: string[];
  status: "active" | "paused";
}

export interface PolicySettings {
  enabled: boolean;
  emergency_stop: boolean;
}

export function decide(tool: string, member: PolicyMember, settings: PolicySettings, ctx: { interactive?: boolean } = {}): Decision {
  const spec = TOOL_MAP[tool];
  if (!spec) return { do: "blocked", why: "unknown_tool" };
  if (settings.emergency_stop) return { do: "blocked", why: "emergency_stop" };
  if (!settings.enabled) return { do: "blocked", why: "team_off" };
  if (member.status !== "active") return { do: "blocked", why: "member_paused" };
  if (!member.tools.includes(tool)) return { do: "blocked", why: "tool_not_allowed" };
  if (spec.interactiveOnly && !ctx.interactive) return { do: "blocked", why: "needs_screen" };
  if (spec.kind === "read") return { do: "execute" };
  // asking the owner a question or handing to a colleague never needs approval — it IS the safe path
  if (tool === "team.ask_user" || tool === "team.handoff") return { do: "execute" };
  if (member.autonomy === "suggest") return { do: "approve", sensitivity: spec.sensitivity, why: "suggest_only" };
  if (spec.sensitivity === "internal") return { do: "execute" };
  if (member.autonomy === "auto" && member.auto_actions.includes(tool)) return { do: "execute" };
  return { do: "approve", sensitivity: spec.sensitivity, why: spec.sensitivity === "money" ? "money_action" : spec.sensitivity === "irreversible" ? "irreversible_action" : "customer_visible" };
}

/** loop / runaway protection for one task */
export interface Budget {
  depth: number;
  maxDepth: number;
  steps: number;
  maxSteps: number;
  credits: number;
  maxCredits: number;
  dayCredits: number;
  dayCap: number;
}

export function budgetStop(b: Budget): string | null {
  if (b.depth > b.maxDepth) return "depth_limit";
  if (b.steps >= b.maxSteps) return "step_limit";
  if (b.credits >= b.maxCredits) return "task_credit_limit";
  if (b.dayCap > 0 && b.dayCredits >= b.dayCap) return "daily_credit_cap";
  return null;
}

/**
 * A handoff loop: the same title is being handed around again (A → B → A …) or the chain is too deep.
 * `chain` = the titles + assignee roles of the task's ancestors (closest first).
 */
export function isLoop(next: { role: string; title: string }, chain: { role: string; title: string }[], maxDepth: number): boolean {
  if (chain.length >= maxDepth) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const t = norm(next.title);
  return chain.some((c) => c.role === next.role && (norm(c.title) === t || (t.length > 12 && norm(c.title).includes(t))));
}
