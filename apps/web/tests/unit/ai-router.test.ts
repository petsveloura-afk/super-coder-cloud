import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCandidates, classifyError, isResting, keysFor, restKey, soonestReady, untilDailyReset } from "@/lib/ai/router-core";

/** Wave 9 — AI router: candidates, error classification, rests, failover without retry storms. */
const G1 = "AIzaGeminiKeyNumberOne_aaaaaaaa1";
const G2 = "AIzaGeminiKeyNumberTwo_bbbbbbbb2";
const GROQ = "gsk_groqKeyForTests_cccccccccccc3";

describe("router core", () => {
  it("collects keys like KEY, KEY_2 … and KEYS", () => {
    expect(keysFor({ GROQ_API_KEY: GROQ, GROQ_API_KEY_2: ` ${G1} `, GROQ_API_KEYS: `${GROQ},short` }, "GROQ_API_KEY")).toEqual([GROQ, G1]);
  });

  it("orders candidates: preferred provider (with its own model first), then the default order; skips unconfigured providers", () => {
    const env = { GEMINI_API_KEY: G1, GEMINI_API_KEY_2: G2, GROQ_API_KEY: GROQ };
    const c = buildCandidates({ preferred: "gemini", model: "gemini-flash-latest", env, random: () => 0 });
    expect(c.slice(0, 4).map((x) => `${x.provider}/${x.model}/${x.keyId}`)).toEqual([
      `gemini/gemini-flash-latest/gemini:…${G1.slice(-6)}`,
      `gemini/gemini-flash-latest/gemini:…${G2.slice(-6)}`,
      `gemini/gemini-3.8-flash/gemini:…${G1.slice(-6)}`,
      `gemini/gemini-3.8-flash/gemini:…${G2.slice(-6)}`,
    ]);
    const groq = c.filter((x) => x.provider === "groq");
    expect(groq.map((x) => x.model)).toEqual(["openai/gpt-oss-120b", "llama-3.3-70b-versatile"]);
    expect(groq[0]!.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(c.some((x) => x.provider === "cerebras" || x.provider === "openai")).toBe(false);
    // no preference → fastest free first
    expect(buildCandidates({ env, random: () => 0 })[0]!.provider).toBe("groq");
    // custom order + retired models never asked first
    expect(buildCandidates({ preferred: "gemini", model: "gemini-1.5-flash", env: { ...env, AI_PROVIDER_ORDER: "gemini,groq" }, random: () => 0 })[0]!.model).toBe("gemini-3.8-flash");
  });

  it("never exposes a key in its id", () => {
    const [c] = buildCandidates({ env: { GROQ_API_KEY: GROQ }, random: () => 0 });
    expect(c!.keyId).toBe(`groq:…${GROQ.slice(-6)}`);
    expect(c!.keyId).not.toContain(GROQ.slice(0, 10));
  });

  it("classifies failures and rests each for the right time and scope", () => {
    const now = new Date("2026-10-16T17:00:00Z");
    const rate = classifyError("gemini_429:RESOURCE_EXHAUSTED:Quota exceeded for metric generate_content_free_tier_requests, limit: 10. Please retry in 41.3s.", now);
    expect(rate).toMatchObject({ kind: "rate", scope: "key+model" });
    expect(rate.restMs).toBe(41_300);
    const daily = classifyError("gemini_429:RESOURCE_EXHAUSTED:Quota exceeded for quota id GenerateRequestsPerDayPerProjectPerModel-FreeTier", now);
    expect(daily.kind).toBe("daily");
    expect(daily.restMs).toBe(3 * 3600_000);
    expect(classifyError("groq_429:Rate limit reached|retry=7").restMs).toBe(20_000);
    // wave 11: "limit: 0" = no free quota for this model in this project (not a temporary limit)
    const none = classifyError("gemini_429:RESOURCE_EXHAUSTED:You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.8-flash");
    expect(none).toMatchObject({ kind: "noquota", scope: "key+model", restMs: 6 * 3600_000 });
    expect(classifyError("gemini_404:NOT_FOUND:models/gemini-flash-latest is not found")).toMatchObject({ kind: "model", scope: "model" });
    expect(classifyError("gemini_400:INVALID_ARGUMENT:API key not valid. Please pass a valid API key.")).toMatchObject({ kind: "auth", scope: "key" });
    expect(classifyError("cerebras_401:Wrong API Key")).toMatchObject({ kind: "auth" });
    expect(classifyError("openrouter_503:Provider returned error")).toMatchObject({ kind: "server", restMs: 15_000 });
    expect(classifyError("TimeoutError: The operation was aborted due to timeout")).toMatchObject({ kind: "server" });
  });

  it("daily reset is the next 08:00 UTC", () => {
    expect(untilDailyReset(new Date("2026-10-16T07:00:00Z"))).toBe(3600_000);
    expect(untilDailyReset(new Date("2026-10-16T09:00:00Z"))).toBe(23 * 3600_000);
  });

  it("knows which candidates rest and when the first one is ready again", () => {
    const c = buildCandidates({ env: { GEMINI_API_KEY: G1, GEMINI_API_KEY_2: G2 }, random: () => 0 });
    const rests = new Map<string, number>();
    const now = 1_000_000;
    rests.set(restKey(c[0]!, "key+model"), now + 30_000);
    rests.set(restKey(c[1]!, "key"), now + 10_000);
    expect(isResting(c[0]!, rests, now)).toBe(true);
    expect(isResting(c[1]!, rests, now)).toBe(true);
    expect(isResting(c[2]!, rests, now)).toBe(false);
    expect(soonestReady(c.slice(0, 2), rests, now)).toBe(10_000);
    rests.set(restKey(c[2]!, "model"), now + 5_000);
    expect(isResting(c[3]!, rests, now)).toBe(true); // same model, other key
  });
});

describe("router (generateRouted)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) if (/_API_KEY|AI_PROVIDER_ORDER|SUPABASE_SERVICE_ROLE_KEY/.test(k)) delete process.env[k];
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    process.env.AI_GROQ_BASE_URL = "https://groq.example/openai/v1";
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });
  const geminiBusy = () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded. Please retry in 30s." } }), { status: 429 });
  const groqOk = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: "openai/gpt-oss-120b" }), { status: 200 });

  it("fails over from a rate-limited Gemini to Groq in one pass, then skips the resting Gemini key next time", async () => {
    process.env.GEMINI_API_KEY = G1;
    process.env.GROQ_API_KEY = GROQ;
    process.env.AI_GEMINI_MODELS = "gemini-3.8-flash";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (void init, String(url).includes("gemini.example") ? geminiBusy() : groqOk("שלום! 150 ₪")));
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    const r = await generateRouted({ preferred: "gemini", model: "gemini-3.8-flash", system: "s", messages: [{ role: "user", content: "כמה עולה?" }] });
    expect(r).toMatchObject({ text: "שלום! 150 ₪", provider: "groq" });
    expect(r.attempts.map((a) => `${a.provider}:${a.ok}`)).toEqual(["gemini:false", "groq:true"]);
    // Groq request shape: OpenAI-compatible, Bearer key, low reasoning for gpt-oss
    const groqCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("groq.example"))!;
    expect(String(groqCall[0])).toBe("https://groq.example/openai/v1/chat/completions");
    const init = groqCall[1] as unknown as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GROQ}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low", messages: [{ role: "system", content: "s" }, { role: "user", content: "כמה עולה?" }] });
    // second call: the Gemini key rests → straight to Groq, no wasted request
    fetchMock.mockClear();
    const r2 = await generateRouted({ preferred: "gemini", system: "s", messages: [{ role: "user", content: "x" }] });
    expect(r2.provider).toBe("groq");
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes("groq.example"))).toBe(true);
  });

  it("reports busy with the time until a key is ready when everything is limited — without hammering", async () => {
    process.env.GEMINI_API_KEY = G1;
    process.env.AI_GEMINI_MODELS = "gemini-3.8-flash";
    const fetchMock = vi.fn(async () => geminiBusy());
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted, RouterError } = await import("@/lib/ai/router");
    const err = await generateRouted({ system: "s", messages: [{ role: "user", content: "x" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(RouterError);
    expect(err.busy).toBe(true);
    expect(err.retryInMs).toBeGreaterThan(25_000);
    expect(err.retryInMs).toBeLessThanOrEqual(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // immediately again: nothing is tried at all
    await generateRouted({ system: "s", messages: [{ role: "user", content: "x" }] }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a retired model is skipped for every key and the next model answers", async () => {
    process.env.GEMINI_API_KEY = G1;
    process.env.GEMINI_API_KEY_2 = G2;
    process.env.AI_GEMINI_MODELS = "gemini-3.8-flash";
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("gemini-flash-latest")
        ? new Response(JSON.stringify({ error: { status: "NOT_FOUND", message: "models/gemini-flash-latest is not found" } }), { status: 404 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "היי" }] } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    const r = await generateRouted({ preferred: "gemini", model: "gemini-flash-latest", system: "s", messages: [{ role: "user", content: "x" }] });
    expect(r.text).toBe("היי");
    expect(r.attempts.map((a) => a.model)).toEqual(["gemini-flash-latest", "gemini-3.8-flash"]);
  });

  it("not configured → a clear error, no calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    await expect(generateRouted({ system: "s", messages: [] })).rejects.toMatchObject({ message: "ai_not_configured", busy: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("admin AI health probe (wave 11)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("tries the next model when a key has no free quota on the first one, and reports which model works", async () => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) if (/_API_KEY|AI_PROVIDER_ORDER|SUPABASE_SERVICE_ROLE_KEY|AI_.*_MODELS/.test(k)) delete process.env[k];
    process.env.GEMINI_API_KEY = G1;
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    process.env.AI_GEMINI_MODELS = "gemini-3.8-flash,gemini-3.5-flash-lite";
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("gemini-3.8-flash")
        ? new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota. For more information on this error, head to: https://ai.google.dev/x. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.8-flash" } }), { status: 429 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { probeAll } = await import("@/lib/ai/router");
    const [row] = await probeAll();
    expect(row).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash-lite", ok: true, tried: ["gemini-3.8-flash", "gemini-3.5-flash-lite"] });
  });

  it("reports a readable reason (no doc links) when every model fails", async () => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) if (/_API_KEY|AI_PROVIDER_ORDER|SUPABASE_SERVICE_ROLE_KEY|AI_.*_MODELS/.test(k)) delete process.env[k];
    process.env.GEMINI_API_KEY = G1;
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    process.env.AI_GEMINI_MODELS = "gemini-3.8-flash";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota. For more information on this error, head to: https://ai.google.dev/x. limit: 0" } }), { status: 429 })));
    const { probeAll } = await import("@/lib/ai/router");
    const [row] = await probeAll();
    expect(row!.ok).toBe(false);
    expect(row!.kind).toBe("noquota");
    expect(row!.reason).not.toContain("https://");
  });
});

describe("router: one limited provider never blocks the next (wave 11)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("3 limited Gemini keys → after 2 failed Gemini calls it moves on and Groq answers", async () => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) if (/_API_KEY|AI_PROVIDER_ORDER|SUPABASE_SERVICE_ROLE_KEY|AI_.*_MODELS|AI_ROUTER/.test(k)) delete process.env[k];
    process.env.GEMINI_API_KEY = G1;
    process.env.GEMINI_API_KEY_2 = G2;
    process.env.GEMINI_API_KEY_3 = "AIzaGeminiKeyNumberThree_cccccc3";
    process.env.GROQ_API_KEY = GROQ;
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    process.env.AI_GROQ_BASE_URL = "https://groq.example/openai/v1";
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("gemini.example")
        ? new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded. Please retry in 20s." } }), { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "שלום מ-Groq" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    const r = await generateRouted({ preferred: "gemini", model: "gemini-flash-latest", system: "s", messages: [{ role: "user", content: "x" }] });
    expect(r.provider).toBe("groq");
    expect(r.attempts.map((a) => a.provider)).toEqual(["gemini", "gemini", "groq"]);
  });
});
