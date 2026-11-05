import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUALITY_SCENARIOS, runQualityScenarios, scenarioCorrection } from "@/lib/ai/quality-scenarios";
import { FEEDBACK_ACTION, feedbackRow, parseFeedback, summarizeFeedback } from "@/lib/ai/reply-feedback-core";
import { MIN_SAMPLE, resolutionStats, sameQuestion, type ResMsg } from "@/lib/ai/resolution-core";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("wave 69 — fixed quality scenarios (no AI call)", () => {
  it("has 30–50 scenarios, unique ids, all three languages and every group", () => {
    expect(QUALITY_SCENARIOS.length).toBeGreaterThan(29);
    expect(QUALITY_SCENARIOS.length).toBeLessThan(51);
    expect(new Set(QUALITY_SCENARIOS.map((s) => s.id)).size).toBe(QUALITY_SCENARIOS.length);
    for (const l of ["he", "en", "ar"]) expect(QUALITY_SCENARIOS.some((s) => s.lang === l)).toBe(true);
    for (const g of ["price", "warranty", "eta", "language", "empathy", "robotic", "length", "clean", "combined"]) expect(QUALITY_SCENARIOS.some((s) => s.group === g)).toBe(true);
  });
  for (const r of runQualityScenarios()) {
    it(`[${r.group}/${r.lang}] ${r.title}`, () => {
      expect(r.got, `${r.id}: got ${r.got.join(",") || "none"}, wanted ${r.expect.join(",") || "none"}`).toEqual(r.expect);
    });
  }
  it("the correction prompt keeps the base lines and adds one line per issue", () => {
    const base = "(system) Your previous draft was not sent because:\n- earlier problem\nWrite the corrected reply now.";
    const s = QUALITY_SCENARIOS.find((x) => x.id === "x-everything");
    expect(s).toBeDefined();
    if (!s) return;
    const out = scenarioCorrection(s, base);
    expect(out).toContain("- earlier problem");
    expect(out).toContain("percentage");
    expect(out).toContain("warranty");
    expect(out).toContain("Hebrew");
    expect(out).toContain("emoji");
    expect(out.endsWith("Write the corrected reply now.")).toBe(true);
  });
});

describe("wave 69 — 👍/👎 on agent replies (core)", () => {
  it("accepts only up / down; a reason only on a down and only a known one", () => {
    expect(parseFeedback({ rating: "up" })).toEqual({ ok: true, rating: "up", reason: null });
    expect(parseFeedback({ rating: "up", reason: "tone" })).toEqual({ ok: true, rating: "up", reason: null });
    expect(parseFeedback({ rating: "down", reason: "tone" })).toEqual({ ok: true, rating: "down", reason: "tone" });
    expect(parseFeedback({ rating: "down", reason: "<script>" })).toEqual({ ok: true, rating: "down", reason: null });
    expect(parseFeedback({ rating: "meh" }).ok).toBe(false);
    expect(parseFeedback(null).ok).toBe(false);
    expect(parseFeedback({}).ok).toBe(false);
  });
  it("builds an audit-log row for the message, with no new table", () => {
    const r = feedbackRow({ orgId: "o", actorId: "u", messageId: "m", conversationId: "c", agentId: "a", rating: "down", reason: "tone" });
    expect(r.action).toBe(FEEDBACK_ACTION);
    expect(r.entity_type).toBe("message");
    expect(r.entity_id).toBe("m");
    expect(r.metadata).toEqual({ rating: "down", reason: "tone", conversation_id: "c", agent_id: "a" });
  });
  it("counts the latest rating per person per message", () => {
    const row = (entity: string, actor: string, at: string, rating: string, reason?: string) => ({ entity_id: entity, actor_id: actor, created_at: at, metadata: { rating, reason } });
    const s = summarizeFeedback([
      row("m1", "u1", "2026-11-01T10:00:00Z", "down", "tone"),
      row("m1", "u1", "2026-11-01T11:00:00Z", "up"), // changed their mind
      row("m2", "u1", "2026-11-01T10:00:00Z", "down", "wrong_info"),
      row("m2", "u2", "2026-11-01T10:00:00Z", "up"),
      row("m3", "u1", "2026-11-01T10:00:00Z", "weird"), // ignored
      { entity_id: null, actor_id: "u1", created_at: "2026-11-01T10:00:00Z", metadata: { rating: "up" } }, // ignored
    ]);
    expect(s).toEqual({ up: 2, down: 1, total: 3, upRate: 67, reasons: { wrong_info: 1 } });
    expect(summarizeFeedback([])).toEqual({ up: 0, down: 0, total: 0, upRate: null, reasons: {} });
  });
});

