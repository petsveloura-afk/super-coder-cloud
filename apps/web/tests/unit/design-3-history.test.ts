import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("task history — managers delete old tasks in every stage", () => {
  const src = read("app/[locale]/(dashboard)/ai-team/history-actions.ts");
  it("needs ai.manage, validates ids, never deletes a running task or a goal", () => {
    expect(src).toContain('ctx.can("ai.manage")');
    expect(src).toContain("z.array(z.string().uuid()).min(1).max(200)");
    expect(src).toContain('.neq("status", "in_progress")');
    expect(src).toContain("x.plan?.goal !== true");
    expect(src).toContain("NOT_GOAL");
    for (const st of ["done", "failed", "canceled", "pending", "blocked", "awaiting_input", "awaiting_approval"]) expect(src).toContain(`"${st}"`);
  });
  it("is scoped to the business and audited; history clearing deletes finished tasks only, in batches", () => {
    expect(src.match(/\.eq\("organization_id", ctx\.org\.id\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(src).toContain("team_activity");
    expect(src).toContain('.in("status", [...FINISHED])');
    expect(src).toContain("i += 200");
    // a JSON filter is never used on a delete (PostgREST cannot) — the goal filter is applied on the read
    expect(src).not.toMatch(/\.delete\(\)[^;]*\.or\(NOT_GOAL\)/);
  });
  it("the board offers delete in every stage but 'running', and keeps the per-user hide for non-managers", () => {
    const ui = read("components/ai-team/panels.tsx");
    expect(ui).toContain('const selectable = colKey !== "in_progress"');
    expect(ui).toContain("DeleteTaskButton");
    expect(ui).toContain("ClearOldHistory");
    expect(ui).toContain("hide={isDone && !canDelete ?");
    expect(ui).toContain('data-testid="board-chips"');
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as { aiTeam: { history?: Record<string, string> } };
      for (const k of ["empty", "deleteOne", "confirmOne", "deleteAllConfirm", "clearOld", "clearOldConfirm", "deleted", "deletedOne", "deletedSkipped", "runningOnly", "cleared"]) expect(d.aiTeam.history?.[k], `${l}.${k}`).toBeTruthy();
    }
  });
});

describe("design 3.0 — loading, navigation progress, phone finish", () => {
  it("navigation progress: starts on an internal link, finishes on the new page, never sticks", () => {
    const src = read("components/layout/nav-progress.tsx");
    expect(src).toContain("12_000");
    expect(src).toContain("url.origin !== window.location.origin");
    expect(src).toContain('setState("done")');
    expect(read("components/layout/app-shell.tsx")).toContain("<NavProgress />");
  });
  it("every loading screen shows the brand loader", () => {
    expect(read("components/ui/module-states.tsx")).toContain("<BrandLoader />");
    expect(read("app/[locale]/(dashboard)/loading.tsx")).toContain("<BrandLoader />");
  });
  it("the css layer is additive, layered and respects reduced motion", () => {
    const css = read("app/globals.css");
    const layer = css.slice(css.indexOf("design 3.0 (additive, CSS only)"));
    expect(layer).toContain("@layer components");
    expect(layer).toContain("prefers-reduced-motion: reduce");
    expect(layer).toContain(".nav-progress");
    expect(layer).toContain(".brand-loader");
    expect(layer).not.toMatch(/(?:^|\s)translate:/);
  });
  it("the help button is a compact icon on phones", () => {
    const src = read("components/guide/help-button.tsx");
    expect(src).toContain('className="hidden sm:inline"');
    expect(src).toContain('data-testid="guide-help"');
  });
});
