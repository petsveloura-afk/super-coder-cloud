import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ownerAnswerMemory, ownerFacingText, ownerQuestionCheck, selfServeAnswer } from "@/lib/team/ask-gate-core";
import { MASTER_PLAYBOOK, OWNER_MINDSET, SELF_SUFFICIENCY, masteryPrompt } from "@/lib/team/mastery-core";
import { collapseRepeats, tidyActivityText } from "@/lib/team/activity-tidy-core";
import { ROLE_KEYS } from "@/lib/team/roles";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const SALES = ["crm.find_contacts", "inbox.thread", "inbox.unanswered", "crm.recent_leads", "analytics.day_metrics", "social.performance", "team.ask_user"];

describe("questions to the owner — the cases from the owner's screenshots", () => {
  it("'what is the exact subject of each of the three waiting customers (ids…)?' → read the conversation instead", () => {
    const q = "מהו הנושא המדויק של הפנייה של כל אחד משלושת הלקוחות הממתינים (b59e9132-6c3b-4d6b-bf71-eefb3327d95b, 97a67658-043b-449d-8ae6-e961d1be9bce, 167a382c-cb05-4c71-91de-1036e2346c2b)?";
    const r = ownerQuestionCheck(q, SALES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tool).toBe("inbox.thread");
  });

  it("'which contact_id's of the 5 waiting chats?' / 'new leads last month and average reply time?' / engagement → the team's own tools", () => {
    const a = ownerQuestionCheck("אילו מזהים (contact_id) של 5 השיחות הממתינות למענה יש לבדוק?", SALES);
    expect(a.ok).toBe(false);
    const b = ownerQuestionCheck("האם ניתן לקבל את מספר הלידים החדשים בחודש האחרון ואת ממוצע זמן התגובה לשיחות באותו תקופה?", SALES);
    expect(b.ok === false && b.tool).toBe("crm.recent_leads");
    const c = ownerQuestionCheck("האם יש נתונים מוגדרים לגבי מדד מעורבות יעד ספציפי?", SALES);
    expect(c.ok === false && c.tool).toBe("social.performance");
  });

  it("real owner questions still go to the owner; a tool the employee lacks or a second attempt never blocks", () => {
    expect(ownerQuestionCheck("מה השירות הספציפי שהלקוח מעוניין בו — יש לכם מחיר קבוע לבניית דף נחיתה?", SALES).ok).toBe(true);
    expect(ownerQuestionCheck("האם לאשר הנחה של 10% ללקוח הזה?", SALES).ok).toBe(true);
    expect(ownerQuestionCheck("כמה לידים חדשים היו החודש?", ["team.ask_user"]).ok).toBe(true);
    expect(ownerQuestionCheck("כמה לידים חדשים היו החודש?", SALES, new Set(["crm.recent_leads"])).ok).toBe(true);
  });

  it("ids never reach the owner (also for questions already asked before this update)", () => {
    const t = ownerFacingText("מהו הנושא של הלקוחות הממתינים (b59e9132-6c3b-4d6b-bf71-eefb3327d95b, 97a67658-043b-449d-8ae6-e961d1be9bce)?");
    expect(t).toBe("מהו הנושא של הלקוחות הממתינים?");
    expect(ownerFacingText("אילו מזהים (contact_id) של 5 השיחות?")).toBe("אילו מזהים של 5 השיחות?");
    expect(ownerFacingText("לקוח 167a382c-cb05-4c71-91de-1036e2346c2b מחכה")).toBe("לקוח … מחכה");
    const ok = ownerQuestionCheck("מה המחיר ללקוח 167a382c-cb05-4c71-91de-1036e2346c2b?", []);
    expect(ok.ok && ok.question).toBe("מה המחיר ללקוח …?");
  });

  it("the owner's answer becomes a lasting team fact (not the 'check it yourselves' reply, not escalations)", () => {
    const m = ownerAnswerMemory("מה המחיר לבניית דף נחיתה?", "1,500 ₪ כולל אחסון לשנה");
    expect(m?.subject.startsWith("owner-answer:")).toBe(true);
    expect(m?.content).toContain("1,500 ₪");
    expect(ownerAnswerMemory("מה המחיר לבניית דף נחיתה?", "1,800 ₪")?.subject).toBe(m?.subject);
    expect(ownerAnswerMemory("שאלה", selfServeAnswer("he"))).toBeNull();
    expect(ownerAnswerMemory("escalate:refund", "ok")).toBeNull();
    expect(read("lib/team/runner.ts")).toContain("ownerAnswerMemory(");
  });

  it("wired into the engine (before waiting for the owner) and the questions card (clean text + one-tap answer)", () => {
    const eng = read("lib/team/engine-core.ts");
    expect(eng).toContain("ownerQuestionCheck(String(v.args.question");
    expect(eng).toContain('out.status = "awaiting_input";');
    const ui = read("components/ai-team/panels.tsx");
    expect(ui).toContain("ownerFacingText(q.question)");
    expect(ui).toContain("question-self-serve");
  });
});

describe("mastery layer for every employee", () => {
  it("every role has a master playbook; the prompt carries owner mindset + self-sufficiency", () => {
    for (const r of ROLE_KEYS) {
      expect(MASTER_PLAYBOOK[r]?.length).toBeGreaterThan(0);
      const p = masteryPrompt(r);
      expect(p).toContain("OWNER MINDSET");
      expect(p).toContain("SELF-SUFFICIENCY");
      expect(p).toContain("MASTER PLAYBOOK");
    }
    expect(SELF_SUFFICIENCY).toContain("Never put database ids in a question");
    expect(OWNER_MINDSET).toContain("cash flow");
    expect(read("lib/team/engine-core.ts")).toContain("masteryPrompt(m.role)");
    expect(read("lib/team/engine-core.ts")).toContain("expertisePrompt(m.role)"); // the existing expertise stays
  });
});

describe("activity feed — readable for the owner", () => {
  it("AI engine internals are hidden; the sentence stays", () => {
    const s = tidyActivityText("Model fallback used 1× (plan: github/openai/gpt-4.1-mini → nvidia/nvidia/nemotron-3.5-bolt-e4b).", "en");
    expect(s).not.toMatch(/github|nvidia|gpt-4/);
    expect(s).toContain("Model fallback used 1×");
    expect(tidyActivityText("הופעל מנוע חלופי 1 פעמים (plan: github/openai/gpt-4.1-mini → nvidia/nvidia/nemotron-3.5-bolt-e4b).", "he")).toBe("הופעל מנוע חלופי 1 פעמים.");
  });

  it("the same line twice in a row is shown once with ×2 (other lines untouched)", () => {
    const t0 = "2026-11-12T16:35:00Z";
    const list = [
      { id: 1, member_id: null, summary: "הבעלים ענו על שאלה של עובד/ת.", created_at: t0 },
      { id: 2, member_id: null, summary: "הבעלים ענו על שאלה של עובד/ת.", created_at: "2026-11-12T16:34:30Z" },
      { id: 3, member_id: "m", summary: "דוח בוקר", created_at: "2026-11-12T04:00:00Z" },
      { id: 4, member_id: null, summary: "הבעלים ענו על שאלה של עובד/ת.", created_at: "2026-11-11T04:00:00Z" },
    ];
    const out = collapseRepeats(list);
    expect(out.map((x) => x.summary)).toEqual(["הבעלים ענו על שאלה של עובד/ת. ×2", "דוח בוקר", "הבעלים ענו על שאלה של עובד/ת."]);
    expect(read("lib/team/page-data.ts")).toContain("collapseRepeats(");
  });
});
