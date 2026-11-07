import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("daily credit cap — never a silent stop", () => {
  it("the owner is told once a day (numbers + where to raise it); held tasks still resume by themselves", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain("export async function notifyCapHold(orgId: string): Promise<boolean> {");
    expect(r).toContain('.eq("kind", "team_cap").gte("created_at", new Date(Date.now() - 20 * 3600_000).toISOString())');
    expect(r).toContain("await notifyCapHold(orgId).catch(() => false);");
    expect(r).toContain("await resumeHeldTasks(orgId).catch(() => 0);");
  });
  it("the board says 'waiting for credits' and the screen shows today's use against the cap", () => {
    expect(read("components/ai-team/panels.tsx")).toContain('data-testid="task-cap"');
    expect(read("components/ai-team/team-screen.tsx")).toContain('data-testid="team-credit-meter"');
    for (const l of ["he", "en", "ar"]) {
      const a = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).aiTeam;
      expect(typeof a.capReached).toBe("string");
      expect(typeof a.board.waitingCap).toBe("string");
      expect(typeof a.summary.credits).toBe("string");
      expect(typeof a.run.tooFast).toBe("string");
    }
  });
});

describe("security parity for starting tasks from the screen", () => {
  it("a fresh start of a stopped task needs 'manage AI' (as the restart button); starts are rate limited per business", () => {
    const a = read("app/[locale]/(dashboard)/ai-team/run-actions.ts");
    expect(a).toContain('if (!g.ctx.can("ai.manage")) return { error: "errors.forbidden" };');
    expect(a).toContain('p_bucket: `team-start:${orgId}`, p_limit: 30, p_window_seconds: 60');
  });
});

describe("load: fair clock + agents inside the time limit", () => {
  it("businesses are visited from a rotating start; agents start only with enough time and end inside the call", () => {
    expect(read("lib/team/runner.ts")).toContain("const fairOrder = [...orgRows.slice(rot), ...orgRows.slice(0, rot)];");
    const t = read("app/api/bridge/tick/route.ts");
    expect(t).toContain("const agentsBudget = Math.min(25_000, 50_000 - (Date.now() - laneStart));");
    expect(t).toContain("return runAgentsCron(agentsBudget);");
  });
});

describe("credit cap root cause: counted by when the work ran", () => {
  it("the clock and the screen use the same count (started_at), with the old count as a fallback", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain("export async function dayCredits(orgId: string): Promise<number> {");
    expect(r).toContain('.gte("started_at", since).limit(1000);');
    expect(read("lib/team/page-data.ts")).toContain("dayCredits: await runner.dayCredits(org)");
  });
});
