/**
 * Following a task that the owner started from the screen (pure, unit-tested; additive). Decides, from the task's live status,
 * whether the screen keeps waiting, shows the result, starts it once more by itself (the engines were only busy / the run ran
 * out of time) or stops with the plain reason (budget, rules, a failed earlier task …).
 */
import { classifyFailure } from "./reliability-core";

export const FLOW_POLL_MS = 2500;
/** how long the screen follows one run before saying "it continues in the background" */
export const FLOW_MAX_MS = 150_000;
/** the pause before the screen starts the task again by itself */
export const FLOW_RETRY_WAIT_MS = 6000;
/** automatic extra tries from the screen (so 3 runs in total) */
export const FLOW_MAX_RETRIES = 2;

export type FlowStep = { kind: "wait" } | { kind: "done" } | { kind: "retry" } | { kind: "stop" };

export function flowStep(input: { status: string; error: string | null; retries: number }): FlowStep {
  const s = input.status;
  if (s === "pending" || s === "in_progress") return { kind: "wait" };
  if (s === "done" || s === "awaiting_approval" || s === "awaiting_input") return { kind: "done" };
  if (s === "failed") {
    const e = input.error ?? "";
    const temporary = e === "time_budget" || ["ai_busy", "network", "ai_unreadable"].includes(classifyFailure(e).kind);
    if (temporary && input.retries < FLOW_MAX_RETRIES) return { kind: "retry" };
    return { kind: "stop" };
  }
  // blocked / requires_connection / canceled / merged → the plain reason, never a silent retry
  return { kind: "stop" };
}

/** a log line made fit for the owner's screen: no uuids / "id …" / bracket noise / tool keys, one short line */
export function cleanLiveLine(text: string): string | null {
  const t = String(text ?? "")
    .replace(/\b(?:id\s*)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\[[^\]]{0,80}\]/g, "")
    .replace(/\b[a-z]+\.[a-z_]+:\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·:,—-]+|[\s·:,—-]+$/g, "")
    .trim();
  if (t.length < 3) return null;
  return t.length > 110 ? `${t.slice(0, 108)}…` : t;
}
