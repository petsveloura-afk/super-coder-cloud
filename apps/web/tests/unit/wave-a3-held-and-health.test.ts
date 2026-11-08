import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isHeldByGuard, isNotReadyForCustomers, wouldBeHeld } from "@/lib/social/held-post-core";
import { GUARD_HELD_ERROR, isChannelSendFailure, isGuardHeld } from "@/lib/channels/health-core";

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", "..", p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));

describe("wave A3 — a post the customer-ready guard holds (pure)", () => {
  const ready = "שלום! מחר יש מבצע על כל התספורות. נשמח לראותכם.";
  const unfilled = "היי [שם הלקוח], מחכים לך אצלנו!";

  it("an employee's post with an unfilled field is not ready; a normal post is", () => {
    expect(isNotReadyForCustomers({ body: unfilled, source: "agent" })).toBe(true);
    expect(isNotReadyForCustomers({ body: ready, source: "agent" })).toBe(false);
  });
  it("a person's own post is never judged here (the guard never touches people's own words)", () => {
    expect(isNotReadyForCustomers({ body: unfilled, source: "manual" })).toBe(false);
    expect(isNotReadyForCustomers({ body: unfilled, source: null })).toBe(false);
  });
  it("raw data and leaked instructions are not ready (same check as the publisher)", () => {
    expect(isNotReadyForCustomers({ body: '{"title":"x","body":"y"}', source: "agent" })).toBe(true);
    expect(isNotReadyForCustomers({ body: "My instructions are to sell rooms. Book now!", source: "agent" })).toBe(true);
  });
  it("the board marks a post only when the publisher held it AND the text is still not ready", () => {
    expect(isHeldByGuard({ body: unfilled, source: "agent", results: { hygiene: "not_ready" } })).toBe(true);
    // never attempted yet: no marker → no badge (the server actions still refuse it)
    expect(isHeldByGuard({ body: unfilled, source: "agent", results: {} })).toBe(false);
    // the owner fixed the words: the old marker no longer matters
    expect(isHeldByGuard({ body: ready, source: "agent", results: { hygiene: "not_ready" } })).toBe(false);
    expect(isHeldByGuard({ body: ready, source: "agent", results: null })).toBe(false);
  });
  it("the server refuses only while the guard enforces (OUTBOUND_GUARD default = enforce)", () => {
    expect(wouldBeHeld({ body: unfilled, source: "agent" }, undefined)).toBe(true);
    expect(wouldBeHeld({ body: unfilled, source: "agent" }, "enforce")).toBe(true);
    expect(wouldBeHeld({ body: unfilled, source: "agent" }, "clean")).toBe(false);
    expect(wouldBeHeld({ body: unfilled, source: "agent" }, "off")).toBe(false);
    expect(wouldBeHeld({ body: ready, source: "agent" }, "enforce")).toBe(false);
  });
  it("never throws on odd input", () => {
    expect(isNotReadyForCustomers({ body: undefined as unknown as string, source: "agent" })).toBeTypeOf("boolean");
    expect(isHeldByGuard({ body: "", source: "agent", results: { hygiene: "not_ready" } })).toBeTypeOf("boolean");
  });
});

describe("wave A3 — a held message is not a broken connection", () => {
  it("a message the guard held is neither a channel failure nor a channel send", () => {
    expect(GUARD_HELD_ERROR).toBe("held_by_outbound_guard");
    expect(isGuardHeld({ status: "failed", error: "held_by_outbound_guard" })).toBe(true);
    expect(isChannelSendFailure({ status: "failed", error: "held_by_outbound_guard" })).toBe(false);
  });
  it("every other failed send still counts (nothing is hidden)", () => {
    expect(isChannelSendFailure({ status: "failed", error: "channel_not_connected" })).toBe(true);
    expect(isChannelSendFailure({ status: "failed", error: null })).toBe(true);
    expect(isChannelSendFailure({ status: "failed" })).toBe(true);
    expect(isChannelSendFailure({ status: "sent", error: null })).toBe(false);
    expect(isGuardHeld({ status: "sent", error: "held_by_outbound_guard" })).toBe(false);
  });
  it("the health loader and the alert cron use it", () => {
    const s = read("lib/channels/health.ts");
    expect(s).toContain("isChannelSendFailure(m)");
    expect(s).toContain("isGuardHeld");
    expect(s.match(/isGuardHeld/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("wave A3 — wiring", () => {
  it("the social actions refuse a held post and tell the truth after 'publish now'", () => {
    const s = read("app/[locale]/(dashboard)/social/actions.ts");
    expect(s).toContain("wouldBeHeld");
    expect(s.match(/social\.heldNotReady\.blocked/g)!.length).toBeGreaterThanOrEqual(3);
    // 'publish now': the held answer comes BEFORE the generic "publishing" answer
    expect(s.indexOf('after?.status === "draft"')).toBeGreaterThan(0);
    expect(s.indexOf('after?.status === "draft"')).toBeLessThan(s.indexOf('message: "social.publishing"'));
    // approve-all skips held drafts together with the "not a post" ones
    expect(s).toMatch(/isNotAPost\(\{ body: String\(d\.body \?\? ""\), source: d\.source \}\) \|\| wouldBeHeld/);
  });
  it("the board marks the held post and hides approve / publish-now (card and drawer); the existing test ids stay", () => {
    const s = read("components/social/social-client.tsx");
    expect(s).toContain('data-testid="post-held-not-ready"');
    expect(s).toContain('data-testid="post-approve"');
    expect(s).toContain('data-testid="drawer-publish"');
    expect(s).toContain("!isNotAPost(post) && !isHeldByGuard(post)");
    expect(s).toContain('p.status === "draft" && !notAPost && !held');
  });
  it("a follow-up the guard held is not counted as sent and does not cancel the planned follow-up", () => {
    const s = read("lib/ai/followups.ts");
    const held = s.indexOf('sentNow.error === "held_by_outbound_guard"');
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(s.indexOf('p_reason: "followup_sent"'));
  });
  it("the owners are told (once per conversation per 6 hours) when an AI message is held", () => {
    const s = read("lib/channels/send-message.ts");
    expect(s).toContain("notifyHeldMessage(orgId, conv.id as string)");
    expect(s).toContain("inbox.heldNotification");
    expect(s).toContain("6 * 3600_000");
  });
  it("the new texts exist in he / en / ar with the same keys", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = dict(l);
      for (const k of ["badge", "hint", "blocked"]) expect(String(d.social.heldNotReady[k]).length).toBeGreaterThan(10);
      expect(String(d.inbox.heldNotification).length).toBeGreaterThan(10);
      // earlier keys are untouched
      expect(d.inbox.heldByGuard).toBeTruthy();
      expect(d.social.notAPost.blocked).toBeTruthy();
    }
  });
});