describe("wave 69 — resolution metrics (core)", () => {
  const t = (n: number) => new Date(Date.UTC(2026, 10, 1, 10, n)).toISOString();
  const m = (c: string, direction: string, body: string, n: number, ai: string | null = null): ResMsg => ({ conversationId: c, direction, body, aiAgentId: ai, createdAt: t(n) });
  it("the same question: 3+ words and 80% shared; re-phrasing is not matched", () => {
    expect(sameQuestion("כמה עולה תספורת אצלכם", "כמה עולה תספורת אצלכם??")).toBe(true);
    expect(sameQuestion("how much is a haircut", "How much is a haircut?")).toBe(true);
    expect(sameQuestion("כמה עולה", "כמה עולה")).toBe(false);
    expect(sameQuestion("כמה עולה תספורת אצלכם", "מתי אתם פתוחים בשבת")).toBe(false);
  });
  it("closed without a person vs handed over vs still open; repeated question", () => {
    const convs = [
      { id: "a", status: "closed" },
      { id: "b", status: "closed", aiMode: "human" },
      { id: "c", status: "closed", handoffAt: t(5) },
      { id: "d", status: "closed" },
      { id: "e", status: "open" },
      { id: "f", status: "closed" }, // no agent reply at all: not counted
    ];
    const msgs: ResMsg[] = [
      m("a", "in", "כמה עולה תספורת אצלכם", 0), m("a", "out", "120 ש״ח", 1, "ag"),
      m("b", "in", "שאלה", 0), m("b", "out", "תשובה", 1, "ag"),
      m("c", "in", "שאלה", 0), m("c", "out", "תשובה", 1, "ag"),
      m("d", "in", "כמה עולה תספורת אצלכם", 0), m("d", "out", "120 ש״ח", 1, "ag"), m("d", "in", "כמה עולה תספורת אצלכם?", 2), m("d", "out", "אחד עשרים", 3, "ag"), m("d", "out", "אני כאן", 4),
      m("e", "in", "היי", 0), m("e", "out", "שלום", 1, "ag"),
      m("f", "in", "היי", 0), m("f", "out", "שלום", 1),
    ];
    const s = resolutionStats(convs, msgs);
    expect(s.aiConversations).toBe(5);
    expect(s.closedWithoutHuman).toBe(1); // only "a"; "d" had a person's message
    expect(s.repeatedConversations).toBe(1); // "d"
    expect(s.closedRate).toBe(20);
    expect(s.repeatRate).toBe(20);
  });
  it("the same question twice BEFORE any answer is not a repeat", () => {
    const s = resolutionStats([{ id: "x", status: "open" }], [m("x", "in", "כמה עולה תספורת אצלכם", 0), m("x", "in", "כמה עולה תספורת אצלכם", 1), m("x", "out", "120", 2, "ag")]);
    expect(s.repeatedConversations).toBe(0);
  });
  it("below the minimum sample no percentage is shown", () => {
    const s = resolutionStats([{ id: "x", status: "closed" }], [m("x", "in", "היי", 0), m("x", "out", "שלום", 1, "ag")]);
    expect(MIN_SAMPLE).toBe(5);
    expect(s.aiConversations).toBe(1);
    expect(s.closedRate).toBeNull();
    expect(s.repeatRate).toBeNull();
  });
  it("empty input is safe", () => {
    expect(resolutionStats([], [])).toEqual({ aiConversations: 0, closedWithoutHuman: 0, repeatedConversations: 0, closedRate: null, repeatRate: null });
  });
});

describe("wave 69 — wiring (text checks) and fail-silent", () => {
  it("loaders and the card swallow every failure", () => {
    const loader = read("../../lib/ai/resolution.ts");
    expect(loader.match(/catch/g)?.length).toBeGreaterThan(1);
    expect(loader).toMatch(/return null/);
    expect(read("../../components/analytics/quality-section.tsx")).toMatch(/catch \{\s*return null;/);
    expect(read("../../app/[locale]/(dashboard)/inbox/feedback-actions.ts")).toMatch(/catch \{\s*return \{ error/);
  });
  it("the inbox keeps its message query and only gains the feedback buttons on agent replies", () => {
    const page = read("../../app/[locale]/(dashboard)/inbox/page.tsx");
    expect(page).toContain('.select("id, direction, body, status, error, created_at, sent_by, media, ai_agent_id, meta")');
    expect(page).toContain("<ReplyFeedback messageId={m.id as string} />");
    expect(page).toMatch(/out && m\.ai_agent_id && ctx\.can\("inbox\.reply"\)/);
  });
  it("the analytics page gains one line", () => {
    expect(read("../../app/[locale]/(dashboard)/analytics/page.tsx")).toContain("<QualitySection orgId={ctx.org.id} locale={locale} days={days} />");
  });
  it("the same texts exist in he, en and ar", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`../../lib/i18n/dictionaries/${l}.json`)) as { aiQuality: { feedback: Record<string, string>; card: Record<string, string> } };
      for (const k of ["label", "up", "down", "saved"]) expect(d.aiQuality.feedback[k]?.length).toBeGreaterThan(1);
      for (const k of ["title", "window", "closedAlone", "repeat", "ofConvs", "rating", "ratingLine", "notEnough"]) expect(d.aiQuality.card[k]?.length).toBeGreaterThan(1);
    }
  });
});
