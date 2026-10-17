import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCandidates, classifyError, restKey } from "@/lib/ai/router-core";
import { capRest, probeOrder, restCaps, stuckEscalationMessage, stuckPolicy, withDeadline } from "@/lib/ai/resilience-core";

const G1 = "AIzaGeminiKeyNumberOne_aaaaaaaa1";
const GROQ = "gsk_groqKeyForTests_cccccccccccc3";

describe("wave 15 · rest caps", () => {
  it("no rest ever lasts hours any more", () => {
    const now = new Date("2026-10-17T10:00:00Z");
    const noquota = classifyError("gemini_429:RESOURCE_EXHAUSTED:limit: 0, model: x", now);
    expect(noquota.restMs).toBe(6 * 3600_000); // classification itself is unchanged
    expect(capRest(noquota)).toBe(20 * 60_000);
    expect(capRest(classifyError("gemini_404:NOT_FOUND:models/x is not found"))).toBe(60 * 60_000);
    expect(capRest(classifyError("cerebras_401:Wrong API Key"))).toBe(10 * 60_000);
    expect(capRest(classifyError("groq_429:Rate limit reached|retry=7"))).toBe(20_000);
    expect(capRest(classifyError("something odd"))).toBe(0);
  });
  it("AI_MAX_REST_MINUTES lowers every cap", () => {
    expect(restCaps({ AI_MAX_REST_MINUTES: "3" }).model).toBe(3 * 60_000);
    expect(restCaps({ AI_MAX_REST_MINUTES: "3" }).server).toBe(30_000);
  });
});

describe("wave 15 · last-resort probing", () => {
  it("probes the longest-resting candidates that expire soonest, one per provider, never the short rests", () => {
    const c = buildCandidates({ env: { GEMINI_API_KEY: G1, GROQ_API_KEY: GROQ }, random: () => 0 });
    const now = 1_000_000;
    const rests = new Map<string, number>();
    const groq = c.find((x) => x.provider === "groq")!;
    const gem = c.filter((x) => x.provider === "gemini");
    rests.set(restKey(groq, "key+model"), now + 10 * 60_000);
    rests.set(restKey(gem[0]!, "key+model"), now + 5 * 60_000);
    rests.set(restKey(gem[1]!, "key+model"), now + 6 * 60_000);
    rests.set(restKey(c.find((x) => x.provider === "groq" && x.model !== groq.model)!, "key+model"), now + 20_000); // short → waited out
    const probes = probeOrder(c, rests, now, 3, 1);
    expect(probes.map((x) => `${x.provider}/${x.model}`)).toEqual([`gemini/${gem[0]!.model}`, `groq/${groq.model}`]);
    expect(probeOrder(c, new Map(), now)).toEqual([]);
  });
});

describe("wave 15 · stuck policy", () => {
  it("waits, retries, then escalates — nobody is left in silence", () => {
    expect(stuckPolicy({ waitingMs: 60_000, attempts: 0 })).toBe("wait");
    expect(stuckPolicy({ waitingMs: 3 * 60_000, attempts: 1 })).toBe("retry");
    expect(stuckPolicy({ waitingMs: 9 * 60_000, attempts: 3 })).toBe("escalate");
    expect(stuckPolicy({ waitingMs: 4 * 60_000, attempts: 3 }, { AI_STUCK_ESCALATE_MINUTES: "3" })).toBe("escalate");
  });
  it("escalation message exists in all three languages", () => {
    for (const l of ["he", "ar", "en"]) expect(stuckEscalationMessage(l).length).toBeGreaterThan(20);
  });
  it("withDeadline rejects a hung call", async () => {
    await expect(withDeadline(new Promise(() => undefined), 30, "x")).rejects.toThrow(/timeout/);
    await expect(withDeadline(Promise.resolve(5), 100)).resolves.toBe(5);
  });
});

describe("wave 15 · router heals itself (the 'stuck until reset' bug)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) if (/_API_KEY|AI_PROVIDER_ORDER|SUPABASE_SERVICE_ROLE_KEY/.test(k)) delete process.env[k];
    process.env.AI_GROQ_BASE_URL = "https://groq.example/openai/v1";
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });
  const ok = (t: string) => new Response(JSON.stringify({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: "m" }), { status: 200 });

  it("a key that was wrongly rested for hours answers again on the next request", async () => {
    process.env.GROQ_API_KEY = GROQ;
    process.env.AI_GROQ_MODELS = "openai/gpt-oss-120b";
    let n = 0;
    // first call: a bogus 401 (rests the key); later calls work again
    const fetchMock = vi.fn(async () => (n++ === 0 ? new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }) : ok("חזרתי")));
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    await expect(generateRouted({ system: "s", messages: [{ role: "user", content: "x" }] })).rejects.toBeTruthy();
    // before: this threw ai_all_resting for an hour. now: the last-resort probe asks again and succeeds
    const r = await generateRouted({ system: "s", messages: [{ role: "user", content: "x" }] });
    expect(r.text).toBe("חזרתי");
    // …and the rest is gone: the next call goes straight through with no probe needed
    const r2 = await generateRouted({ system: "s", messages: [{ role: "user", content: "y" }] });
    expect(r2.text).toBe("חזרתי");
  });
});
