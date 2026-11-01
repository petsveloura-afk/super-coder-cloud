import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventId, fingerprint, logLine, redact, redactText } from "@/lib/ops/log-core";
import { countItems, jobHealth } from "@/lib/ops/job-runs-core";
import { npsScore, opsItems, surveyAverage, worst, type OpsFacts } from "@/lib/ops/system-core";
import { cleanViewFilters, isActiveView, viewHref } from "@/lib/views-core";
import { scaleEnds, scaleValues, surveyMessage, surveyQuestion } from "@/lib/surveys-core";
import { openApiDocument } from "@/lib/openapi";
import { NAV_ITEMS } from "@/lib/navigation";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
const get = (d: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);

describe("observability — logs never contain personal data or secrets", () => {
  it("redacts emails, phones, tokens, keys and card numbers", () => {
    // fake secrets are assembled at runtime so secret scanners never see a token-shaped literal in the repo
    const fakeKey = ["sk", "live", "abcdefghijklmnop"].join("_");
    const fakeJwt = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghij"].join(".");
    const s = redactText(`mail dana@shop.co.il phone +972 52-405-9003 key ${fakeKey} jwt ${fakeJwt} card 4111 1111 1111 1111`);
    expect(s).not.toMatch(/dana@|405-9003|sk_live|eyJhbGci|4111/);
    expect(s).toContain("[email]");
    expect(s).toContain("[secret]");
  });
  it("redacts secret-looking keys inside objects and keeps the rest", () => {
    const r = redact({ password: "x", api_key: "y", nested: { authorization: "Bearer abc", route: "/he/inbox" }, count: 3 }) as Record<string, unknown>;
    expect(r.password).toBe("[secret]");
    expect(r.api_key).toBe("[secret]");
    expect((r.nested as Record<string, unknown>).authorization).toBe("[secret]");
    expect((r.nested as Record<string, unknown>).route).toBe("/he/inbox");
    expect(r.count).toBe(3);
    const line = JSON.parse(logLine("error", "failed for dana@x.com", { org: "o1" }, new Date("2026-11-01T00:00:00Z")));
    expect(line).toMatchObject({ level: "error", msg: "failed for [email]", org: "o1" });
  });
  it("groups the same error regardless of ids and numbers", () => {
    const a = fingerprint("server", "Timeout after 1500ms for 6f1c2a10-1111-4222-8333-944455556666", "/he/crm/6f1c2a10-1111-4222-8333-944455556666");
    const b = fingerprint("server", "Timeout after 2200ms for 0a1b2c3d-1111-4222-8333-944455556666", "/en/crm/0a1b2c3d-1111-4222-8333-944455556666");
    expect(a).toBe(b);
    expect(fingerprint("client", "x")).not.toBe(fingerprint("server", "x"));
    expect(eventId("abcdef1234567890")).toBe("abcdef123456");
  });
});

describe("cron governance", () => {
  it("counts the items a job handled", () => {
    expect(countItems({ ok: true, socialPosts: { claimed: 3, published: 2 }, metaSync: { ingested: 4 } })).toBe(9);
    expect(countItems(null)).toBe(0);
  });
  it("flags late and failing jobs", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(jobHealth(null, null, 5, now)).toBe("never");
    expect(jobHealth({ status: "ok", started_at: "2026-11-01T11:57:00Z" }, "2026-11-01T11:57:00Z", 5, now)).toBe("ok");
    expect(jobHealth({ status: "ok", started_at: "2026-11-01T10:00:00Z" }, "2026-11-01T10:00:00Z", 5, now)).toBe("late");
    expect(jobHealth({ status: "error", started_at: "2026-11-01T11:58:00Z" }, "2026-11-01T11:00:00Z", 5, now)).toBe("failing");
  });
  it("every scheduled route records its run", () => {
    for (const r of ["cron/social", "cron/social-brain", "cron/growth", "cron/agents", "cron/meta-sync", "ai/followups", "billing/sweep"]) expect(read(`app/api/${r}/route.ts`), r).toContain("cronRoute(");
  });
});

describe("Mission Control", () => {
  const base: OpsFacts = {
    email: { provider: true, mailbox: "active", failed7d: 0 },
    social: { facebook: true, instagram: false, failed7d: 0, autopilotOn: true, autopilotError: null },
    payments: { platform: true },
    deliveries: { failed: 0, dead: 0, queuedLate: 0 },
    sites: { published: 2, domainsPending: 0 },
    surveys: { enabled: true, answered30d: 5, avg: 4.4 },
  };
  it("all good → every card ok", () => {
    expect(opsItems(base).every((i) => i.level === "ok")).toBe(true);
  });
  it("problems get the right level, reason and fix link", () => {
    const items = opsItems({ ...base, email: { provider: false, mailbox: "error", failed7d: 0 }, deliveries: { failed: 1, dead: 2, queuedLate: 0 }, social: { ...base.social, facebook: false, instagram: false } });
    expect(items.find((i) => i.key === "email")).toMatchObject({ level: "error", reason: "ops.r.mailboxError" });
    expect(items.find((i) => i.key === "deliveries")).toMatchObject({ level: "error", params: { n: 2 }, fix: "/health#deliveries" });
    expect(items.find((i) => i.key === "social")).toMatchObject({ level: "off" });
    expect(worst(items.map((i) => i.level))).toBe("error");
  });
  it("survey scores on one 0..5 scale; NPS formula", () => {
    expect(surveyAverage([{ kind: "csat", score: 5 }, { kind: "nps", score: 10 }, { kind: "ces", score: 1 }])).toBe(5);
    expect(surveyAverage([])).toBeNull();
    expect(npsScore([10, 9, 8, 6, 3])).toBe(0);
    expect(npsScore([10, 10, 9])).toBe(100);
  });
  it("the page, nav item and command exist", () => {
    expect(existsSync(join(root, "app/[locale]/(dashboard)/health/page.tsx"))).toBe(true);
    expect(NAV_ITEMS.find((n) => n.key === "health")).toMatchObject({ section: "ops", permission: "settings.manage" });
    expect(read("lib/command-actions.ts")).toContain('href: "/health"');
  });
});

