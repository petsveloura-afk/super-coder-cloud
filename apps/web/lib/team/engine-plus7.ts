/**
 * Upgrade 7 / stages D + E — the understanding and decision layer around the work cycle, as a WRAPPER over EngineDeps.
 * engine-core.ts is not changed: the wrapper adds a pre-read of the request and a decision-record request to the plan prompt,
 * and classifies the route in plain code. Routing:
 *   fast  one extra short instruction, no extra model call;
 *   deep  (only when classifyRoute says risk) one repair call for options + pre-mortem when the plan lacked them, and one
 *         independent audit call. If the audit does not approve, customer / money / irreversible actions are turned into ONE
 *         owner approval each (with the reasoning attached) instead of running.
 * Everything fails soft: any error inside the layer leaves the original behaviour untouched.
 */
import { firstJsonObject as firstJsonObjectStrict } from "@/lib/operator/operator-core";
import { firstJsonObjectTolerant } from "./json-repair-core";
import type { AiResult, EngineDeps, EngineMember, EngineTask, ToolRun } from "./engine-core";
import { DECISION_FORMAT_DEEP, DECISION_FORMAT_FAST, decisionLanguageLine, appendRecord, approvalNote, auditDecision, auditorPrompt, classifyRoute, combineAudit, parseAuditVerdict, parseDecision, type DecisionDraft, type DecisionRecord, type FinalAudit, type Route, type Sensitivity } from "./decision-core";
import { askOrAssume, calibrate, errorCost, understand, understandingPrompt, type CalibrationBin, type Understanding } from "./understanding-core";

export interface LayerOptions {
  member: Pick<EngineMember, "id" | "name">;
  task: Pick<EngineTask, "id" | "title" | "brief">;
  /** the sensitivity of a tool key (null when unknown) */
  sensitivityOf: (tool: string) => Sensitivity | null;
  /** every price / fact text the business stated (for the invented-price check) */
  known?: string;
  knownServices?: string[];
  calibration?: CalibrationBin[];
  /** called once with the finished record (the server stores it append-only); failures are swallowed */
  persist?: (record: DecisionRecord) => Promise<void>;
  now?: () => number;
  newId?: () => string;
}

export interface LayerState {
  pre: Understanding | null;
  route: Route;
  routeReasons: string[];
  draft: DecisionDraft | null;
  audit: FinalAudit | null;
  gate: boolean;
  record: DecisionRecord | null;
  /** ids of approvals the layer created itself (the runner adds them to the outcome) */
  heldApprovals: string[];
}

const parse = (raw: string): Record<string, unknown> | null => (firstJsonObjectStrict(raw) ?? firstJsonObjectTolerant(raw)) as Record<string, unknown> | null;

