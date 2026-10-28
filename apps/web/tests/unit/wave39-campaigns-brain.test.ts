import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import he from "@/lib/i18n/dictionaries/he.json";
import en from "@/lib/i18n/dictionaries/en.json";
import ar from "@/lib/i18n/dictionaries/ar.json";
import {
  AUDIENCE_PRESETS,
  analyzeMessage,
  campaignInsights,
  channelPerformance,
  monthlyTrend,
  portfolioInsights,
  readiness,
  renderPreview,
  smsSegments,
  suggestSendTimes,
} from "@/lib/campaigns/brain";
import { GOALS, IMPROVE_MODES, TONES, keepsVariables, parseAgentPlan, parseCoach, parseImproved, parseSubjects, parseVariants } from "@/lib/campaigns/ai-core";

const GOOD = "היי {{contact.first_name}}, יש לנו הטבה מיוחדת של 10% עד יום חמישי. להזמנה היכנסו ל-https://example.com/sale או השיבו להודעה זו. להסרה השיבו הסר.";

describe("wave 39 — message analysis", () => {
  it("scores a complete, personalized message high and a spammy one low", () => {
    const good = analyzeMessage({ channel: "whatsapp", body: GOOD, hasTemplate: true });
    expect(good.score).toBeGreaterThanOrEqual(85);
    const bad = analyzeMessage({ channel: "email", subject: "", body: "ACT NOW!!! FREE MONEY guaranteed WINNER click here" });
    expect(bad.score).toBeLessThan(40);
    expect(bad.checks.find((c) => c.id === "subject")?.level).toBe("bad");
    expect(bad.spamHits.length).toBeGreaterThan(1);
  });
  it("empty message is 0 and never throws", () => {
    expect(analyzeMessage({ channel: "sms", body: "" }).score).toBe(0);
    expect(analyzeMessage({ channel: "sms", body: "   " }).level).toBe("weak");
  });
  it("sms segments: GSM vs UCS-2 (Hebrew / Arabic / emoji)", () => {
    expect(smsSegments("hello")).toMatchObject({ encoding: "gsm", segments: 1 });
    expect(smsSegments("a".repeat(161))).toMatchObject({ encoding: "gsm", segments: 2, perSegment: 153 });
    expect(smsSegments("שלום")).toMatchObject({ encoding: "ucs2", segments: 1 });
    expect(smsSegments("ש".repeat(71)).segments).toBe(2);
    expect(smsSegments("").segments).toBe(0);
    expect(smsSegments("hi 😀").encoding).toBe("ucs2");
  });
  it("sms cost shows up as a check", () => {
    const r = analyzeMessage({ channel: "sms", body: "ש".repeat(300) });
    expect(r.segments?.segments).toBeGreaterThan(3);
    expect(r.checks.find((c) => c.id === "sms_segments")?.level).toBe("bad");
  });
  it("preview fills the merge variables (spaces tolerated)", () => {
    expect(renderPreview("Hi {{ contact.first_name }} from {{org.name}}", { first_name: "Dana", org: "Acme" })).toBe("Hi Dana from Acme");
  });
});

describe("wave 39 — readiness", () => {
  const base = { channel: "email" as const, channelConnected: true, name: "Spring", body: "x", subject: "Hello there friend", audienceCount: 120, messageScore: 80 };
  it("ready only when nothing is blocking and the audience is counted", () => {
    expect(readiness(base).ready).toBe(true);
    expect(readiness({ ...base, audienceCount: null }).ready).toBe(false);
    expect(readiness({ ...base, audienceCount: 0 }).ready).toBe(false);
    expect(readiness({ ...base, channelConnected: false }).ready).toBe(false);
    expect(readiness({ ...base, dirty: true }).ready).toBe(false);
    expect(readiness({ ...base, subject: "" }).ready).toBe(false);
  });
  it("a past schedule blocks, a future one does not", () => {
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(readiness({ ...base, scheduledAt: "2026-10-27T10:00:00Z", now }).ready).toBe(false);
    expect(readiness({ ...base, scheduledAt: "2026-10-29T10:00:00Z", now }).ready).toBe(true);
  });
  it("whatsapp without a template is a warning, not a block", () => {
    const r = readiness({ ...base, channel: "whatsapp", hasTemplate: false });
    expect(r.items.find((i) => i.id === "template")?.level).toBe("warn");
    expect(r.ready).toBe(true);
  });
});

