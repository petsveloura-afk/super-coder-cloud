import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notCustomerKind } from "@/lib/ai/spam-core";
import { isProbePath } from "@/lib/security/probe-core";
import { visibleAfterCleanup } from "@/components/ui/cleanup";
import { buildCandidates, callTimeoutMs, laneOrder } from "@/lib/ai/router-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("not-a-customer filter (newsletters / spam get no answer and no alert)", () => {
  it("a product-update newsletter e-mail is bulk", () => {
    const neon = "Neon Changelog\n* HIPAA support\n* Gemini 4 Argon is now available\nRead the full Changelog ( https://neon.com/docs/changelog )\nUnsubscribe · Manage email preferences\n© 2026 Neon, Inc. All rights reserved.";
    expect(notCustomerKind({ text: neon, channel: "email" })).toBe("bulk");
    expect(notCustomerKind({ text: "anything", channel: "whatsapp", automated: true })).toBe("bulk");
  });
  it("spam pitches are spam; real customers never are", () => {
    expect(notCustomerKind({ text: "We offer SEO services and backlinks to rank your site on Google. Click here, limited time offer!", channel: "email" })).toBe("spam");
    expect(notCustomerKind({ text: "קידום אתרים מקצועי + קישורים נכנסים במחיר מטורף, השקעה מובטחת", channel: "whatsapp" })).toBe("spam");
    for (const t of ["כמה עולה תספורת?", "היי, אפשר לקבוע תור למחר?", "Hi, what is the price for a website?", "רציתי לשאול על ההזמנה שלי", ""]) expect(notCustomerKind({ text: t, channel: "whatsapp" }), t).toBeNull();
    // one weak sign is not enough
    expect(notCustomerKind({ text: "תודה רבה, אשמח לקבל את המחירון. אגב ראיתי את הניוזלטר שלכם", channel: "telegram" })).toBeNull();
  });
  it("wiring: e-mail intake, the agent, the alerts and the catch-up all respect it", () => {
    expect(read("lib/channels/email.ts")).toContain("notCustomerKind({ text: body, subject: parsed.subject ?? null, channel: \"email\" }) !== null");
    const ap = read("lib/ai/autopilot.ts");
    expect(ap).toContain("reason: `filtered:${nk}`");
    expect(ap).toContain('if (res.reason?.startsWith("filtered:")) return;');
    expect(read("lib/notify/forward.ts")).toContain('(await import("@/lib/ai/spam-core")).notCustomerKind(');
  });
});

describe("security layer: scanner probes get a 404 at the edge", () => {
  it("probes match, real pages never do", () => {
    for (const p of ["/.env", "/.git/config", "/wp-login.php", "/wp-admin/", "/he/phpmyadmin", "/index.php", "/backup.zip".replace(".zip", ".sql"), "/..%2f..%2fetc/passwd", "/%E0%A4%A"]) expect(isProbePath(p), p).toBe(true);
    for (const p of ["/", "/he/overview", "/he/ai-team", "/he/s/my-salon", "/he/f/contact-form", "/he/book/haircut", "/privacy", "/he/settings", "/.well-known/assetlinks"]) expect(isProbePath(p), p).toBe(false);
    expect(read("proxy.ts")).toContain("if (isProbePath(pathname)) return new NextResponse(null, { status: 404");
  });
});

describe("keep lists clean (per user)", () => {
  it("hidden items and everything up to 'clear all' disappear; new items still show", () => {
    const st = { hidden: ["a"], before: 1000 };
    expect(visibleAfterCleanup({ id: "a", at: 5000 }, st)).toBe(false);
    expect(visibleAfterCleanup({ id: "b", at: 900 }, st)).toBe(false);
    expect(visibleAfterCleanup({ id: "c", at: 2000 }, st)).toBe(true);
    expect(visibleAfterCleanup({ id: "c", at: 2000 }, { hidden: [], before: 0 })).toBe(true);
  });
  it("wiring: activity + finished tasks + notifications have the clean-up bar; notifications delete only your own", () => {
    const p = read("components/ai-team/panels.tsx");
    expect(p).toContain("useCleanup(`scc_clean_activity_${data.orgId}`)");
    expect(p).toContain("useCleanup(`scc_clean_done_${data.orgId}`)");
    expect(read("app/[locale]/(dashboard)/settings/page.tsx")).toContain("<NotificationsList rows={notifications}");
    const a = read("app/[locale]/(dashboard)/settings/actions.ts");
    expect(a).toContain('.delete().eq("organization_id", ctx.org.id).eq("user_id", ctx.userId)');
    for (const l of ["he", "en", "ar"]) {
      const c = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).cleanup;
      for (const k of ["select", "selectAll", "hideSelected", "deleteSelected", "clearAll", "clearAllConfirm", "deleteAll", "deleteAllConfirm", "restore", "cleanTitle", "cleanBody", "deleted", "markAllRead"]) expect(typeof c[k], `${l}.${k}`).toBe("string");
    }
  });
});

describe("AI stability + sync + speed", () => {
  const env = { GROQ_API_KEY: "fake-groq-key-aaaaaaaaaaaaaaaa", GEMINI_API_KEY: "fake-gemini-key-aaaaaaaaaaaaaa", ZHIPU_API_KEY: "fake-zhipu-key-aaaaaaaaaaaaaaa", COHERE_API_KEY: "fake-cohere-key-aaaaaaaaaaaaaa" };
  it("the team's chosen engine stays first in the background lane; without a pin the order is unchanged", () => {
    const cands = buildCandidates({ preferred: "groq", env, random: () => 0 });
    const plain = laneOrder(cands, "background");
    expect(laneOrder(cands, "background", null)).toEqual(plain);
    const pinned = laneOrder(cands, "background", "groq");
    expect(pinned[0]!.provider).toBe("groq");
    expect(pinned).toHaveLength(cands.length);
    expect(laneOrder(cands, "interactive", "gemini")).toEqual(cands);
  });
  it("one slow engine cannot eat a background request's whole budget; z.ai keys use api.z.ai", () => {
    expect(callTimeoutMs("background", 30_000)).toBe(18_000);
    expect(callTimeoutMs("interactive", 30_000)).toBe(25_000);
    expect(callTimeoutMs("background", 9_000)).toBe(9_000);
    expect(read("lib/ai/router-core.ts")).toContain('zhipu: ["AI_ZHIPU_BASE_URL", "https://api.z.ai/api/paas/v4"]');
    expect(read("lib/ai/run-system.ts")).toContain("pinPreferred: Boolean(input.routeProvider)");
  });
  it("header 'working' counts what the board shows; menu taps answer at once; visited pages reopen from cache", () => {
    expect(read("components/ai-team/team-screen.tsx")).toContain('data.tasks.filter((x) => x.status === "in_progress" && !(x.plan as { goal?: boolean } | null)?.goal');
    expect(read("components/layout/app-shell.tsx")).toContain("<LinkPending />");
    expect(read("next.config.ts")).toContain("staleTimes: { dynamic: 30, static: 180 }");
  });
});
