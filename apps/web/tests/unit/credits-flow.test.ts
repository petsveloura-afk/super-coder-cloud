import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanLiveLine } from "@/lib/team/run-flow-core";
import { ownerFailure } from "@/lib/team/failure-reason-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("bought credits reach the team at once", () => {
  it("a purchase raises today's team cap and revives the tasks that stopped for credits — right after the payment", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain("export async function effectiveDayCap(orgId: string, cap: number): Promise<number> {");
    expect(r).toContain('.eq("kind", "ai").eq("reason", "purchase")');
    expect(r).toContain("daily_credit_cap: await effectiveDayCap(orgId, settings.daily_credit_cap)");
    expect(r).toContain("export async function creditsBackSince(orgId: string, sinceIso: string): Promise<boolean> {");
    expect(r).toContain("export async function reviveCreditTasks(orgId: string): Promise<number> {");
    expect(r).toContain("await reviveCreditTasks(orgId).catch(() => 0);");
    // the plan / usage DB functions are not callable by the service role — the revive never depends on them
    expect(r).not.toContain('a.rpc("plan_limit"');
    const p = read("lib/billing/packs.ts");
    expect(p).toContain("await m.reviveCreditTasks(orgId);");
    expect(p).toContain("await m.resumeHeldTasks(orgId);");
  });
  it("running out of credits is explained with the cure", () => {
    expect(ownerFailure("ai.limitReached", "he").code).toBe("credits");
    expect(ownerFailure("ai.limitReached", "he").action).toContain("רכשו חבילת קרדיטים");
  });
});

describe("the scene never looks frozen and never follows a dead run", () => {
  it("a run 'in progress' for longer than any run can last is recovered and started at once", () => {
    const a = read("app/[locale]/(dashboard)/ai-team/run-actions.ts");
    expect(a).toContain("const STALE_RUN_MS = 150_000;");
    expect(a).toContain('update({ status: "pending", error: "recovered_stuck", attempts: Number(t.attempts ?? 0) + 1');
  });
  it("the live line is clean: no ids, brackets or tool keys", () => {
    expect(cleanLiveLine("social.performance: 8 posts [published facebook id 92ed4233-cd66-4888-a183-18591da5afa3] top")).toBe("8 posts top");
    expect(cleanLiveLine("   ")).toBeNull();
    expect(cleanLiveLine("x".repeat(200))!.length).toBeLessThanOrEqual(110);
  });
  it("after the planned stages the scene counts seconds; done closes by itself with a confirmation toast", () => {
    expect(read("components/ai-team/team-agent-loader.tsx")).toContain('t("aiTeam.loader.stillWorking", { s: elapsed })');
    expect(read("components/ai-team/panels.tsx")).toContain('toast.success(msg ?? t("aiTeam.loader.doneTitle"));');
    for (const l of ["he", "en", "ar"]) expect(typeof JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).aiTeam.loader.stillWorking).toBe("string");
  });
});
