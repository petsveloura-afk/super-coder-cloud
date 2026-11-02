import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
const leaves = (o: unknown, p = ""): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : leaves(v, `${p}${k}.`)));

describe("team upgrade 2 — wiring", () => {
  it("the health and escalation keys exist in he / en / ar with the same structure", () => {
    const base = leaves(dict("he").aiTeam.health).sort();
    expect(base.length).toBeGreaterThan(20);
    for (const l of ["en", "ar"]) expect(leaves(dict(l).aiTeam.health).sort()).toEqual(base);
    for (const l of ["he", "en", "ar"]) for (const k of ["angry_customer", "repeat_complaint", "sensitive_situation", "long_wait"]) expect(typeof dict(l).aiTeam.questions.escalate[k]).toBe("string");
  });
  it("every failure reason and health issue the code can produce has a text", () => {
    const d = dict("en").aiTeam.health;
    for (const r of ["policy", "budget", "ai_unreadable", "ai_busy", "network", "input", "tool", "unknown"]) expect(typeof d.reason[r]).toBe("string");
    for (const i of ["emergency_stop", "team_off", "stuck_tasks", "many_failures", "all_models_down", "some_models_down", "clock_late"]) expect(typeof d.issue[i]).toBe("string");
  });
  it("the engine, runner and tools only gained hooks — the original lines are still there", () => {
    const e = read("lib/team/engine-core.ts");
    for (const keep of ["export async function runEmployeeTask", "escalationSignal(`${task.title}\\n${task.brief}`)", "async function retryTool", "export function parsePlanModel"]) expect(e).toContain(keep);
    expect(e).toContain("prefetch.get(step) ?? retryTool");
    const r = read("lib/team/runner.ts");
    expect(r).toContain("healthyRoute(routeFor(kind, avail");
    expect(r).toContain("export async function teamTick");
    const t = read("lib/team/tools.ts");
    expect(t).toContain('case "crm.find_contacts"');
    expect(t).toContain("planWeekLadder(7)");
  });
  it("the migration is additive and idempotent (no drop / delete / truncate of data, RLS on)", () => {
    const m = read("../../supabase/migrations/20261103000001_team_upgrade_2.sql");
    expect(m).not.toMatch(/drop (table|column)|truncate|delete from/i);
    expect(m).toContain("create table if not exists public.team_model_health");
    expect(m).toContain("add column if not exists attempts");
    expect(m).toContain("enable row level security");
  });
});
