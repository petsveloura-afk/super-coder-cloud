import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/lib/navigation";
import { ROLE_KEYS } from "@/lib/team/roles";
import { TOOLS } from "@/lib/team/tools-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
const get = (d: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);

describe("My team screen — wiring", () => {
  it("the menu item exists only behind the team_v1 flag (nothing changes for businesses without it)", () => {
    expect(NAV_ITEMS.find((n) => n.key === "ai-team")).toMatchObject({ flag: "team_v1", permission: "ai.use" });
    expect(read("components/layout/app-shell.tsx")).toContain("(!i.flag || flags.includes(i.flag))");
    expect(read("app/[locale]/(dashboard)/layout.tsx")).toContain('flags={teamOn ? ["team_v1"] : []}');
    expect(read("components/layout/nav-icons.tsx")).toContain('"ai-team": Network');
  });
  it("the page checks the flag, loads lazily and has loading / error screens", () => {
    const p = read("app/[locale]/(dashboard)/ai-team/page.tsx");
    expect(p).toContain("teamFlagOn");
    expect(p).toContain("dynamic(() => import(\"@/components/ai-team/team-screen\")");
    for (const f of ["loading.tsx", "error.tsx"]) expect(existsSync(join(root, "app/[locale]/(dashboard)/ai-team", f))).toBe(true);
    expect(existsSync(join(root, "app/[locale]/(wide)/docs/zz-team-preview"))).toBe(false);
  });
  it("paid feature: the page, the actions and the background runner all require the ai_team plan feature (or its trial)", () => {
    const p = read("app/[locale]/(dashboard)/ai-team/page.tsx");
    expect(p).toContain('featureAccess(ctx.org.id, "ai_team")');
    expect(p).toContain('<FeatureLock locale={locale} feature="ai_team"');
    const a = read("app/[locale]/(dashboard)/ai-team/actions.ts");
    expect(a).toContain('orgHasFeature(ctx.org.id, "ai_team")');
    // stopping / turning off stays allowed after the plan ended
    expect(a).toContain('gate(locale, "ai.use", { plan: false })');
    expect(a).toContain('gate(locale, "ai.manage", { plan: Boolean(input.enabled) })');
    const r = read("lib/team/runner.ts");
    expect(r).toContain('orgHasFeatureAdmin(orgId, "ai_team")');
    expect(r).toContain('return { notRun: "plan_locked" }');
    expect(r).toMatch(/teamFlagOn\(orgId\)\)\) continue;\s*if \(!\(await teamPlanOn\(orgId\)\)\) continue;/);
  });
  it("3D presentation: perspective ring, keyboard, drag, auto-rotate, add card, reduced motion", () => {
    const p = read("components/ai-team/presentation-3d.tsx");
    for (const x of ["team-stage", "rotateY", "translateZ", "onKeyDown", "onPointerDown", "setAuto", 'data-testid={s.kind === "member"', "card-add", "prefers-reduced-motion"]) expect(p, x).toContain(x);
    const css = read("app/globals.css");
    expect(css).toContain(".team-stage { perspective:");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.agent-avatar \*/);
  });
  it("animated avatars with every state and full customization", () => {
    const a = read("components/ai-team/avatar.tsx");
    for (const s of ["av-${state}", "working", "waiting", "success", "error", "paused"]) expect(a).toContain(s);
    for (const x of ["ACCESSORIES", "FACES", "SKINS", "HAIRS"]) expect(a).toContain(`export const ${x}`);
  });
  it("the editor has every tab; the screen has every panel", () => {
    const e = read("components/ai-team/member-editor.tsx");
    for (const t of ["profile", "personality", "tools", "autonomy", "memory", "history", "performance", "test"]) expect(e).toContain(`"${t}"`);
    const s = read("components/ai-team/team-screen.tsx");
    for (const t of ["GoalsPanel", "ApprovalsPanel", "MemoryPanel", "PlaybooksPanel", "MeetingPanel", "ActivityPanel", "SettingsPanel", "HireGallery", "Presentation3D", "TeamGrid", "TeamTree"]) expect(s).toContain(t);
  });
});

describe("My team screen — every dynamic text exists in he, en and ar", () => {
  const keys = [
    ...ROLE_KEYS.flatMap((r) => [`aiTeam.roles.${r}`, `aiTeam.roleAbout.${r}`]),
    ...TOOLS.map((x) => `aiTeam.tools.${x.key.replace(".", "_")}`),
    ...["idle", "working", "waiting", "success", "error", "paused"].map((x) => `aiTeam.live.${x}`),
    ...["draft", "pending", "in_progress", "awaiting_approval", "awaiting_input", "blocked", "done", "failed", "canceled"].map((x) => `aiTeam.status.${x}`),
    ...["internal", "customer", "money", "irreversible", "read"].map((x) => `aiTeam.sens.${x}`),
    ...["understand", "context", "plan", "execute", "self_check", "peer_review", "deliver", "learn", "initiative", "approval", "system"].map((x) => `aiTeam.phase.${x}`),
    ...["fact", "preference", "forbidden", "policy", "approved_style", "rejected", "correction", "outcome"].map((x) => `aiTeam.mem.kind.${x}`),
    ...["active", "proposed", "revoked", "expired"].map((x) => `aiTeam.mem.status.${x}`),
    ...["suggest", "approve", "auto", "suggestBody", "approveBody", "autoBody"].map((x) => `aiTeam.autonomy.${x}`),
    ...["team", "goals", "approvals", "memory", "playbooks", "meeting", "activity", "settings"].map((x) => `aiTeam.tabs.${x}`),
    ...["profile", "personality", "tools", "autonomy", "memory", "history", "performance", "test"].map((x) => `aiTeam.editor.tabs.${x}`),
    ...["legal", "refund", "health_safety", "wants_human"].map((x) => `aiTeam.questions.escalate.${x}`),
    ...["plan", "review", "write", "site", "classify", "summarize", "vision"].map((x) => `aiTeam.admin.kinds.${x}`),
    ...["none", "tie", "headset", "pen", "chart", "brush", "clipboard", "shield", "coin", "star", "megaphone", "laptop", "spark", "smile", "cheer", "calm", "focus", "short", "long", "curly", "bun", "light", "tan", "brown", "dark"].map((x) => `aiTeam.editor.avv.${x}`),
    ...["employee", "done", "approval", "rejection", "avg", "credits", "escalations", "edited", "failed"].map((x) => `aiTeam.metrics.${x}`),
    "nav.aiTeam",
    "aiTeam.hire.cta",
    "aiTeam.msg.hired",
    "aiTeam.stop.release",
    "aiTeam.pres.play",
  ];
  for (const l of ["he", "en", "ar"]) {
    it(l, () => {
      const d = dict(l);
      const missing = keys.filter((k) => typeof get(d, k) !== "string");
      expect(missing).toEqual([]);
    });
  }
});