describe("wave 39 — send times, presets, performance", () => {
  it("suggests future, sorted slots", () => {
    const from = new Date("2026-10-28T12:00:00");
    for (const ch of ["email", "whatsapp", "sms", "telegram"] as const) {
      const s = suggestSendTimes(ch, from, 3);
      expect(s).toHaveLength(3);
      for (let i = 0; i < s.length; i++) {
        expect(s[i]!.at.getTime()).toBeGreaterThan(from.getTime());
        if (i) expect(s[i]!.at.getTime()).toBeGreaterThanOrEqual(s[i - 1]!.at.getTime());
      }
      // never on Friday evening / Saturday
      for (const x of s) expect([5, 6]).not.toContain(x.at.getDay());
    }
  });
  it("audience presets only use keys the campaign schema knows", () => {
    const known = new Set(["status", "source", "tags", "min_score", "max_score", "sentiment", "stage", "active_days", "inactive_days", "purchases_min"]);
    for (const p of AUDIENCE_PRESETS) for (const k of Object.keys(p.audience)) expect(known.has(k), `${p.id}.${k}`).toBe(true);
  });
  it("insights: failures, stuck sends, drafts waiting, best channel", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(campaignInsights({ status: "sent", channel: "email", stats: { recipients: 100, sent: 60, failed: 40 } }, now).map((i) => i.key)).toContain("high_failure");
    expect(campaignInsights({ status: "sent", channel: "email", stats: { recipients: 100, sent: 99, failed: 1 } }, now).map((i) => i.key)).toContain("great_delivery");
    expect(campaignInsights({ status: "sending", channel: "sms", stats: { recipients: 100, sent: 10 }, launched_at: "2026-10-28T05:00:00Z" }, now).map((i) => i.key)).toContain("stuck_sending");
    expect(campaignInsights({ status: "draft", channel: "sms" }, now)).toEqual([]);
    const p = portfolioInsights(
      [
        { status: "draft", channel: "email", created_at: "2026-10-01T00:00:00Z" },
        { status: "sent", channel: "email", stats: { recipients: 100, sent: 98 } },
        { status: "sent", channel: "sms", stats: { recipients: 100, sent: 80 } },
      ],
      now,
    ).map((i) => i.key);
    expect(p).toEqual(expect.arrayContaining(["draft_waiting", "channel_best"]));
  });
  it("channel performance and monthly trend ignore drafts and old months", () => {
    const rows = [
      { status: "sent", channel: "email", stats: { recipients: 100, sent: 90 }, launched_at: "2026-10-05T00:00:00" },
      { status: "draft", channel: "email", stats: { recipients: 999, sent: 999 }, created_at: "2026-10-06T00:00:00" },
      { status: "sent", channel: "sms", stats: { recipients: 10, sent: 10 }, launched_at: "2025-01-05T00:00:00" },
    ];
    expect(channelPerformance(rows).find((c) => c.channel === "email")).toMatchObject({ campaigns: 1, sent: 90, rate: 0.9 });
    const t = monthlyTrend(rows, 6, new Date("2026-10-28T00:00:00"));
    expect(t).toHaveLength(6);
    expect(t[5]).toMatchObject({ key: "2026-10", sent: 90, recipients: 100 });
  });
});

describe("wave 39 — AI parsers are strict", () => {
  it("variants: strips HTML, needs a subject for e-mail, caps at 3", () => {
    const raw = JSON.stringify({ variants: [1, 2, 3, 4].map((i) => ({ angle: `a${i}`, subject: i === 2 ? "" : `Subject ${i} here`, body: `<b>Body ${i}</b>` })) });
    const v = parseVariants(raw, "email");
    expect(v).toHaveLength(3);
    expect(v[0]!.body).toBe("Body 1");
    expect(v.every((x) => x.subject)).toBe(true);
    expect(parseVariants("nonsense", "sms")).toEqual([]);
    expect(parseVariants(JSON.stringify({ variants: [{ body: "hi", subject: "ignored" }] }), "sms")[0]!.subject).toBe("");
  });
  it("improved: parses fenced JSON; the AI may not drop merge variables", () => {
    expect(parseImproved('```json\n{"subject":"S","body":"Hi {{contact.first_name}}"}\n```', "email")).toEqual({ subject: "S", body: "Hi {{contact.first_name}}" });
    expect(parseImproved("{}", "sms")).toBeNull();
    expect(keepsVariables("Hi {{contact.first_name}}", "Hello there")).toBe(false);
    expect(keepsVariables("Hi {{contact.first_name}}", "Hello {{contact.first_name}}!")).toBe(true);
    expect(keepsVariables("no vars", "anything")).toBe(true);
  });
  it("subjects: de-duplicated, max 5", () => {
    const s = parseSubjects(JSON.stringify({ subjects: ["Big sale today", "big sale today", "Another one", "x", "Third idea", "Fourth idea", "Fifth idea", "Sixth idea"] }));
    expect(s).toEqual(["Big sale today", "Another one", "Third idea", "Fourth idea", "Fifth idea"]);
  });
  it("agent plan: validated through the campaign schema; unknown tags and channels never get through", () => {
    const ok = parseAgentPlan(JSON.stringify({ name: "Winback", channel: "whatsapp", subject: "", body: "Hi {{contact.first_name}}", audience: { inactive_days: 90, tags: ["vip", "ghost"], hack: 1 }, send_hint: "evening", rationale: "Quiet customers respond to a personal ping." }), { tags: ["vip"] });
    expect(ok).toMatchObject({ channel: "whatsapp", sendHint: "evening", audience: { inactive_days: 90, tags: ["vip"] } });
    expect(ok?.audience).not.toHaveProperty("hack");
    expect(parseAgentPlan(JSON.stringify({ name: "x", channel: "fax", body: "y" }), { tags: [] })).toBeNull();
    expect(parseAgentPlan(JSON.stringify({ name: "x", channel: "email", subject: "", body: "y" }), { tags: [] })).toBeNull();
    expect(parseAgentPlan(JSON.stringify({ name: "x", channel: "sms", body: "y" }), { tags: [], allowed: ["email"] })).toBeNull();
  });
  it("coach needs at least one tip", () => {
    expect(parseCoach(JSON.stringify({ summary: "s", tips: ["a", "b"] }))).toEqual({ summary: "s", tips: ["a", "b"] });
    expect(parseCoach(JSON.stringify({ summary: "s", tips: [] }))).toBeNull();
  });
});

