import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localizeReportText, reportStandardFor } from "@/lib/team/report-lang-core";
import { REPORT_STANDARD } from "@/lib/team/doctrine";
import { cleanPostBody, isAgentStatusText, isNotAPost } from "@/lib/social/post-hygiene-core";
import { capResumeAt, shownUsed, suggestedCap } from "@/lib/team/cap-relief-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("manager summary — headings and tags in the business's language", () => {
  it("the prompt keeps the standard and adds the exact Hebrew headings; English is unchanged", () => {
    expect(reportStandardFor("en")).toBe(REPORT_STANDARD);
    const he = reportStandardFor("he");
    expect(he.startsWith(REPORT_STANDARD)).toBe(true);
    for (const w of ["בשורה התחתונה", "ממצאים עיקריים", "סיבות שורש", "המלצות", "ניצחונות מהירים (השבוע)", "(עובדה)", "(הסקה)", "(הנחה)", "השפעה", "מאמץ", "אחראי"]) expect(he).toContain(w);
    expect(reportStandardFor("ar")).toContain("النتائج الرئيسية");
  });

  it("a saved Hebrew summary with English labels is shown in Hebrew", () => {
    const saved = [
      "**Bottom line first:** הלידים ירדו ב-30% בגלל זמן תגובה איטי.",
      "Key findings:",
      "• זמן תגובה ממוצע 9 שעות (FACT)",
      "• רוב הלידים מגיעים בערב (INFERENCE)",
      "## Root causes",
      "Recommendations:",
      "1. מענה אוטומטי בערב · Impact: high · Effort: hours · Owner: דנה",
      "Quick wins (this week): להפעיל תשובה אוטומטית.",
      "Next steps: לבדוק בעוד שבוע. Confidence: medium",
    ].join("\n");
    const out = localizeReportText(saved, "he");
    for (const en of ["Bottom line", "Key findings", "Root causes", "Recommendations", "Quick wins", "FACT", "INFERENCE", "Impact", "Effort", "Owner", "Next steps", "Confidence", "high", "hours", "medium"]) expect(out).not.toContain(en);
    expect(out).toContain("**בשורה התחתונה:** הלידים ירדו");
    expect(out).toContain("ממצאים עיקריים:");
    expect(out).toContain("(עובדה)");
    expect(out).toContain("## סיבות שורש");
    expect(out).toContain("השפעה: גבוהה · מאמץ: שעות · אחראי: דנה");
    expect(out).toContain("ניצחונות מהירים (השבוע): להפעיל");
  });

  it("English reports and English businesses are untouched; Hebrew text without labels is untouched", () => {
    const en = "Key findings:\n• Leads dropped (FACT)";
    expect(localizeReportText(en, "en")).toBe(en);
    expect(localizeReportText(en, "he")).toBe(en); // an English report stays English
    const plain = "הלידים ירדו השבוע. כדאי לענות מהר יותר.";
    expect(localizeReportText(plain, "he")).toBe(plain);
  });

  it("wired: the goal summary and the report prompt use the localized standard; the screen localizes saved reports", () => {
    expect(read("lib/team/runner.ts")).toContain("reportStandardFor(sumLang)");
    expect(read("lib/team/engine-core.ts")).toContain("reportStandardFor(deps.lang)");
    expect(read("lib/team/page-data.ts")).toContain('for (const k of ["summary", "report", "output"])');
  });
});

describe("posts board — an employee's status line is not a post", () => {
  const status = ["שירה מתכננת לוחות זמנים לשעתיים המומלצות ומעדכנת את לוח הפרסום.", "דור יוצר את שלושת תבניות הפוסטים החדשות.", "נועה בודקת את הנתונים של הפוסטים מהשבוע שעבר.", "Shira is planning the posting schedule for next week."];
  it.each(status)("refused: %s", (s) => {
    expect(isAgentStatusText(s)).toBe(true);
    expect(cleanPostBody(s)).toEqual({ ok: false, reason: "not_a_post" });
    expect(isNotAPost({ body: s, source: "agent" })).toBe(true); // already on the board → marked "not a post"
    expect(isNotAPost({ body: s, source: "manual" })).toBe(false); // a person's post is never touched
  });

  const posts = [
    "דנה מכינה עוגות טריות כל בוקר 🍰 בואו לטעום!",
    "מאפיית השכונה מזמינה אתכם לטעום את הלחם החדש שלנו. מחכים לכם!",
    "סוף שבוע נעים! השבוע אנחנו פתוחים עד 22:00 ומחכים לכם עם מבצעים מיוחדים.",
    "הצוות שלנו מכין לכם הפתעה לחג — עקבו אחרינו.",
    "Dana bakes fresh bread every morning, come taste it!",
  ];
  it.each(posts)("kept: %s", (s) => {
    expect(isAgentStatusText(s)).toBe(false);
    expect(cleanPostBody(s).ok).toBe(true);
  });
});

describe("daily credit cap — when held tasks resume, and a one-click raise", () => {
  const H = 3_600_000;
  const now = Date.parse("2026-11-12T20:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  it("the moment the rolling 24h window frees enough credits", () => {
    const rows = [
      { started_at: iso(now - 23 * H), credits_used: 400 },
      { started_at: iso(now - 10 * H), credits_used: 400 },
      { started_at: iso(now - 1 * H), credits_used: 214 },
    ];
    // 1014 used, cap 1000 → the first row leaves the window in 1 hour → 614 ≤ 985
    expect(capResumeAt(rows, 1000, now)).toBe(now + 1 * H);
    expect(capResumeAt(rows, 2000, now)).toBe(now); // room already
    expect(capResumeAt(rows, 0, now)).toBeNull(); // no cap
    expect(capResumeAt([{ started_at: null, credits_used: 5 }], 1000, now)).toBe(now);
  });

  it("the raise: × 1.5, at least today's use + 300, rounded to 100, never above the settings maximum", () => {
    expect(suggestedCap(1000, 1014)).toBe(1500);
    expect(suggestedCap(200, 600)).toBe(900);
    expect(suggestedCap(99_000, 99_000)).toBe(100_000);
  });

  it("the screen never shows 1014/1000", () => {
    expect(shownUsed(1014, 1000)).toBe(1000);
    expect(shownUsed(500, 1000)).toBe(500);
    expect(shownUsed(500, 0)).toBe(500);
  });

  it("wired: managers only, audited, resumes the held tasks now; the board shows when and the button", () => {
    const act = read("app/[locale]/(dashboard)/ai-team/cap-actions.ts");
    expect(act).toContain('ctx.can("ai.manage")');
    expect(act).toContain("runner.resumeHeldTasks(ctx.org.id)");
    expect(act).toContain('from("team_activity")');
    expect(read("components/ai-team/panels.tsx")).toContain("<CapRelief data={data}");
    expect(read("components/ai-team/cap-relief.tsx")).toContain("data.canManage");
  });
});
