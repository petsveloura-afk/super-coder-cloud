import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { abSummary, chooseOpener, decideWinner, openerInstruction, openersOf, variantFor } from "@/lib/ai/opener-ab-core";
import { cleanLearned, faqAppend } from "@/lib/ai/learn-core";
import { htmlToText, importedCount, interestingLinks, mergeImported, normalizeImport, pageMeta } from "@/lib/ai/site-import-core";
import { coachStats, coachTranscript, coachWorthIt, normalizeCoach, weekStart } from "@/lib/ai/coach-core";
import { isMissedCall, missedCallText } from "@/lib/voice/missed-call-core";
import { callbackCandidate, politeHour, purposeBrief, reminderWindow } from "@/lib/voice/outbound-core";
import { accountHealth, overallHealth, shouldAlert } from "@/lib/channels/health-core";
import { quickStartProgress, quickStartSteps, ringDash } from "@/lib/dashboard/quickstart-core";
import { isPositive, negativeReply, parseRating, positiveReply, ratingQuestion } from "@/lib/agents/review-gate-core";
import { DEFAULT_MINUTE_PACKS, isMinutePack, minutePacks, packByKey } from "@/lib/billing/packs-core";
import { minutesLeftWithPacks, overflowMinutes } from "@/lib/voice/platform-phone-core";
import { parseActionMarkers, parseAmount, agentActionsInstructions } from "@/lib/ai/agent-actions-core";
import { PLUS_DEFAULTS, PLUS_FIELDS } from "@/lib/agents/plus-core";
import { moreSetupSteps, voiceSetupSteps } from "@/lib/admin/setup-core";
import { WHATS_NEW_CARDS } from "@/lib/guide/whats-new";

const he = JSON.parse(readFileSync(join(__dirname, "../../lib/i18n/dictionaries/he.json"), "utf8"));

describe("wave 59 — the voice can be heard", () => {
  it("the security policy lets audio play (data: / blob: / https media)", () => {
    const cfg = readFileSync(join(__dirname, "../../next.config.ts"), "utf8");
    expect(cfg).toMatch(/media-src 'self' data: blob: https:/);
  });
});

describe("wave 59 — the agent learns from the owner", () => {
  it("approved answers join the FAQ once, newest kept when long", () => {
    const a = faqAppend("", "כמה עולה תספורת?", "150 ₪ לכלב קטן");
    expect(a).toBe("ש: כמה עולה תספורת?\nת: 150 ₪ לכלב קטן");
    expect(faqAppend(a, "כמה עולה תספורת?", "150 ₪ לכלב קטן")).toBe(a);
    const long = faqAppend("x".repeat(100), "q?", "answer here", 60);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toContain("answer here");
    expect(cleanLearned({ question: " ? ", answer: "" })).toBeNull();
  });

  it("the database trigger records only real questions answered by a person", () => {
    const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261031000001_wave59_growth_brain.sql"), "utf8");
    expect(sql).toMatch(/new\.ai_agent_id is not null/);
    expect(sql).toMatch(/exception when others then\s+null;/);
    expect(sql).not.toMatch(/drop table|drop column/i);
  });
});