/* every key the new UI uses exists in all three languages */
function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
describe("wave 39 — translations", () => {
  const dicts = { he, en, ar } as Record<string, unknown>;
  const files = ["components/campaigns/campaign-studio.tsx", "components/campaigns/campaign-agent.tsx", "components/campaigns/campaign-coach.tsx", "components/campaigns/campaign-overview.tsx", "app/[locale]/(dashboard)/campaigns/actions.ts"];
  it("every literal campaigns.* key referenced by the new files exists", () => {
    const keys = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](campaigns\.[A-Za-z0-9_.]+)["'`]/g)) if (!m[1]!.startsWith("campaigns.manage")) keys.add(m[1]!); // campaigns.manage is a permission, not a text key
    expect(keys.size).toBeGreaterThan(30);
    for (const [name, d] of Object.entries(dicts)) for (const k of keys) expect(typeof get(d, k), `${name}:${k}`).toBe("string");
  });
  it("every enumerated key exists", () => {
    const enumerated = [
      ...GOALS.map((x) => `campaigns.studio.goals.${x}`),
      ...TONES.map((x) => `campaigns.studio.tones.${x}`),
      ...IMPROVE_MODES.map((x) => `campaigns.studio.modes.${x}`),
      ...["excellent", "good", "fair", "weak"].map((x) => `campaigns.studio.levels.${x}`),
      ...["length", "personal", "cta", "subject", "spam", "shout", "links", "emoji", "sms_segments", "optout", "template"].map((x) => `campaigns.studio.checks.${x}`),
      ...["length_short", "length_long", "personal", "cta", "subject", "spam", "shout", "links", "emoji", "sms_segments", "optout", "template"].map((x) => `campaigns.studio.hints.${x}`),
      ...AUDIENCE_PRESETS.map((p) => `campaigns.studio.presets.${p.id}`),
      ...["midweek_morning", "lunch", "evening", "sunday_start"].map((x) => `campaigns.studio.sendReasons.${x}`),
      ...["name", "message", "channel", "audience", "schedule", "quality", "template", "saved"].map((x) => `campaigns.studio.ready_${x}`),
      ...["high_failure", "low_delivery", "great_delivery", "stuck_sending", "small_audience", "scheduled_soon", "draft_waiting", "channel_best"].map((x) => `campaigns.insights.${x}`),
      ...["winback", "launch", "event", "feedback"].flatMap((x) => [`campaigns.agent.examples.${x}`, `campaigns.agent.examplesShort.${x}`]),
    ];
    for (const [name, d] of Object.entries(dicts)) for (const k of enumerated) expect(typeof get(d, k), `${name}:${k}`).toBe("string");
  });
});

describe("wave 39 — auto-send timing is timezone-safe", () => {
  it("computes slots in the customer's wall clock, always in the future, never Fri night / Sat", async () => {
    const { suggestSendInstants } = await import("@/lib/campaigns/brain");
    const now = Date.parse("2026-10-28T09:00:00Z"); // Wednesday
    for (const tz of [-180, -120, 0, 300]) {
      for (const ch of ["email", "whatsapp", "sms", "telegram"] as const) {
        const s = suggestSendInstants(ch, now, tz, 3);
        expect(s).toHaveLength(3);
        for (const x of s) {
          expect(x.atMs).toBeGreaterThan(now);
          const wall = new Date(x.atMs - tz * 60_000);
          expect([5, 6]).not.toContain(wall.getUTCDay());
          expect(wall.getUTCMinutes()).toBe(0);
        }
      }
    }
    // Israel (UTC+3 → offset -180): the email Tuesday slot is 10:00 local = 07:00Z
    const il = suggestSendInstants("email", now, -180, 3).find((x) => new Date(x.atMs).getUTCDay() === 2 && new Date(x.atMs).getUTCHours() === 7);
    expect(il).toBeTruthy();
  });
});
