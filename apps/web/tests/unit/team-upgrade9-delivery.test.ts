import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEmployeeTask, type EngineDeps, type EngineMember, type EngineTask } from "@/lib/team/engine-core";
import { completionVerdict, continuationBrief, continuationTitle, extractPosts, wantsOutput, wantsPosts, DELIVERY_RULES, FINISH_RESERVE } from "@/lib/team/execution-plus-core";
import { ROLE_EXTRA_TOOLS9, UPGRADE9_TOOLS, withRoleExtras9 } from "@/lib/team/tools-plus9-core";
import { TOOL_MAP } from "@/lib/team/tools-core";
import { ROLES } from "@/lib/team/roles";
import { classifyPublishError, publishHintKey } from "@/lib/social/errors";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const plan = (p: Record<string, unknown>) => JSON.stringify({ understanding: "goal", missing: [], question: null, assumptions: [], steps: [], more: false, deliverable: { type: "none", customer_facing: false, instructions: "" }, risks: [], estimate: { credits: 1, minutes: 1 }, ...p });
const settings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 12, daily_credit_cap: 200, day_credits: 0 };
const POSTS = "פוסט 1: רוצים דף נחיתה שממיר? אנחנו בונים דפי נחיתה מהירים ומותאמים למובייל. שלחו הודעה.\n\nפוסט 2: סיפור הצלחה — לקוח שהגדיל את הפניות פי שניים אחרי שבנינו לו דף נחיתה חדש.\n\nפוסט 3: טיפ מקצועי: קריאה אחת ברורה לפעולה בכל דף נחיתה מעלה את ההמרות בצורה משמעותית.";

function marketer(over: Partial<EngineMember> = {}): EngineMember {
  return { id: "m1", role: "marketing", name: "דור", tone: null, instructions: "", tools: withRoleExtras9("marketing", ROLES.marketing.tools), autonomy: "approve", auto_actions: [], status: "active", limits: {}, ...over } as EngineMember;
}

function harness(script: string[], extra: Partial<EngineDeps> = {}) {
  const rec = { tools: [] as { tool: string; args: Record<string, unknown> }[], logs: [] as string[], approvals: [] as string[], continued: [] as { title: string; brief: string }[] };
  let i = 0;
  const deps: EngineDeps = {
    lang: "he",
    interactive: false,
    ai: async () => {
      const text = script[i++];
      return text === undefined ? { ok: false, text: "", credits: 0, error: "script_exhausted" } : { ok: true, text, credits: 1 };
    },
    runTool: async (tool, args) => {
      rec.tools.push({ tool, args });
      return { ok: true, summary: `${tool} ok` };
    },
    log: async (_p, s) => void rec.logs.push(s),
    approval: async (a) => {
      rec.approvals.push(a.tool);
      return `ap${rec.approvals.length}`;
    },
    handoff: async () => ({ ok: true, taskId: "h1" }),
    continueLater: async (input) => {
      rec.continued.push(input);
      return { ok: true, taskId: "c1" };
    },
    message: async () => undefined,
    remember: async () => undefined,
    context: async () => ({ profile: "Name: Super Coder", known: "", memories: [], playbookExtra: "", reviewer: null }),
    ...extra,
  };
  const run = (m: EngineMember, task: Partial<EngineTask> = {}) => runEmployeeTask(deps, m, { id: "t", title: "כתיבת 3 פוסטים קצרים לקהל יעד חדש", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null, ...task }, settings);
  return { rec, run };
}

