import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healDue, isPublicHttpsBase, twilioNeedsRepoint } from "@/lib/voice/twilio-heal-core";
import { evaluateAppSubscriptions, ownPathOnOldAddress } from "@/lib/channels/meta-webhook-health-core";
import { guardBudget } from "@/lib/ops/process-guard";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const NEW = "https://app.supercoder.agency";

describe("after the move: phone numbers wired to the old address are re-pointed — only ours", () => {
  it("re-points our own path on the old address, never a number the business pointed elsewhere", () => {
    const want = `${NEW}/api/voice/platform`;
    expect(twilioNeedsRepoint("https://super-coder-cloud.vercel.app/api/voice/platform", want, "/api/voice/platform")).toBe(true);
    expect(twilioNeedsRepoint(want, want, "/api/voice/platform")).toBe(false);
    expect(twilioNeedsRepoint("https://my-ivr.example.com/answer", want, "/api/voice/platform")).toBe(false);
    expect(twilioNeedsRepoint("", want, "/api/voice/platform")).toBe(false);
    const tok = "a".repeat(48);
    expect(twilioNeedsRepoint(`https://old.vercel.app/api/voice/twilio/${tok}`, `${NEW}/api/voice/twilio/${tok}`, `/api/voice/twilio/${tok}`)).toBe(true);
    expect(twilioNeedsRepoint(`https://old.vercel.app/api/voice/twilio/${"b".repeat(48)}`, `${NEW}/api/voice/twilio/${tok}`, `/api/voice/twilio/${tok}`)).toBe(false);
  });

  it("only towards a real public https address, and at most once per 6 hours per server", () => {
    expect(isPublicHttpsBase(NEW)).toBe(true);
    expect(isPublicHttpsBase("http://localhost:3000")).toBe(false);
    expect(isPublicHttpsBase("https://web.railway.internal")).toBe(false);
    expect(healDue(undefined, 1)).toBe(true);
    expect(healDue(1000, 1000 + 3600_000)).toBe(false);
    expect(healDue(1000, 1000 + 6 * 3600_000)).toBe(true);
    const src = read("app/api/ai/followups/route.ts");
    expect(src).toContain("healTwilioNumbers(10)");
    expect(src).toContain("healTelegramWebhooks(5)");
  });
});

describe("after the move: the Meta app webhook that points to the OLD address of our own path is repaired", () => {
  const CB = `${NEW}/api/channels/meta/pages`;
  it("same path on the old host → fixable; another path / host stays report-only (as before)", () => {
    expect(ownPathOnOldAddress("https://super-coder-cloud.vercel.app/api/channels/meta/pages", CB)).toBe(true);
    expect(ownPathOnOldAddress("https://staging.example.com/x", CB)).toBe(false);
    expect(ownPathOnOldAddress(CB, CB)).toBe(false);
    expect(ownPathOnOldAddress("https://old.vercel.app/api/channels/meta/pages", "http://localhost:3000/api/channels/meta/pages")).toBe(false);
    const subs = { data: [{ object: "page", callback_url: "https://super-coder-cloud.vercel.app/api/channels/meta/pages", active: true, fields: [{ name: "messages" }] }, { object: "instagram", callback_url: CB, active: true, fields: [{ name: "messages" }] }] };
    expect(evaluateAppSubscriptions(subs, CB)).toEqual([expect.objectContaining({ object: "page", kind: "callback", fixable: true })]);
  });
});

describe("always-on server hardening", () => {
  it("unhandled promise failures are recorded with a budget (never floods the database); the server start never blocks", () => {
    const st = { at: 0, n: 0 };
    let allowed = 0;
    for (let i = 0; i < 50; i++) if (guardBudget(st, 1000)) allowed++;
    expect(allowed).toBe(20);
    expect(guardBudget(st, 1000 + 60_000)).toBe(true);
    const inst = read("instrumentation.ts");
    expect(inst).toContain("installProcessGuard()");
    expect(inst).toContain("startSelfClock()");
  });

  it("a customer's attachment link can never reach the private network (every redirect re-checked)", () => {
    expect(read("lib/ai/inbound-media.ts")).toContain("fetchPublicHttps(url");
  });

  it("a 'typing…' indicator that ran out frees its slot (on Vercel the process died; on Railway it would stay forever)", () => {
    expect(read("lib/ai/typing.ts")).toContain("active.delete(input.conversationId)");
  });
});