describe("wave 59 — set up from the website", () => {
  it("reads visible text, meta and key links (same site only)", () => {
    const html = `<html><head><title>מספרת שירה</title><meta name="description" content="תספורות לכלבים"><script>evil()</script></head><body><h1>ברוכים הבאים</h1><p>תספורת 150&nbsp;₪</p><a href="/about">אודות</a><a href="https://other.com/prices">מחירון</a><a href="/prices">מחירון</a></body></html>`;
    expect(htmlToText(html)).toContain("תספורת 150 ₪");
    expect(htmlToText(html)).not.toContain("evil");
    expect(pageMeta(html)).toEqual({ title: "מספרת שירה", description: "תספורות לכלבים" });
    expect(interestingLinks(html, new URL("https://shira.co.il/"))).toEqual(["https://shira.co.il/about", "https://shira.co.il/prices"]);
  });

  it("fills ONLY empty fields, appends new FAQ, keeps the business's own text", () => {
    const imported = normalizeImport({ business: "מספרה", services: "תספורת 150", hours: "", flow: ["לברך", "לשאול"], menu: [], tone: "luxury", junk: 1 });
    expect(imported).toEqual({ business: "מספרה", services: "תספורת 150", flow: ["לברך", "לשאול"], tone: "luxury" });
    expect(importedCount(imported)).toBe(3);
    const { profile, filled } = mergeImported({ business: "שלי", flow: [] }, { ...imported, faq: "ש: חניה?\nת: יש" }, "https://shira.co.il/");
    expect(profile.business).toBe("שלי");
    expect(profile.services).toBe("תספורת 150");
    expect(profile.flow).toEqual(["לברך", "לשאול"]);
    expect(profile.website).toBe("https://shira.co.il/");
    expect(filled).toEqual(expect.arrayContaining(["services", "flow", "faq", "website", "tone"]));
    expect(filled).not.toContain("business");
  });
});

describe("wave 59 — A/B opening line", () => {
  it("stable split, winner only with enough data and a clear gap", () => {
    expect(openersOf({ openers: ["  היי!  שלום  ", "x", "שלום רב", "שלישי"] })).toEqual(["היי! שלום", "שלום רב"]);
    expect(variantFor("abc")).toBe(variantFor("abc"));
    expect(decideWinner({ n: [10, 40], leads: [1, 20] })).toBeNull();
    expect(decideWinner({ n: [40, 40], leads: [8, 9] })).toBeNull();
    expect(decideWinner({ n: [40, 40], leads: [8, 16] })).toBe(1);
    expect(chooseOpener("c1", ["רק אחת"], null)).toEqual({ variant: 0, text: "רק אחת" });
    expect(chooseOpener("c1", ["a1234", "b1234"], { n: [50, 50], leads: [30, 5] })).toEqual({ variant: 0, text: "a1234" });
    expect(openerInstruction('say "hi"')).toContain("'hi'");
    expect(abSummary({ n: [10, 20], leads: [5, 5] })).toMatchObject({ rates: [0.5, 0.25], winner: null, needed: 20 });
  });
});

describe("wave 59 — weekly coach", () => {
  it("week, stats, worth-it and a strict JSON shape", () => {
    expect(weekStart(new Date("2026-10-31T12:00:00Z"))).toBe("2026-10-25");
    expect(coachStats({ conversations: 10, leads: 3, handoffs: 1, lost: 4 })).toMatchObject({ conversion: 0.3 });
    expect(coachWorthIt(coachStats({ conversations: 2, leads: 0, handoffs: 0, lost: 2 }))).toBe(false);
    expect(normalizeCoach({ summary: "s", reasons: [{ reason: "מחיר", count: "3", fix: "להציג ערך" }, { reason: "" }], tips: ["a b c"] })).toEqual({ summary: "s", reasons: [{ reason: "מחיר", count: 3, fix: "להציג ערך" }], tips: ["a b c"] });
    expect(normalizeCoach("nope")).toBeNull();
    expect(coachTranscript([{ direction: "in", body: "hi", ai: false }, { direction: "out", body: "hello", ai: true }])).toBe("customer: hi\nagent: hello");
  });
});

