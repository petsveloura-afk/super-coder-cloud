import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_DEFAULTS,
  brainBrief,
  containsAvoided,
  engagementScore,
  isRepeat,
  learnFromPosts,
  mediaForDate,
  mergeHashtags,
  nextSlot,
  normalizeAutopilot,
  parseWeekPlan,
  pickPillar,
  pickVideoFile,
  pillarsFor,
  similarity,
  sumMetrics,
  telegramCaption,
  upcomingHolidays,
  videoQuery,
  weekSlots,
  zonedInstant,
  zonedParts,
} from "@/lib/social/brain-core";
import { baseMime, canvasSize, coverRect, headlineFrom, isRtl, kenBurns, pickRecorderType, timeline, wrapLines } from "@/lib/social/motion-core";
import { diagnosisAdvice, explainRegisterError, waDiagnosis } from "@/lib/channels/wa-register-core";

const dict = (l: string) => JSON.parse(readFileSync(join(__dirname, `../../lib/i18n/dictionaries/${l}.json`), "utf8"));
const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const get = (d: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);

describe("wave 61 — autopilot settings & time", () => {
  it("normalizes anything to safe settings", () => {
    const s = normalizeAutopilot({ enabled: true, mode: "auto", post_time: "25:99", days: [9, 1, 1, 3], platforms: ["tiktok"], media: "hologram", pillars: "טיפים\nמבצעים,טיפים", hashtags: "שיער טיפוח #עסק", telegram_chat: "bad" });
    expect(s.enabled).toBe(true);
    expect(s.mode).toBe("auto");
    expect(s.post_time).toBe(AUTOPILOT_DEFAULTS.post_time);
    expect(s.days).toEqual([1, 3]);
    expect(s.platforms).toEqual(["facebook"]);
    expect(s.media).toBe("image");
    expect(s.pillars).toEqual(["טיפים", "מבצעים"]);
    expect(s.hashtags).toEqual(["#שיער", "#טיפוח", "#עסק"]);
    expect(s.telegram_chat).toBeNull();
    expect(normalizeAutopilot({ telegram_chat: "@my_channel" }).telegram_chat).toBe("@my_channel");
    expect(normalizeAutopilot({ telegram_chat: "-1001234567890" }).telegram_chat).toBe("-1001234567890");
  });

  it("time zones: wall clock ↔ instant in Asia/Jerusalem", () => {
    const at = zonedInstant("2026-11-02", "10:00", "Asia/Jerusalem");
    expect(at.toISOString()).toBe("2026-11-02T08:00:00.000Z"); // winter UTC+2
    const summer = zonedInstant("2027-07-01", "10:00", "Asia/Jerusalem");
    expect(summer.toISOString()).toBe("2027-07-01T07:00:00.000Z"); // summer UTC+3
    expect(zonedParts(at, "Asia/Jerusalem")).toMatchObject({ hh: 10, mm: 0, dow: 1 });
  });

  it("next slot: the first allowed day, not yet planned, within the horizon", () => {
    const now = new Date("2026-11-01T20:00:00Z"); // Sunday 22:00 in Israel
    const s = nextSlot({ now, tz: "Asia/Jerusalem", postTime: "10:00", days: [0, 1, 2, 3, 4, 5], lastPlannedFor: null });
    expect(s?.date).toBe("2026-11-02");
    expect(nextSlot({ now, tz: "Asia/Jerusalem", postTime: "10:00", days: [0, 1, 2, 3, 4, 5], lastPlannedFor: "2026-11-02" })).toBeNull();
    // Saturday only → too far → nothing yet
    expect(nextSlot({ now, tz: "Asia/Jerusalem", postTime: "10:00", days: [6], lastPlannedFor: null })).toBeNull();
    // today's slot already passed (10:00 < 22:00) → tomorrow
    const morning = new Date("2026-11-02T06:00:00Z"); // 08:00 local → today's 10:00 is due
    expect(nextSlot({ now: morning, tz: "Asia/Jerusalem", postTime: "10:00", days: [1], lastPlannedFor: null })?.date).toBe("2026-11-02");
  });

  it("week slots skip taken days and disallowed days", () => {
    const slots = weekSlots({ now: new Date("2026-11-01T08:00:00Z"), tz: "Asia/Jerusalem", postTime: "09:30", days: [0, 1, 2, 3, 4], count: 3, taken: ["2026-11-03"] });
    expect(slots.map((x) => x.date)).toEqual(["2026-11-02", "2026-11-04", "2026-11-05"]);
  });

  it("mix alternates media by date, stably", () => {
    expect(mediaForDate("mix", "2026-11-02")).toBe("video");
    expect(mediaForDate("mix", "2026-11-03")).toBe("image");
    expect(mediaForDate("image", "2026-11-02")).toBe("image");
  });
});