describe("upgrade 9 — the team does what was asked, completely", () => {
  it("pure: posts are recognised, split and cleaned; analysis tasks are not 'write posts'", () => {
    expect(wantsPosts("כתיבת 3 פוסטים קצרים לקהל יעד חדש")).toBe(true);
    expect(wantsPosts("Write 5 Instagram posts")).toBe(true);
    expect(wantsPosts("ניתוח פוסטים קודמים")).toBe(false);
    expect(wantsPosts("בדיקת איכות לתכני השיווק")).toBe(false);
    expect(wantsOutput("הכנת תוכנית תוכן חודשית")).toBe(true);
    expect(wantsOutput("ניתוח נתוני הרשתות")).toBe(false);
    const posts = extractPosts(POSTS);
    expect(posts).toHaveLength(3);
    expect(posts[0]!.startsWith("רוצים דף נחיתה")).toBe(true);
    expect(extractPosts("Post 1: " + "a".repeat(50) + "\n---\n" + "b".repeat(50)).length).toBeGreaterThanOrEqual(1);
    expect(extractPosts("1. " + "x".repeat(60) + "\n2. " + "y".repeat(60))).toHaveLength(2);
    expect(extractPosts("קצר")).toEqual([]);
  });

  it("written posts become drafts on the posts board (never published), with a report line and no approval spam", async () => {
    const h = harness([plan({ deliverable: { type: "post", customer_facing: false, instructions: "3 posts" } }), POSTS]);
    const out = await h.run(marketer());
    expect(h.rec.tools.filter((t) => t.tool === "social.save_draft")).toHaveLength(3);
    expect(out.drafts).toBe(3);
    expect(out.partial).toBeFalsy();
    expect(out.report).toContain("3 טיוטות פוסטים נשמרו בלוח הפרסומים");
    expect(h.rec.tools.some((t) => t.tool === "social.schedule_post")).toBe(false);
  });

  it("a plan that produces nothing for a 'write' task still writes the output", async () => {
    const h = harness([plan({}), POSTS]);
    const out = await h.run(marketer());
    expect(h.rec.logs.some((l) => l.includes("the final output will be written"))).toBe(true);
    expect(out.drafts).toBe(3);
  });

  it("asked for posts but could not save them → honest 'partially done', not a silent success", async () => {
    const noSave = marketer({ tools: ROLES.marketing.tools.filter((x) => x !== "social.draft_post") });
    const h = harness([plan({ deliverable: { type: "text", customer_facing: false, instructions: "" } }), "קצר"]);
    const out = await h.run(noSave);
    expect(out.partial).toBe(true);
    expect(out.report).toContain("הושלם חלקית");
    expect(completionVerdict({ task: "כתוב פוסט", expectsPosts: true, produced: { drafts: 2, writes: 2, approvals: 0, handoffs: 0, deliverableChars: 300, stopped: false } }).partial).toBe(false);
  });

  it("a per-task limit that stops the work hands the rest to the SAME employee in a new run", async () => {
    const steps = Array.from({ length: 4 }, () => ({ tool: "tasks.open", args: {}, why: "x" }));
    const h = harness([plan({ steps })]);
    const out = await h.run(marketer({ limits: { max_steps: 2 } }), { title: "ניתוח תוכן" });
    expect(h.rec.continued).toHaveLength(1);
    expect(h.rec.continued[0]!.title).toBe("המשך: ניתוח תוכן");
    expect(out.handoffs).toContain("c1");
    expect(continuationTitle("המשך: x", "he")).toBe("המשך: x");
    expect(continuationBrief({ title: "x", done: [{ tool: "a", ok: true, summary: "s" }], reason: "task_credit_limit" })).toContain("Do NOT repeat");
    expect(FINISH_RESERVE).toBeGreaterThan(0);
    expect(DELIVERY_RULES).toContain("social.drafts");
  });

  it("catalog + grants: two new tools, given to the right roles, nothing removed", () => {
    for (const t of UPGRADE9_TOOLS) expect(TOOL_MAP[t.key]).toBeTruthy();
    expect(TOOL_MAP["social.save_draft"]!.sensitivity).toBe("internal");
    expect(TOOL_MAP["social.drafts"]!.kind).toBe("read");
    expect(withRoleExtras9("marketing", ["a"])).toEqual(["a", ...ROLE_EXTRA_TOOLS9.marketing!]);
    expect(withRoleExtras9("custom", ["a"])).toEqual(["a"]);
    expect(ROLE_EXTRA_TOOLS9.quality_control).toContain("team.handoff");
  });

  it("wiring: runner, tools, board, notifications, social hints and labels", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain("withRoleExtras9(m.role_key,");
    expect(r).toContain("continueLater: async (input) => {");
    expect(r).toContain('title_key: "aiTeam.draftsReady"');
    expect(r).toContain("...(out.partial ? { partial: true, partial_reason: out.partialReason ?? null } : {})");
    const tl = read("lib/team/tools.ts");
    expect(tl).toContain('case "social.save_draft": {');
    expect(tl).toContain('case "social.drafts": {');
    expect(tl).toContain('status: "draft", source: "agent", origin: "studio", media_pending: "image"');
    const p = read("components/ai-team/panels.tsx");
    expect(p).toContain('data-testid="task-partial"');
    expect(p).toContain('data-testid="task-drafts"');
    expect(read("components/social/social-client.tsx")).toContain('data-testid="post-past-due"');
    expect(publishHintKey(classifyPublishError("telegram: Forbidden: bot is not a member of the channel chat"))).toBe("social.errTelegramBot");
    expect(classifyPublishError("(#200) requires pages_manage_posts permission")).toBe("permission");
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const k of ["social_drafts", "social_save_draft"]) expect(typeof d.aiTeam.tools[k], `${l}.${k}`).toBe("string");
      expect(typeof d.aiTeam.draftsReady).toBe("string");
      expect(typeof d.aiTeam.board.partial).toBe("string");
      expect(typeof d.aiTeam.board.drafts).toBe("string");
      expect(typeof d.social.pastDue).toBe("string");
      expect(typeof d.social.errTelegramBot).toBe("string");
    }
  });
});