describe("wave 59 — phone", () => {
  it("missed calls: busy / no answer / hung up silently — never outbound or real conversations", () => {
    expect(isMissedCall({ direction: "in", status: "no-answer", duration: null, callerTurns: 0 })).toBe(true);
    expect(isMissedCall({ direction: "in", status: "completed", duration: 4, callerTurns: 0 })).toBe(true);
    expect(isMissedCall({ direction: "in", status: "completed", duration: 4, callerTurns: 1 })).toBe(false);
    expect(isMissedCall({ direction: "in", status: "completed", duration: 90, callerTurns: 0 })).toBe(false);
    expect(isMissedCall({ direction: "out", status: "busy", duration: null, callerTurns: 0 })).toBe(false);
    expect(missedCallText("he", "מספרת שירה")).toContain("למספרת שירה");
    expect(missedCallText("en", "Acme", "Our own text here")).toBe("Our own text here");
  });

  it("outbound calls: polite hours, consent, the right leads, a clear purpose", () => {
    expect(politeHour(new Date("2026-11-01T08:00:00Z"))).toBe(true); // Sunday 10:00 Israel
    expect(politeHour(new Date("2026-10-31T09:00:00Z"))).toBe(false); // Saturday
    expect(politeHour(new Date("2026-11-01T20:00:00Z"))).toBe(false); // Sunday 22:00
    const now = new Date("2026-11-05T10:00:00Z");
    const base = { leadAt: "2026-11-01T10:00:00Z", lastCustomerAt: "2026-11-02T10:00:00Z", salesState: "qualified", consent: true, optedOut: false, now };
    expect(callbackCandidate(base)).toBe(true);
    expect(callbackCandidate({ ...base, consent: false })).toBe(false);
    expect(callbackCandidate({ ...base, salesState: "won" })).toBe(false);
    expect(callbackCandidate({ ...base, lastCustomerAt: "2026-11-05T08:00:00Z" })).toBe(false);
    const w = reminderWindow(new Date("2026-11-01T00:00:00Z"));
    expect(w.from).toBe("2026-11-01T20:00:00.000Z");
    expect(purposeBrief("reminder", "תספורת — מחר 10:00")).toContain("תספורת");
    expect(purposeBrief(null)).toBe("");
  });

  it("minute packs: separate keys, used only above the month", () => {
    expect(DEFAULT_MINUTE_PACKS.every((p) => isMinutePack(p.key))).toBe(true);
    expect(packByKey("min_100")?.credits).toBe(100);
    expect(packByKey("ai_500")?.credits).toBe(500);
    expect(minutePacks({ MINUTE_PACKS_JSON: '[{"key":"ai_x","credits":5,"usd":1}]' })).toEqual(DEFAULT_MINUTE_PACKS);
    expect(overflowMinutes(290, 310, 300)).toBe(10);
    expect(overflowMinutes(310, 320, 300)).toBe(10);
    expect(overflowMinutes(100, 120, 300)).toBe(0);
    expect(overflowMinutes(100, 900, 0)).toBe(0);
    expect(minutesLeftWithPacks(0, 50)).toBe(50);
    expect(minutesLeftWithPacks(null, 50)).toBeNull();
  });
});

describe("wave 59 — pay in the chat + smart reviews", () => {
  it("PAY marker: amount + description, one per reply, stripped from the text", () => {
    const r = parseActionMarkers("מעולה! שולח קישור 🙏 [[PAY: ₪250 | מקדמה לתור]] [[PAY: 10 | x2]]");
    expect(r.text).toBe("מעולה! שולח קישור 🙏");
    expect(r.actions).toEqual([{ kind: "pay", amount: 250, description: "מקדמה לתור" }]);
    expect(parseAmount("1,200.50 ש״ח")).toBe(1200.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("999999")).toBeNull();
    expect(agentActionsInstructions({ canBook: false, hasContact: true, canPay: true })).toContain("[[PAY:");
    expect(agentActionsInstructions({ canBook: false, hasContact: true })).not.toContain("[[PAY:");
  });

  it("ratings from digits, stars, words and emoji; happy → link, unhappy → owner", () => {
    expect(parseRating("5")).toBe(5);
    expect(parseRating("⭐⭐⭐⭐")).toBe(4);
    expect(parseRating("היה מעולה!")).toBe(5);
    expect(parseRating("לא מרוצה בכלל")).toBe(2);
    expect(parseRating("0501234567")).toBeNull();
    expect(parseRating("מתי אתם פתוחים?")).toBeNull();
    expect(isPositive(4)).toBe(true);
    expect(positiveReply("he", "https://g.page/r/x")).toContain("https://g.page/r/x");
    expect(negativeReply("en")).toMatch(/sorry/i);
    expect(ratingQuestion("he", { name: "דנה", org: "Acme" })).toContain("1 עד 5");
    expect(PLUS_DEFAULTS.reviews_requester.config.smart_gate).toBe(true);
    expect(PLUS_FIELDS.reviews_requester.some((f) => f.key === "smart_gate")).toBe(true);
  });
});