describe("wave 61 — learning", () => {
  it("engagement score and metrics merge", () => {
    expect(engagementScore({ likes: 10, comments: 2, shares: 1 })).toBe(17);
    expect(engagementScore(null)).toBe(0);
    expect(sumMetrics([{ likes: 3 }, { likes: 2, comments: 1 }, null])).toMatchObject({ likes: 5, comments: 1 });
  });

  it("needs 3 posts, then finds best hours, pillars, media, length", () => {
    expect(learnFromPosts([{ body: "a", scheduled_at: "2026-10-01T16:00:00Z", pillar: "x", media: "image", engagement: 3 }]).posts).toBe(1);
    const l = learnFromPosts([
      { body: "טיפ קצר?", scheduled_at: "2026-10-01T17:00:00Z", pillar: "טיפ", media: "video", engagement: 40 },
      { body: "טיפ נוסף?", scheduled_at: "2026-10-02T17:00:00Z", pillar: "טיפ", media: "video", engagement: 30 },
      { body: "מבצע ".repeat(80), scheduled_at: "2026-10-03T07:00:00Z", pillar: "מבצע", media: "image", engagement: 5 },
      { body: "סיפור לקוח", scheduled_at: "2026-10-04T07:00:00Z", pillar: "סיפור", media: "text", engagement: 2 },
    ]);
    expect(l.posts).toBe(4);
    expect(l.bestHours[0]).toBe(20); // 17:00Z = 20:00 in Israel (summer time, UTC+3)
    expect(l.pillarScores["טיפ"]).toBe(35);
    expect(l.mediaScores.video).toBe(35);
    expect(l.questionsWork).toBe(true);
    expect(l.top[0]!.score).toBe(40);
    const brief = brainBrief(l);
    expect(brief).toContain("טיפ");
    expect(brief).toContain("video");
    expect(brainBrief(null)).toBe("");
  });

  it("pillar rotation never repeats the last one and prefers winners", () => {
    const p = ["a", "b", "c", "d"];
    expect(pickPillar(p, ["a"])).not.toBe("a");
    expect(pickPillar(p, ["b", "a", "c"], {}, 0)).toBe("d");
    expect(pickPillar(p, [], { c: 50, d: 1 }, 0)).toBe("c");
    expect(pillarsFor("he", [])).toContain("טיפ מקצועי");
    expect(pillarsFor("en", [" Mine "])).toEqual(["Mine"]);
  });

  it("detects repeats and avoided words", () => {
    expect(similarity("מבצע חורף על תספורת לכלבים", "מבצע חורף על תספורת לכלבים קטנים")).toBeGreaterThan(0.6);
    expect(isRepeat("טיפ לשמירה על פרווה בריאה", ["מבצע סוף שבוע לחתולים"])).toBe(false);
    expect(containsAvoided("המחיר הכי זול בעיר", "זול, מתחרים")).toEqual(["זול"]);
  });

  it("hashtags are merged on the last line without duplicates", () => {
    expect(mergeHashtags("שלום\n#טיפוח", ["#טיפוח", "#כלבים"], "facebook")).toBe("שלום\n#טיפוח #כלבים");
    expect(mergeHashtags("שלום", ["#א", "#ב"], "instagram")).toBe("שלום\n\n#א #ב");
    expect(mergeHashtags("x #a #b #c", ["#d"], "facebook")).toBe("x #a #b #c");
  });
});

describe("wave 61 — dates, plans, video, Telegram", () => {
  it("upcoming holidays nearest first", () => {
    const h = upcomingHolidays("2026-11-25", 12);
    expect(h[0]).toMatchObject({ key: "black_friday", inDays: 2 });
    expect(h.map((x) => x.key)).toContain("hanukkah");
  });

  it("parses the week plan JSON (tolerant)", () => {
    const plan = parseWeekPlan('```json\n[{"post":"שורה ראשונה מושכת\\nעוד שורה טובה","pillar":"טיפ","scene":"dog grooming","headline":"טיפ"},{"post":"קצר"}]\n```');
    expect(plan).toHaveLength(1);
    expect(plan[0]!.post).toContain("\n");
    expect(parseWeekPlan("no json")).toEqual([]);
  });

  it("stock video: query words and the best file", () => {
    expect(videoQuery("Barber cutting hair, close up shot!", "x")).toBe("barber cutting hair");
    expect(videoQuery("", "fallback")).toBe("fallback");
    const f = [
      { link: "https://v/1.mp4", width: 1920, height: 1080, file_type: "video/mp4" },
      { link: "https://v/2.mp4", width: 1080, height: 1920, file_type: "video/mp4" },
      { link: "https://v/3.mp4", width: 3840, height: 2160, file_type: "video/mp4" },
    ];
    expect(pickVideoFile(f, "instagram")).toBe("https://v/2.mp4");
    expect(pickVideoFile(f, "facebook")).toBe("https://v/1.mp4");
    expect(pickVideoFile([{ link: "http://insecure", width: 1, height: 1 }], "facebook")).toBeNull();
  });

  it("Telegram caption limits", () => {
    expect(telegramCaption("a".repeat(2000), true)).toHaveLength(1024);
    expect(telegramCaption("short", true)).toBe("short");
  });
});