describe("loading / error screens for every module", () => {
  it("each dashboard module has loading.tsx and error.tsx", () => {
    const dir = join(root, "app/[locale]/(dashboard)");
    const mods = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "page.tsx"))).map((d) => d.name);
    expect(mods.length).toBeGreaterThanOrEqual(27);
    for (const m of mods) {
      expect(existsSync(join(dir, m, "loading.tsx")), `${m}/loading.tsx`).toBe(true);
      expect(existsSync(join(dir, m, "error.tsx")), `${m}/error.tsx`).toBe(true);
    }
    expect(existsSync(join(root, "instrumentation.ts"))).toBe(true);
  });
});

describe("daily post closes the loop", () => {
  it("the created post opens in the drawer and is highlighted", () => {
    const sc = read("components/social/social-client.tsx");
    expect(sc).toContain("function PostDrawer");
    expect(sc).toContain("getPostAction");
    expect(sc).toContain("data-new");
    const bp = read("components/social/brain-panel.tsx");
    expect(bp).toContain("onCreated");
    expect(bp).toContain("brain-stages");
  });
});

describe("saved views", () => {
  it("cleans filters, builds links and recognizes the active view", () => {
    expect(cleanViewFilters({ q: " dana ", page: "3", status: "lead", "bad key": "x", token: "t" })).toEqual({ q: "dana", status: "lead" });
    expect(viewHref("/crm", { status: "lead", hot: "1" })).toBe("/crm?status=lead&hot=1");
    expect(isActiveView({ status: "lead" }, { status: "lead", page: "2" })).toBe(true);
    expect(isActiveView({ status: "lead" }, { status: "customer" })).toBe(false);
  });
});

describe("satisfaction surveys", () => {
  it("scales, questions and the message with the link", () => {
    expect(scaleValues("nps")).toHaveLength(11);
    expect(scaleValues("csat")).toEqual([1, 2, 3, 4, 5]);
    expect(surveyQuestion("csat", "he")).toContain("מרוצים");
    expect(surveyQuestion("nps", "en", "Custom?")).toBe("Custom?");
    const m = surveyMessage({ kind: "csat", locale: "he", orgName: "דנה", link: "https://x/he/r/abc" });
    expect(m).toContain("https://x/he/r/abc");
    expect(scaleEnds("ces", "ar")).toHaveLength(2);
    expect(read("proxy.ts")).toContain('"/r"');
  });
});

describe("OpenAPI", () => {
  it("documents only routes that exist", () => {
    const doc = openApiDocument("https://example.com");
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers[0]!.url).toBe("https://example.com/api/public/v1");
    for (const p of Object.keys(doc.paths)) {
      const file = join(root, "app/api/public/v1", p.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");
      expect(existsSync(file), p).toBe(true);
    }
  });
});

describe("security, privacy, audit", () => {
  it("two-step sign-in is enforced in the proxy for enrolled users only", () => {
    expect(read("lib/supabase/proxy-session.ts")).toContain("getAuthenticatorAssuranceLevel");
    expect(read("proxy.ts")).toContain("session.needsMfa");
    expect(existsSync(join(root, "app/[locale]/(auth)/mfa/page.tsx"))).toBe(true);
  });
  it("privacy export / erase and audit export exist", () => {
    expect(existsSync(join(root, "app/api/v1/contacts/[id]/privacy/route.ts"))).toBe(true);
    expect(read("app/[locale]/(dashboard)/crm/privacy-actions.ts")).toContain('confirm !== "ERASE"');
    expect(existsSync(join(root, "app/api/v1/audit/export/route.ts"))).toBe(true);
  });
});

describe("translations", () => {
  it("every new key exists in he, en and ar", () => {
    const keys = ["nav.health", "cmd.health", "ops.title", "ops.r.dead", "ops.overall.error", "ops.kind.email", "ops.jobHealth.late", "surveys.lowScoreNotification", "surveys.kinds.nps", "views.saveCurrent", "security.mfaTitle", "privacy.eraseBody", "social.drawer.title", "apiDocs.title", "audit.export", "audit.contacts_erased"];
    for (const l of ["he", "en", "ar"]) for (const k of keys) expect(get(dict(l), k), `${l}:${k}`).toBeTruthy();
  });
});
