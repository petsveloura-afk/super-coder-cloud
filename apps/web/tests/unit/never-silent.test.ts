import { describe, expect, it } from "vitest";
import { DEFAULT_UNATTENDED_RESUME_MINUTES, isPlaceholderOut, resumedNote, technicalPause, technicalPauseExtended, unattendedResume } from "@/lib/ai/autopilot-heal";
import { localizeLog, localizeTitle } from "@/lib/team/title-i18n-core";
import { decisionLanguageLine } from "@/lib/team/decision-core";
import { safeDueIso } from "@/lib/team/tools";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const now = Date.parse("2026-11-05T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

describe("the agent never goes silent on a customer", () => {
  it("the watchdog's own hand-over after busy engines is technical (the agent takes the chat back)", () => {
    expect(technicalPause("stuck_no_answer")).toBe(false); // the old rule — kept as it was
    expect(technicalPauseExtended("stuck_no_answer")).toBe(true);
    expect(technicalPauseExtended("ai_busy")).toBe(true);
    expect(technicalPauseExtended("plan_limit:ai_credits")).toBe(false);
    expect(technicalPauseExtended("customer_asked")).toBe(false);
  });

  it("an AGENT hand-over that nobody from the team answered comes back to the agent after the waiting time", () => {
    const base = { ownerTakeoverAt: null, teamAnsweredSince: false, now };
    expect(unattendedResume({ ...base, note: "guardrail_price", handoffAt: ago(DEFAULT_UNATTENDED_RESUME_MINUTES + 1) })).toBe(true);
    expect(unattendedResume({ ...base, note: "agent", handoffAt: ago(20) })).toBe(true);
    expect(unattendedResume({ ...base, note: "customer_asked", handoffAt: ago(20) })).toBe(true);
    expect(unattendedResume({ ...base, note: "angry_customer", handoffAt: ago(20) })).toBe(true);
    // too early
    expect(unattendedResume({ ...base, note: "guardrail_price", handoffAt: ago(5) })).toBe(false);
  });

  it("never when a person answered, the owner took over, a legal threat, a forbidden phrase or no AI credits", () => {
    const base = { now, handoffAt: ago(120) };
    expect(unattendedResume({ ...base, note: "agent", ownerTakeoverAt: null, teamAnsweredSince: true })).toBe(false);
    expect(unattendedResume({ ...base, note: "owner_typed", ownerTakeoverAt: ago(120), teamAnsweredSince: false })).toBe(false);
    expect(unattendedResume({ ...base, note: "critical:legal_or_threat", ownerTakeoverAt: null, teamAnsweredSince: false })).toBe(false);
    expect(unattendedResume({ ...base, note: "guardrail_banned", ownerTakeoverAt: null, teamAnsweredSince: false })).toBe(false);
    expect(unattendedResume({ ...base, note: "plan_limit:ai_credits", ownerTakeoverAt: null, teamAnsweredSince: false })).toBe(false);
    expect(unattendedResume({ ...base, note: "agent", handoffAt: null, ownerTakeoverAt: null, teamAnsweredSince: false })).toBe(false);
  });

  it("the agent's own setting: 0 = never, a number = that many minutes; the daily AI budget waits at least 12 hours", () => {
    const base = { ownerTakeoverAt: null, teamAnsweredSince: false, now };
    expect(unattendedResume({ ...base, note: "agent", handoffAt: ago(600), minutes: 0 })).toBe(false);
    expect(unattendedResume({ ...base, note: "agent", handoffAt: ago(45), minutes: 60 })).toBe(false);
    expect(unattendedResume({ ...base, note: "agent", handoffAt: ago(61), minutes: 60 })).toBe(true);
    expect(unattendedResume({ ...base, note: "ai_budget", handoffAt: ago(60) })).toBe(false);
    expect(unattendedResume({ ...base, note: "ai_budget", handoffAt: ago(13 * 60) })).toBe(true);
  });

  it("hold / hand-over messages are never a real answer; the agent is told it took the chat back", () => {
    expect(isPlaceholderOut({ fallback: true })).toBe(true);
    expect(isPlaceholderOut({ escalation: true })).toBe(true);
    expect(isPlaceholderOut({})).toBe(false);
    expect(isPlaceholderOut(null)).toBe(false);
    expect(resumedNote("he")).toMatch(/הועברה לצוות/);
    expect(resumedNote("en")).toMatch(/passed to the team/);
    expect(resumedNote("ar")).toMatch(/الفريق/);
  });

  it("wiring: the autopilot resumes unattended hand-overs, retries ignore placeholders, the watchdog rescues busy-engine chats", () => {
    const a = read("lib/ai/autopilot.ts");
    expect(a).toContain("technicalPauseExtended(nr.ai_note ?? null)");
    expect(a).toContain("unattendedResume({ note: nr.ai_note");
    expect(a).toContain('.or("sent_by.not.is.null,meta->>owner.eq.true")');
    expect(a).toContain("(last.meta as { escalation?: boolean } | null)?.escalation !== true");
    expect(a).toContain("m.meta?.fallback || m.meta?.escalation");
    expect(a).toContain("resumedNote(replyLocale)");
    const w = read("lib/ai/watchdog.ts");
    expect(w).toContain("export async function runTechnicalRescue");
    expect(w).toContain("await runTechnicalRescue(");
  });
});

describe("the AI team speaks the business language and keeps trying", () => {
  it("log lines with a Hebrew name inside are translated too", () => {
    expect(localizeLog("Employee hired: ולדימיר (analyst)", "he")).toBe("עובד/ת חדש/ה בצוות: ולדימיר");
    expect(localizeLog('Plan for "להגדיל לידים": 3 tasks, est. 40 credits.', "he")).toBe('תוכנית ל"להגדיל לידים": 3 משימות, הערכה 40 קרדיטים.');
    expect(localizeLog("The team is turned off.", "he")).toBe("הצוות כבוי.");
    expect(localizeLog("Self-check passed.", "he")).toBe("הבדיקה העצמית עברה.");
    expect(localizeLog("Decision (fast) — לקרוא נתונים · confidence 70% · audit: approve", "he")).toBe("החלטה (מסלול מהיר) — לקרוא נתונים · ביטחון 70% · ביקורת: אושר");
    expect(localizeLog("2 steps · deliverable: report · est. 3 credits", "he")).toContain("צעדים · תוצר: דוח");
    // Hebrew lines and English for English businesses stay as they are
    expect(localizeLog("הדוח מוכן.", "he")).toBe("הדוח מוכן.");
    expect(localizeLog("Self-check passed.", "en")).toBe("Self-check passed.");
  });

  it("initiative and radar titles are in Hebrew", () => {
    expect(localizeTitle("Leads dropped sharply — find out why", "he")).toBe("ירידה חדה בלידים — לברר למה");
    expect(localizeTitle("3 hot lead(s) are waiting for a person (longest 5h)", "he")).toBe("3 לידים חמים מחכים לאדם (הכי ותיק: 5 שעות)");
    expect(localizeTitle("Lead surge: 9 yesterday vs 3.5 on average", "he")).toBe("זינוק בלידים: 9 אתמול לעומת 3.5 בממוצע");
    expect(read("lib/team/runner.ts")).toContain("title: localizeTitle(p.title, lang)");
  });

  it("decision records are asked for in the business language", () => {
    expect(decisionLanguageLine("he")).toContain("Hebrew");
    expect(decisionLanguageLine("ar")).toContain("Arabic");
    expect(read("lib/team/engine-plus7.ts")).toContain("decisionLanguageLine(deps.lang)");
  });

  it("busy engines get hours of retries, not four quick tries", () => {
    const r = read("lib/team/runner-plus.ts");
    expect(r).toContain("const TEMP_MAX_ATTEMPTS = 10;");
    expect(r).toContain('kind === "ai_busy" || kind === "network" || kind === "ai_unreadable" ? TEMP_MAX_ATTEMPTS : MAX_ATTEMPTS');
    expect(r).toContain("now - 24 * 3600_000");
  });

  it("a due date in words no longer fails a task", () => {
    expect(safeDueIso("מחר")).toBeNull();
    expect(safeDueIso("tomorrow")).toBeNull();
    expect(safeDueIso("")).toBeNull();
    expect(safeDueIso("2026-11-06")).toBe("2026-11-06T00:00:00.000Z");
    expect(safeDueIso("2026-11-06T10:30:00Z")).toBe("2026-11-06T10:30:00.000Z");
  });

  it("technical AI engine details are for the platform admin only", () => {
    const p = read("lib/team/page-data.ts");
    expect(p).toContain("models: opts.platformAdmin ? h.models : []");
    expect(p).toContain("opts.platformAdmin ? p8.loadSkippedProviders(lang8)");
    expect(p).toContain("showProviders: opts.platformAdmin");
    expect(read("components/ai-team/health-panel.tsx")).toContain("health.showModels === false ? null");
    expect(read("components/ai-team/day-health-card.tsx")).toContain("day.showProviders === false ? null");
  });
});

describe("display polish", () => {
  it("tool lines in the team log are in the business language", async () => {
    const { localizeToolLine } = await import("@/lib/team/title-i18n-core");
    const label = (k: string) => (k === "goals.list" ? "רשימת יעדים" : null);
    expect(localizeToolLine("goals.list: no goals recorded", "he", label)).toBe("רשימת יעדים: אין יעדים רשומים");
    expect(localizeToolLine("reviews.recent: no recent reviews", "he")).toBe("reviews.recent: אין ביקורות אחרונות");
    expect(localizeToolLine("social.performance: 0 posts in 30 days. Top: —.", "he")).toContain("0 פוסטים ב-30 ימים");
    expect(localizeToolLine("Report ready.", "he")).toBe("Report ready."); // not a tool line → untouched here
    expect(localizeToolLine("goals.list: no goals recorded", "en")).toBe("goals.list: no goals recorded");
  });

  it("automatic e-mails are recognised by the sender name", async () => {
    const { isRobotName } = await import("@/lib/inbox/robots-core");
    for (const n of ["Mail Delivery Subsystem", "MAILER-DAEMON", "noreply@site.com", "Notifications", "Postmaster"]) expect(isRobotName(n), n).toBe(true);
    for (const n of ["דנה לוי", "Artlist", "Notion Team member", "", null]) expect(isRobotName(n), String(n)).toBe(false);
    expect(read("app/[locale]/(dashboard)/inbox/page.tsx")).toContain("robotIds.has(c.id) ? null : waitingMinutes(c, nowMs)");
  });

  it("every tab opens with its main work; extra cards follow under a heading", () => {
    const s = read("components/ai-team/team-screen.tsx");
    expect(s.indexOf('{tab === "goals" ? <GoalsPanel')).toBeLessThan(s.indexOf('{tab === "goals" && data.plus7 ? ('));
    expect(s.indexOf('{tab === "memory" ? <MemoryPanel')).toBeLessThan(s.indexOf('{tab === "memory" && data.facts ? ('));
    expect(s.indexOf('{tab === "activity" ? <ActivityPanel')).toBeLessThan(s.indexOf('{tab === "activity" && data.plus7?.decisions ? ('));
    expect(s.indexOf('{tab === "settings" ? <SettingsPanel')).toBeLessThan(s.indexOf('{tab === "settings" && data.plus8 ? ('));
    const p = read("components/ai-team/panels.tsx");
    expect(p.indexOf('data-testid="emergency-stop"')).toBeLessThan(p.indexOf("<HealthPanel health={data.health} />"));
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const k of ["goals", "memory", "activity", "settings"]) expect(typeof d.aiTeam.more[k], `${l}.${k}`).toBe("string");
    }
  });
});
