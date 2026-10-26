import { describe, expect, it } from "vitest";
import { SITE_FONTS, SITE_TEMPLATE_KEYS, siteBlockSchema, siteSchema } from "@scc/shared/engagement";
import { ALL_TEMPLATES, FONTS, FREE_TEMPLATES, TEMPLATES, resolveTheme, templateByKey } from "@/lib/site/templates";
import { EXTRA_TEMPLATES } from "@/lib/site/templates-plus";
import { KIT_KEYS, STARTER_KITS, kitBlocks, kitByKey } from "@/lib/site/starter-kits";
import { normalizeAiSite, siteJsonInstructionsPro } from "@/lib/ai/site-json";
import { AGENT_DEFAULTS, AGENTS, type AgentKey } from "@/lib/agents/core";
import { agentHealth, recommendations, teamScore, type AgentSnapshot } from "@/lib/agents/intelligence";
import he from "@/lib/i18n/dictionaries/he.json";
import en from "@/lib/i18n/dictionaries/en.json";
import ar from "@/lib/i18n/dictionaries/ar.json";

/** Wave 27 — more website templates + starter kits, and the AI team's brain. */
const hex = /^#[0-9a-fA-F]{6}$/;

describe("website templates", () => {
  it("the original ten are untouched; eight more are added, all paid", () => {
    expect(TEMPLATES).toHaveLength(10);
    expect(FREE_TEMPLATES).toEqual(["classic", "minimal", "fresh"]);
    expect(EXTRA_TEMPLATES).toHaveLength(8);
    expect(ALL_TEMPLATES).toHaveLength(18);
    expect(new Set(ALL_TEMPLATES.map((t) => t.key)).size).toBe(18);
    expect(EXTRA_TEMPLATES.every((t) => t.pro)).toBe(true);
  });
  it("every template key is allowed by the shared schema; fonts and colours are valid", () => {
    for (const t of ALL_TEMPLATES) {
      expect(SITE_TEMPLATE_KEYS).toContain(t.key);
      expect(SITE_FONTS).toContain(t.display);
      expect(SITE_FONTS).toContain(t.body);
      expect(FONTS[t.display]).toBeTruthy();
      expect(hex.test(t.accent) && hex.test(t.accent2)).toBe(true);
      expect(t.he.name && t.en.name && t.he.fits && t.en.fits).toBeTruthy();
    }
    expect(SITE_TEMPLATE_KEYS).toHaveLength(ALL_TEMPLATES.length);
  });
  it("the new ones resolve, are used by the public renderer's theme and parse in a site", () => {
    expect(templateByKey("noir").mode).toBe("dark");
    expect(resolveTheme({ template: "terracotta" }).tpl.key).toBe("terracotta");
    expect(templateByKey("nope").key).toBe("classic");
    const ok = siteSchema.safeParse({ name: "x", slug: "abc", theme: { accent: "#112233", mode: "light", template: "editorial" }, blocks: [{ type: "text", data: { title: "a", body: "b" } }] });
    expect(ok.success).toBe(true);
  });
  it("the AI may pick a new template when the plan allows it, and falls back when it doesn't", () => {
    const raw = { name: "Clinic", accent: "#2A8C82", template: "clinic", blocks: [{ type: "hero", data: { title: "Hi", subtitle: "x", cta_label: "Go", cta_href: "#contact" } }, { type: "text", data: { title: "A", body: "B" } }] };
    const all = ALL_TEMPLATES.map((t) => t.key);
    expect(normalizeAiSite(raw, "landing", {}, "x", { templates: all })?.theme.template).toBe("clinic");
    expect(normalizeAiSite(raw, "landing", {}, "x", { templates: FREE_TEMPLATES })?.theme.template).toBe("classic");
    expect(siteJsonInstructionsPro("landing", "en", {}, all)).toContain("terracotta");
  });
});

describe("industry starter kits", () => {
  it("six kits, each with a real template and valid colours", () => {
    expect(STARTER_KITS.map((k) => k.key)).toEqual([...KIT_KEYS]);
    for (const k of STARTER_KITS) {
      expect(ALL_TEMPLATES.some((t) => t.key === k.template)).toBe(true);
      expect(hex.test(k.accent) && hex.test(k.accent2)).toBe(true);
      expect(kitByKey(k.key)).toBe(k);
    }
  });
  it("every kit, in every language, is schema-valid: hero first, contact last, no invented contact details", () => {
    for (const k of KIT_KEYS) {
      for (const lang of ["he", "en", "ar"]) {
        const blocks = kitBlocks(k, lang);
        expect(blocks[0]!.type).toBe("hero");
        expect(blocks[blocks.length - 1]!.type).toBe("contact");
        expect(blocks.length).toBeGreaterThanOrEqual(6);
        for (const b of blocks) expect(siteBlockSchema.safeParse(b).success).toBe(true);
        const text = JSON.stringify(blocks);
        expect(text).not.toMatch(/https?:\/\/|@\w+\.\w+|\d{2,3}-\d{6,7}/);
        const contact = blocks.find((b) => b.type === "contact")!;
        expect(Object.entries(contact.data).filter(([key]) => key !== "title").every(([, v]) => v === "")).toBe(true);
      }
    }
  });
});

