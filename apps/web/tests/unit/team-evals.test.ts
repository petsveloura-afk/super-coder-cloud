import { describe, expect, it } from "vitest";
import { EVAL_SCENARIOS, orchestratorEvals, runEval } from "@/lib/team/evals";

/**
 * The digital team evaluation suite — the real engine against an exact mock model, per role.
 * Live-model scenarios run only with TEAM_EVAL_LIVE=1 (they need a real AI engine).
 */
describe("digital team — evaluation suite (mock model)", () => {
  for (const s of EVAL_SCENARIOS.filter((x) => !x.live)) {
    it(`[${s.role}] ${s.title}`, async () => {
      const r = await runEval(s);
      expect(r.failures, r.failures.join(" | ")).toEqual([]);
    });
  }
  it("orchestrator: valid DAG, cycles rejected, assignment by load, fallback to the lead", () => {
    for (const e of orchestratorEvals()) expect(e.pass, `${e.id}: ${e.failures.join(", ")}`).toBe(true);
  });
  it("live-model scenarios are marked separately", () => {
    expect(EVAL_SCENARIOS.filter((x) => x.live).length).toBeGreaterThan(0);
  });
});
