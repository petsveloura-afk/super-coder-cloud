import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANE_MINUTES, claimForMessage, claimsBriefLine, harmonyScore, ownerLabel, steppedAside } from "@/lib/coordination/core";
import { hotLeadTask } from "@/lib/coordination/sales-core";
import { smartTeamBlock } from "@/lib/coordination/team-core";
import { COORDINATION_RULES } from "@/lib/team/engine-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("agent coordination — one agent per customer per purpose", () => {
  it("every message caller maps to an owner + lane from the meta it already passes", () => {
    expect(claimForMessage("reminder", { invoice_id: "i" })).toEqual({ lane: "money", owner: "smart:collections", minutes: LANE_MINUTES.money });
    expect(claimForMessage("automation", { reengage: true })).toMatchObject({ lane: "outreach", owner: "smart:reengage" });
    expect(claimForMessage("automation", { review_request: true })).toMatchObject({ owner: "smart:reviews" });
    expect(claimForMessage("automation", { cart: true })).toMatchObject({ owner: "smart:carts" });
    expect(claimForMessage("automation", { team: true })).toMatchObject({ lane: "outreach", owner: "team:employee" });
    expect(claimForMessage("reminder", { team: true })).toMatchObject({ lane: "money", owner: "team:employee" });
    expect(claimForMessage("automation", {})).toMatchObject({ owner: "smart:agent" });
    expect(LANE_MINUTES).toEqual({ outreach: 1440, money: 1200, task: 1200 });
  });

  it("labels, the employee's brief line, the stepped-aside reason and the harmony score", () => {
    expect(ownerLabel("smart:collections", "he")).toBe("סוכן הגבייה (הצוות החכם)");
    expect(ownerLabel("team:abc", "en")).toBe("My team employee");
    expect(ownerLabel("unknown:x", "ar")).toBe("الفريق الذكي");
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(claimsBriefLine([{ lane: "money", owner: "smart:collections", until: "2026-11-06T17:00:00Z" }, { lane: "outreach", owner: "x", until: "2026-11-06T10:00:00Z" }], now)).toBe("handled now by other agents (do not repeat their work): money → smart:collections for 5h");
    expect(claimsBriefLine([], now)).toBe("");
    expect(steppedAside("smart:reengage", "he")).toContain("נמנעתי כדי שלא תצא הודעה כפולה");
    expect(harmonyScore({ active: 3, prevented7d: 0 })).toBe(100);
    expect(harmonyScore({ active: 3, prevented7d: 3 })).toBe(92);
    expect(harmonyScore({ active: 3, prevented7d: 100000 })).toBe(70);
  });

  it("the smarter sales manager: a hot-lead follow-up task in the business's language", () => {
    const t = hotLeadTask("he", { name: "דנה", summary: "  רוצה הצעת   מחיר  ", channel: "whatsapp" });
    expect(t.title).toBe("🔥 ליד חם: לחזור ל-דנה היום");
    expect(t.description).toContain("מה הוא רוצה: רוצה הצעת מחיר");
    expect(hotLeadTask("en", { name: "Dana", summary: null, channel: "" }).description).not.toContain("What they want");
  });

  it("the employee knows what the smart team did today and the coordination rules", () => {
    expect(smartTeamBlock([])).toBe("");
    const b = smartTeamBlock([{ agent: "sales_manager", summary: "3 deals went quiet", created_at: "2026-11-06T07:05:00Z" }, { agent: "x", summary: " ", created_at: "2026-11-06T07:00:00Z" }]);
    expect(b).toContain("- sales manager (07:05 UTC): 3 deals went quiet");
    expect(b).toContain("never repeat it");
    expect(COORDINATION_RULES).toContain("handled now by other agents");
    expect(COORDINATION_RULES).toContain("SUCCESS of the coordination");
  });

  it("wiring: the shared send claims first and releases when nothing was sent; deals + hot leads are claimed; shared facts; the board", () => {
    const run = read("lib/agents/run.ts");
    expect(run).toContain("const claim = await claimEntity({ orgId, entityType: \"contact\"");
    expect(run).toContain("if (!claim.granted) return false;");
    expect(run).toContain("if (!sent) await releaseEntity(");
    expect(run).toContain('lane: "task", owner: "smart:sales_manager"');
    expect(run).toContain("const scan = await opportunityScan(org, maxTasks)");
    expect(run).toContain("These confirmed facts are shared by every agent of the business");
    const tools = read("lib/team/tools.ts");
    expect(tools).toContain("{ team: true, force: ctx.interactive === true }");
    expect(tools).toContain("claimsBriefLine(rows)");
    expect(read("lib/team/engine-core.ts")).toContain("    COORDINATION_RULES,\n");
    expect(read("lib/team/runner.ts")).toContain("smartTeamBlock(");
    expect(read("app/[locale]/(dashboard)/agents/page.tsx")).toContain("<AgentsHarmony locale={locale} orgId={ctx.org.id} />");
    expect(read("app/[locale]/(dashboard)/ai-team/page.tsx")).toContain("<AgentsHarmony locale={locale} orgId={ctx.org.id} />");
    const sql = readFileSync(join(root, "../../supabase/migrations/20261106000004_agent_coordination.sql"), "utf8");
    for (const k of ["create table if not exists public.agent_claims", "function public.agent_claim(", "function public.agent_release(", "function public.agent_coordination_overview("]) expect(sql).toContain(k);
    for (const l of ["he", "en", "ar"]) {
      const h = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).agents.harmony;
      for (const k of ["title", "subtitle", "score", "active", "prevented", "shared", "sharedBody", "nowTitle", "none", "until", "avoided"]) expect(typeof h[k], `${l}.${k}`).toBe("string");
      for (const k of ["conversation", "smart", "team", "operator"]) expect(typeof h.systems[k]).toBe("string");
      for (const k of ["outreach", "money", "task"]) expect(typeof h.lanes[k]).toBe("string");
    }
  });
});