const snap = (key: AgentKey, over: Partial<AgentSnapshot> = {}): AgentSnapshot => ({ key, enabled: false, config: { ...AGENT_DEFAULTS[key].config }, lastRunAt: null, runs: [], ...over });
const NOW = new Date("2026-10-26T10:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("AI team brain", () => {
  it("health: off · never ran · stale · idle · active", () => {
    expect(agentHealth(snap("analyst"), NOW)).toMatchObject({ level: "off", score: 0 });
    expect(agentHealth(snap("analyst", { enabled: true }), NOW).reason).toBe("neverRan");
    expect(agentHealth(snap("analyst", { enabled: true, lastRunAt: ago(24 * 9), runs: [{ actions: 1, created_at: ago(24 * 9) }] }), NOW).reason).toBe("stale");
    const idle = [0, 1, 2].map((i) => ({ actions: 0, created_at: ago(20 + i) }));
    expect(agentHealth(snap("analyst", { enabled: true, lastRunAt: ago(20), runs: idle }), NOW).reason).toBe("idle");
    const active = agentHealth(snap("analyst", { enabled: true, lastRunAt: ago(20), runs: [{ actions: 2, created_at: ago(20) }] }), NOW);
    expect(active).toMatchObject({ reason: "active", level: "great" });
    expect(active.score).toBeGreaterThanOrEqual(80);
  });
  it("a weekly agent is not 'stale' after a few days", () => {
    expect(agentHealth(snap("marketing", { enabled: true, lastRunAt: ago(24 * 6), runs: [{ actions: 3, created_at: ago(24 * 6) }] }), NOW).reason).toBe("active");
  });
  it("team score: 0 with nothing on; grows with coverage and health; never above 100", () => {
    expect(teamScore(AGENTS.map((k) => snap(k)), NOW)).toBe(0);
    const one = teamScore([snap("analyst", { enabled: true, lastRunAt: ago(5), runs: [{ actions: 1, created_at: ago(5) }] }), ...AGENTS.filter((k) => k !== "analyst").map((k) => snap(k))], NOW);
    const all = teamScore(AGENTS.map((k) => snap(k, { enabled: true, lastRunAt: ago(5), runs: [0, 1, 2].map((i) => ({ actions: 2, created_at: ago(5 + i) })) })), NOW);
    expect(one).toBeGreaterThan(0);
    expect(all).toBeGreaterThan(one);
    expect(all).toBeLessThanOrEqual(100);
  });
  it("recommendations: start with the analyst, then collections first; each 'apply' is a valid change", () => {
    const none = recommendations(AGENTS.map((k) => snap(k)), NOW, 10);
    expect(none[0]!.id).toBe("start-analyst");
    expect(none.map((r) => r.id)).toContain("enable-collections");
    expect(none.every((r) => ["high", "medium", "low"].includes(r.severity))).toBe(true);
    const sorted = none.map((r) => ({ high: 0, medium: 1, low: 2 })[r.severity]);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });
  it("tuning advice only for agents that are on, with safe values", () => {
    const list = [
      snap("sales_manager", { enabled: true, lastRunAt: ago(5), runs: [{ actions: 1, created_at: ago(5) }], config: { quiet_days: 30, max_tasks: 5 } }),
      snap("collections", { enabled: true, lastRunAt: ago(2), runs: [{ actions: 1, created_at: ago(2) }], config: { gap_days: 3, max_reminders: 1, carts: false } }),
      snap("marketing", { enabled: false, config: { posts: 1, auto_publish: true } }),
      snap("analyst", { enabled: true, lastRunAt: ago(5), runs: [{ actions: 1, created_at: ago(5) }] }),
    ];
    const ids = recommendations(list, NOW, 20).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["tune-quiet", "tune-carts", "tune-reminders", "enable-marketing"]));
    expect(ids).not.toContain("tune-posts");
    expect(recommendations(list, NOW, 20).find((r) => r.id === "tune-quiet")!.apply).toEqual({ config: { quiet_days: 7 } });
  });
  it("a healthy full team gets no recommendations", () => {
    const good = AGENTS.map((k) => snap(k, { enabled: true, lastRunAt: ago(3), runs: [{ actions: 2, created_at: ago(3) }] }));
    expect(recommendations(good, NOW)).toEqual([]);
  });
});

describe("wave 27 translations", () => {
  const get = (o: unknown, path: string) => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
  const keys = [
    "websites.kits.title", "websites.kits.hint", "websites.kits.added", "websites.kits.full",
    "agents.brain.title", "agents.brain.subtitle", "agents.brain.score", "agents.brain.next", "agents.brain.apply", "agents.brain.allGood",
    ...["off", "great", "ok", "attention"].map((x) => `agents.brain.level.${x}`),
    ...["off", "neverRan", "stale", "idle", "active"].map((x) => `agents.brain.reason.${x}`),
    ...["high", "medium", "low"].map((x) => `agents.brain.sev.${x}`),
    ...["startAnalyst", "enableCollections", "enableSales", "enableAnalyst", "enableMarketing", "neverRan", "stale", "idle", "tuneQuiet", "tuneCarts", "tuneReminders", "tunePosts", "reviewFirst"].map((x) => `agents.brain.rec.${x}`),
  ];
  it("every new key exists in Hebrew, English and Arabic", () => {
    for (const [name, d] of [["he", he], ["en", en], ["ar", ar]] as const) for (const k of keys) expect(typeof get(d, k), `${name}:${k}`).toBe("string");
  });
  it("every recommendation text key the brain can produce is translated", () => {
    const all = recommendations([snap("sales_manager", { enabled: true, config: { quiet_days: 30 } }), snap("collections", { enabled: true, config: { max_reminders: 1, carts: false } }), snap("marketing", { enabled: true, config: { posts: 1, auto_publish: true } }), snap("analyst", { enabled: true, lastRunAt: ago(24 * 20), runs: [{ actions: 1, created_at: ago(24 * 20) }] })], NOW, 50);
    for (const r of all) expect(typeof get(en, r.textKey)).toBe("string");
  });
});