describe("wave 61 — Motion Studio math", () => {
  it("sizes, cover crop and camera move", () => {
    expect(canvasSize("9:16")).toEqual({ w: 720, h: 1280 });
    const r = coverRect(2000, 1000, 1000, 1000, 1, 0, 0);
    expect(r).toMatchObject({ sw: 1000, sh: 1000, sx: 500, sy: 0 });
    const k0 = kenBurns(0, 0);
    const k1 = kenBurns(1, 0);
    expect(k1.zoom).toBeGreaterThan(k0.zoom);
    const tl = timeline(0.9);
    expect(tl.headline).toBeCloseTo(1, 1);
    expect(tl.cta).toBeGreaterThan(0.9);
  });

  it("wraps Hebrew text and picks the headline", () => {
    const lines = wrapLines("זה משפט ארוך מאוד שצריך להתפצל לכמה שורות בתוך הסרטון", 60, (s) => s.length * 4, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.every((l) => l.length * 4 <= 60 || !l.includes(" "))).toBe(true);
    expect(headlineFrom("🔥 מבצע סתיו לכל הכלבים! #טיפוח\nשורה שנייה")).toBe("מבצע סתיו לכל הכלבים!");
    expect(isRtl("שלום")).toBe(true);
    expect(isRtl("hello")).toBe(false);
  });

  it("prefers MP4 for recording, falls back to WebM", () => {
    expect(pickRecorderType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
    expect(pickRecorderType((t) => t === "video/mp4")).toBe("video/mp4");
    expect(pickRecorderType(() => false)).toBeNull();
    expect(baseMime("video/mp4;codecs=avc1")).toBe("video/mp4");
  });
});

describe("wave 61 — WhatsApp: Meta's reasons in plain words", () => {
  it("maps known Meta errors", () => {
    expect(explainRegisterError("(#133016) Account register deregister rate limit exceeded")).toBe("integrations.wa.why.tooMany");
    expect(explainRegisterError("(#133006) Phone number needs to be verified")).toBe("integrations.wa.why.verifyFirst");
    expect(explainRegisterError("(#200) Permissions error")).toBe("integrations.wa.why.permission");
    expect(explainRegisterError("something new")).toBeNull();
  });

  it("diagnosis rows and the first advice", () => {
    const rows = waDiagnosis({ display_phone_number: "+972 52-405-9003", platform_type: "NOT_APPLICABLE", status: "PENDING", code_verification_status: "VERIFIED", name_status: "APPROVED", account_mode: "LIVE" });
    expect(rows.find((r) => r.key === "platform_type")?.ok).toBe(false);
    expect(rows.find((r) => r.key === "code_verification_status")?.ok).toBe(true);
    expect(diagnosisAdvice(rows)).toBe("integrations.wa.advice.register");
    expect(diagnosisAdvice(waDiagnosis({ platform_type: "CLOUD_API", status: "CONNECTED", name_status: "PENDING_REVIEW" }))).toBe("integrations.wa.advice.nameReview");
  });

  it("team updates keep both WhatsApp reasons; the Meta failure page is localized", () => {
    expect(read("lib/notify/forward.ts")).toContain("qr: ${qrError}");
    expect(read("app/api/channels/meta/pages/oauth/route.ts")).toContain("integrations.wa.stuckBody");
  });
});

describe("wave 61 — wiring and translations", () => {
  it("cron route + workflow step exist; Telegram channel publishes after Meta", () => {
    expect(read("app/api/cron/social-brain/route.ts")).toContain("runSocialAutopilot");
    expect(readFileSync(join(__dirname, "../../../../.github/workflows/jobs.yml"), "utf8")).toContain("/api/cron/social-brain");
    expect(read("lib/social/publish.ts")).toContain("publishTelegram");
  });

  it("every new key exists in he, en and ar", () => {
    const he = dict("he");
    const keys: string[] = [];
    const walk = (o: Record<string, unknown>, pre: string) => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === "object") walk(v as Record<string, unknown>, `${pre}${k}.`);
        else keys.push(`${pre}${k}`);
      }
    };
    walk((he.social as Record<string, unknown>).brain as Record<string, unknown>, "social.brain.");
    walk((he.social as Record<string, unknown>).motion as Record<string, unknown>, "social.motion.");
    walk((he.social as Record<string, unknown>).power as Record<string, unknown>, "social.power.");
    expect(keys.length).toBeGreaterThan(150);
    for (const l of ["en", "ar"]) {
      const d = dict(l);
      for (const k of [...keys, "social.tabs.brain", "integrations.wa.stuckBody", "integrations.wa.diagnose", "notify.techDetails", "integrations.wa.why.coexist"]) expect(get(d, k), `${l}:${k}`).toBeTruthy();
    }
  });
});