export function withDecisionLayer(deps: EngineDeps, o: LayerOptions): EngineDeps & { layer: LayerState } {
  const state: LayerState = { pre: null, route: "fast", routeReasons: [], draft: null, audit: null, gate: false, record: null, heldApprovals: [] };
  const text = `${o.task.title}\n${o.task.brief}`.slice(0, 3000);
  let preBlock = "";
  let preConf = 0.5;
  try {
    const u = understand(text, { knownServices: o.knownServices });
    state.pre = u;
    preConf = calibrate(u.confidence, o.calibration ?? []);
    const policy = askOrAssume({ intent: u.intent, missing: u.missing, confidence: preConf }, errorCost(u), deps.lang);
    if (u.intent !== "unknown" && u.intent !== "info") preBlock = understandingPrompt(u, policy, preConf);
    const r = classifyRoute({ text, cost: errorCost(u), confidence: preConf, amounts: u.entities.amounts.map((a) => a.value) });
    state.route = r.route;
    state.routeReasons = r.reasons;
  } catch {
    /* the pre-read is a bonus */
  }

  const finishPlan = async (res: AiResult, system: string): Promise<AiResult> => {
    let extra = 0;
    try {
      const plan = parse(res.text);
      let draft = parseDecision(res.text);
      // the real route, now that the plan's steps are known (code decides, not the model)
      const steps = (Array.isArray(plan?.steps) ? plan!.steps : []).map((s) => String((s as Record<string, unknown>)?.tool ?? "")).filter(Boolean);
      const d0 = plan?.deliverable && typeof plan.deliverable === "object" ? (plan.deliverable as Record<string, unknown>) : {};
      const customerFacing = d0.customer_facing === true || ["message", "review_reply", "reminder"].includes(String(d0.type));
      const rc = classifyRoute({ steps: steps.map((t) => ({ tool: t, sensitivity: o.sensitivityOf(t) ?? "internal" })), customerFacing, text, cost: state.pre ? errorCost(state.pre) : undefined, confidence: preConf, amounts: state.pre?.entities.amounts.map((a) => a.value) });
      state.route = rc.route === "deep" || state.route === "deep" ? "deep" : "fast";
      state.routeReasons = [...new Set([...state.routeReasons, ...rc.reasons])];
      if (!draft) {
        const understood = typeof plan?.understanding === "string" ? plan.understanding.slice(0, 400) : o.task.title;
        draft = { understood, decided: typeof d0.instructions === "string" ? d0.instructions.slice(0, 300) : "", why: "", confidence: 0.4, would_change_mind: [], options: [], chosen: null, premortem: null };
      }
      if (state.route === "deep") {
        // missing options / pre-mortem → ONE repair call, only on the deep path
        const first = auditDecision(draft, { route: "deep", known: o.known, customerFacing });
        if (!first.passed && first.failures.some((f) => /options|premortem|tripwire|chosen/.test(f)) && res.ok) {
          const fix = await deps.ai("plan", system, `${o.task.title}\n${o.task.brief.slice(0, 1500)}\n\nThis task is risky (${state.routeReasons.join(", ")}). Your plan so far: ${JSON.stringify({ understanding: plan?.understanding, steps }).slice(0, 1200)}\n${DECISION_FORMAT_DEEP}\nAnswer with ONE JSON object that has the key "decision" only.`, 900);
          extra += fix.credits;
          const repaired = fix.ok ? parseDecision(fix.text) : null;
          if (repaired) draft = { ...draft, ...repaired, understood: repaired.understood || draft.understood };
        }
        const det = auditDecision(draft, { route: "deep", known: o.known, customerFacing });
        let model: ReturnType<typeof parseAuditVerdict> | "not_run" = "not_run";
        const au = await deps.ai("review", "You are an independent internal auditor for a small business's AI team. Be concise and specific.", auditorPrompt(draft, "deep", state.routeReasons), 500);
        extra += au.credits;
        if (au.ok) model = parseAuditVerdict(au.text);
        state.audit = combineAudit(det, model);
        state.gate = state.audit.verdict !== "approve";
      } else {
        const det = auditDecision(draft, { route: "fast", known: o.known, customerFacing });
        state.audit = combineAudit(det, "not_run");
      }
      state.draft = draft;
      const calibrated = calibrate(draft.confidence, o.calibration ?? []);
      const log: DecisionRecord[] = [];
      const rec = appendRecord(log, draft, { id: o.newId?.() ?? `${o.task.id}:${Date.now()}`, task_id: o.task.id, member_id: o.member.id, route: state.route, route_reasons: state.routeReasons, confidence: calibrated, audit: state.audit, now: o.now?.() ?? Date.now() })[0]!;
      state.record = rec;
      await deps.log("plan", `Decision (${state.route}${state.routeReasons.length ? `: ${state.routeReasons.join(", ")}` : ""}) — ${draft.decided.slice(0, 160)} · confidence ${Math.round(calibrated * 100)}%${state.audit ? ` · audit: ${state.audit.verdict}` : ""}`, { route: state.route, reasons: state.routeReasons, audit: state.audit }, state.audit?.verdict !== "revise");
      if (o.persist) await o.persist(rec).catch(() => undefined);
    } catch {
      /* the layer never breaks the cycle */
    }
    return extra ? { ...res, credits: res.credits + extra } : res;
  };

  const wrapped: EngineDeps & { layer: LayerState } = {
    ...deps,
    layer: state,
    ai: async (kind, system, user, maxTokens) => {
      if (kind !== "plan") return deps.ai(kind, system, user, maxTokens);
      let add = "";
      try {
        add = [preBlock, state.route === "deep" ? `${DECISION_FORMAT_DEEP}\nRisk reasons: ${state.routeReasons.join(", ")}` : DECISION_FORMAT_FAST, decisionLanguageLine(deps.lang)].filter(Boolean).join("\n\n");
      } catch {
        add = "";
      }
      const res = await deps.ai(kind, system, add ? `${user}\n\n${add}` : user, maxTokens + (state.route === "deep" ? 700 : 250));
      return res.ok ? finishPlan(res, system) : res;
    },
    runTool: async (tool, args): Promise<ToolRun> => {
      const sens = o.sensitivityOf(tool);
      if (state.gate && state.record && sens && sens !== "internal") {
        try {
          const id = await deps.approval({ tool, payload: args, preview: JSON.stringify(args).slice(0, 1500), reason: `${approvalNote(state.record, deps.lang)} — ${state.audit?.issues.slice(0, 3).join("; ") ?? ""}`.slice(0, 1900), sensitivity: sens });
          if (id) state.heldApprovals.push(id);
          await deps.log("approval", `Held for the owner: ${tool} — the decision review did not approve it (${state.audit?.verdict}).`, { tool, audit: state.audit });
          return { ok: true, summary: "waiting for the owner's approval (decision review)" };
        } catch {
          /* fall through to the normal run only if the approval could not be written — the engine's own policy still applies */
        }
      }
      return deps.runTool(tool, args);
    },
    approval: async (input) => {
      let reason = input.reason;
      try {
        if (state.record) reason = `${input.reason} | ${approvalNote(state.record, deps.lang)}`.slice(0, 1900);
      } catch {
        reason = input.reason;
      }
      return deps.approval({ ...input, reason });
    },
  };
  return wrapped;
}
