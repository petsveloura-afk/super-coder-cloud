import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { budgetLine, deptName, effectiveDailyCap, type Lang } from "./departments-core";

/**
 * Upgrade 8 / stage B — glue between the runner and the organisation layer. Every function fails soft: an error returns "nothing
 * to add" and the task runs exactly as before. runner.ts only calls these (small additions); nothing here changes existing behaviour
 * unless the owner set something (a department budget, a procedure).
 */

/** a department head who is not manager / team lead may also propose procedure changes (the tool list of THIS run only) */
export async function grantHeadTools(orgId: string, member: { id: string; tools: string[] }): Promise<void> {
  try {
    const { isDeptHead } = await import("./org8-data");
    const { withHeadGrant } = await import("./tools-org8-core");
    if (await isDeptHead(orgId, member.id)) member.tools = withHeadGrant(member.tools, true);
  } catch {
    /* optional */
  }
}

/**
 * The department's credit budget in addition to the daily cap: returns the cap and used values the engine should use for this task when the
 * department's remaining budget is the tighter one; null when there is no department budget or the business cap is tighter.
 */
export async function deptCapFor(orgId: string, memberId: string, global: { cap: number; used: number }, lang: Lang = "he"): Promise<{ cap: number; used: number; line: string } | null> {
  try {
    const { loadDeptState } = await import("./org8-data");
    const st = await loadDeptState(orgId);
    if (!st.available) return null;
    const mine = st.placements.find((p) => p.member_id === memberId)?.dept_key;
    if (!mine) return null;
    const budget = st.rows.find((r) => r.dept_key === mine)?.credit_budget ?? 0;
    if (!(budget > 0)) return null;
    const ids = st.placements.filter((p) => p.dept_key === mine).map((p) => p.member_id);
    const { data } = await createAdminClient().from("team_tasks").select("credits_used").eq("organization_id", orgId).in("assignee_id", ids).gte("updated_at", new Date(Date.now() - 86_400_000).toISOString());
    const used = ((data ?? []) as { credits_used: number }[]).reduce((s, r) => s + (r.credits_used || 0), 0);
    const eff = effectiveDailyCap(global, { budget, used });
    if (eff.by !== "department") return null;
    return { cap: eff.cap, used: eff.used, line: budgetLine(deptName(mine, lang), budget, used, lang) };
  } catch {
    return null;
  }
}

/** the organisation blocks of the employee's context (the matching procedure; later stages add the job profile): "" when nothing applies */
export async function orgContextFor(orgId: string, _member: { id: string; role: string }, taskText: string, lang: Lang): Promise<string> {
  const parts: string[] = [];
  try {
    const { sopPromptFor } = await import("./org8-data");
    const raci = await raciForPrompt(orgId, taskText, lang);
    const b = await sopPromptFor(orgId, taskText, lang, raci);
    if (b) parts.push(b);
  } catch {
    /* optional */
  }
  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ stage B3 — the approval matrix (can only tighten) */

/**
 * Does the approval matrix hold this action for the owner? Called by runner.ts for every tool the engine already decided to EXECUTE
 * (an action that already waits for approval, or is blocked, never comes here — so the matrix can only add an approval). Fails soft:
 * any error → null → the action runs exactly as before.
 */
export async function raciHold(orgId: string, tool: string, args: Record<string, string | number>, lang: Lang = "he"): Promise<{ reason: string; sensitivity: "customer" | "money"; ruleId: string } | null> {
  try {
    const { TOOL_MAP } = await import("./tools-core");
    const spec = TOOL_MAP[tool];
    if (!spec || spec.kind === "read") return null;
    const [{ matrixFor }, { matrixCheck, holdReason, tighten }] = await Promise.all([import("./org8-stageb-data"), import("./raci-core")]);
    const hit = matrixCheck(tool, args, await matrixFor(orgId));
    if (!hit) return null;
    // the combination rule lives in raci-core: only an "execute" can become an approval
    const d = tighten({ do: "execute" }, hit);
    if (d.do !== "approve") return null;
    return { reason: holdReason(hit, lang), sensitivity: hit.sensitivity === "money" ? "money" : "customer", ruleId: hit.ruleId };
  } catch {
    return null;
  }
}

/** the responsibility line of the procedure block: { R, A, C, I } for the procedure that fits the task; null when none fits */
export async function raciForPrompt(orgId: string, taskText: string, lang: Lang): Promise<{ R?: string; A?: string; C?: string[]; I?: string[] } | null> {
  try {
    const [{ loadRaciState }, { raciForTask, raciPromptOpt }] = await Promise.all([import("./org8-stageb-data"), import("./raci-core")]);
    const st = await loadRaciState(orgId);
    return raciPromptOpt(raciForTask(taskText, st.roles, lang));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ stage B4 — department SLA */

/** the one SLA line for the morning brief / weekly report (null when everything is fine or nothing can be measured) */
export async function slaBriefLine(orgId: string, lang: Lang): Promise<string | null> {
  try {
    const { slaLineFor } = await import("./org8-stageb-data");
    return await slaLineFor(orgId, lang);
  } catch {
    return null;
  }
}

/** the daily organisation tick (runner.ts calls it once per tick; it never throws and never blocks the clock) */
export async function orgDailyTick(orgId: string, lang: Lang): Promise<void> {
  try {
    const { slaAlertTick } = await import("./org8-stageb-data");
    await slaAlertTick(orgId, lang);
  } catch {
    /* optional */
  }
}