describe("wave 59 — less setup for everyone", () => {
  it("connection health: real problems alert once per 12h", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    expect(accountHealth({ kind: "telegram", status: "error", lastError: "x", lastInboundAt: null, createdAt: null, failed24h: 0, sent24h: 0 }, now)).toEqual({ level: "error", reason: "status_error" });
    expect(accountHealth({ kind: "whatsapp_qr", status: "active", lastError: null, lastInboundAt: "2026-10-31T10:00:00Z", createdAt: null, failed24h: 4, sent24h: 5 }, now).reason).toBe("send_failures");
    expect(accountHealth({ kind: "sms", status: "active", lastError: null, lastInboundAt: "2026-10-31T10:00:00Z", createdAt: null, failed24h: 0, sent24h: 9 }, now).level).toBe("ok");
    expect(shouldAlert({ level: "error", reason: "status_error" }, "2026-10-31T06:00:00Z", now)).toBe(false);
    expect(shouldAlert({ level: "error", reason: "status_error" }, "2026-10-30T20:00:00Z", now)).toBe(true);
    expect(shouldAlert({ level: "warning", reason: "send_failures" }, null, now)).toBe(false);
    expect(overallHealth(["ok", "quiet", "error"])).toBe("error");
  });

  it("quick start: five steps, progress ring, disappears when done", () => {
    const steps = quickStartSteps({ hasAgent: true, knowsBusiness: false, hasChannel: true, tested: false, appReady: false });
    expect(steps.map((s) => s.key)).toEqual(["agent", "site", "channel", "test", "app"]);
    expect(quickStartProgress(steps)).toMatchObject({ done: 2, pct: 40, complete: false, next: "site" });
    expect(ringDash(100).offset).toBe(0);
    expect(ringDash(0).offset).toBe(ringDash(0).circumference);
  });

  it("admin console: push keys + default voice in their own list, the earlier lists unchanged", () => {
    expect(voiceSetupSteps({}, "https://a").map((s) => s.key)).toEqual(["voice", "phone_platform"]);
    const more = moreSetupSteps({});
    expect(more.map((s) => s.key)).toEqual(["push", "voice_default"]);
    expect(more[0]!.done).toBe(false);
    expect(more[1]!.done).toBe(true);
  });
});

describe("wave 59 — guide + translations", () => {
  it("every new card is complete, points at a real screen and is translated", () => {
    for (const id of ["voice-works", "site-setup", "learn-from-you", "weekly-coach", "ab-opener", "missed-call-text", "auto-calls", "recordings", "minute-packs", "pay-in-chat", "review-gate", "health-center", "quick-start", "modern-screens"]) {
      const c = WHATS_NEW_CARDS.find((x) => x.id === id);
      expect(c, id).toBeTruthy();
      expect(c!.steps.length).toBeGreaterThanOrEqual(2);
      if (c!.screen) expect(existsSync(join(__dirname, `../../app/[locale]/(dashboard)/${c!.screen}`))).toBe(true);
    }
    for (const k of ["siteImport", "abOpener", "learn", "coach", "health", "quickStart", "liveFeed", "payChat", "reviewGate"]) expect(he[k], k).toBeTruthy();
    expect(he.phone.auto.missed_text.title).toBeTruthy();
    expect(he.crm.sources.phone).toBe("טלפון");
  });
});
