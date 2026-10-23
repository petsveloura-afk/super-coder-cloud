import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODELS, generate, geminiKeys, pickProvider, providerConfigured } from "@/lib/ai/providers";

/** Google Gemini provider (free tier): request shape, parsing, key pool, retries and model fallback. */
const KEY_A = "AQ.test-key-aaaaaaaaaaaaaaaa";
const KEY_B = "AIzaTestKeyBbbbbbbbbbbbbbbbbb";
const ok = (text: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], ...extra }), { status: 200 });
const fail = (status: number, s: string, message = "") => new Response(JSON.stringify({ error: { status: s, message } }), { status });
const req = (model = "gemini-flash-latest", maxTokens = 10) => ({ model, system: "", messages: [{ role: "user" as const, content: "x" }], temperature: 0, maxTokens });
const modelOf = (call: unknown[]) => String(call[0]).split("/models/")[1]!.split(":")[0];
const keyOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)["x-goog-api-key"] ?? new URL(String(call[0])).searchParams.get("key");

describe("Gemini provider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });
  function only(...keys: string[]) {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEYS;
    for (let i = 2; i <= 10; i++) delete process.env[`GEMINI_API_KEY_${i}`];
    if (keys[0]) process.env.GEMINI_API_KEY = keys[0];
    else delete process.env.GEMINI_API_KEY;
    keys.slice(1).forEach((k, i) => (process.env[`GEMINI_API_KEY_${i + 2}`] = k));
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    delete process.env.AI_GEMINI_FALLBACK_MODELS;
  }

  it("collects several keys (single, numbered, comma list), cleans and de-duplicates them", () => {
    expect(geminiKeys({ GEMINI_API_KEY: ` ${KEY_A}\n`, GEMINI_API_KEY_2: KEY_B, GEMINI_API_KEYS: `"${KEY_A}", ${KEY_B}, short` })).toEqual([KEY_A, KEY_B]);
    expect(geminiKeys({})).toEqual([]);
  });

  it("is picked only when a key is set, after Anthropic and OpenAI", () => {
    only();
    expect(pickProvider()).toBeNull();
    only(KEY_A);
    expect(providerConfigured("gemini")).toBe(true);
    expect(pickProvider()).toBe("gemini");
    expect(pickProvider("anthropic")).toBe("gemini"); // preferred but not configured → falls back
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(pickProvider()).toBe("anthropic");
    expect(pickProvider("gemini")).toBe("gemini");
    expect(DEFAULT_MODELS.gemini).toMatch(/^gemini-/);
  });

  it("sends system + history in Gemini format and parses text and token usage", async () => {
    only(KEY_A);
    const fetchMock = vi.fn(async () => ok("שלום ", { candidates: [{ content: { parts: [{ text: "שלום " }, { text: "עולם" }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 }, modelVersion: "gemini-3.8-flash" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", {
      model: "gemini-3.8-flash",
      system: "You are helpful",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
      temperature: 0.3,
      maxTokens: 500,
    });
    expect(r).toEqual({ text: "שלום עולם", inputTokens: 120, outputTokens: 30, model: "gemini-3.8-flash", provider: "gemini" });
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://gemini.example/v1beta/models/gemini-3.8-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY_A);
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe("You are helpful");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    // room for thinking; speed upgrade: 3.8 Flash answers chats at its lowest thinking level ("low")
    expect(body.generationConfig).toEqual({ temperature: 0.3, maxOutputTokens: 2548, thinkingConfig: { thinkingLevel: "low" } });
  });

  it("turns thinking off for 2.5 Flash so the answer is never empty", async () => {
    only(KEY_A);
    const fetchMock = vi.fn(async () => ok("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await generate("gemini", req("gemini-2.5-flash", 500));
    const body = JSON.parse(String((fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1].body));
    expect(body.generationConfig).toEqual({ temperature: 0, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } });
  });

  it("retries with ?key= when header auth is rejected (AQ. keys)", async () => {
    only(KEY_A);
    const fetchMock = vi.fn().mockResolvedValueOnce(fail(401, "UNAUTHENTICATED")).mockResolvedValueOnce(ok("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", req());
    expect(r.text).toBe("ok");
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`https://gemini.example/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(KEY_A)}`);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).not.toHaveProperty("x-goog-api-key");
  });

  it("on 503 'high demand' moves to the next key before changing model", async () => {
    only(KEY_A, KEY_B);
    vi.spyOn(Math, "random").mockReturnValue(0); // start at key #1
    const fetchMock = vi.fn().mockResolvedValueOnce(fail(503, "UNAVAILABLE", "high demand")).mockResolvedValueOnce(ok("second key ok"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", req());
    expect(r.text).toBe("second key ok");
    expect(fetchMock.mock.calls.map(keyOf)).toEqual([KEY_A, KEY_B]);
    expect(fetchMock.mock.calls.map(modelOf)).toEqual(["gemini-flash-latest", "gemini-flash-latest"]);
  });

  it("falls back to the next model when one is busy or retired (404 'no longer available')", async () => {
    only(KEY_A);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fail(503, "UNAVAILABLE", "high demand")) // gemini-flash-latest
      .mockResolvedValueOnce(fail(404, "NOT_FOUND", "no longer available to new users")) // gemini-3.8-flash
      .mockResolvedValueOnce(ok("lite ok")); // gemini-flash-lite-latest
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", req());
    expect(r.text).toBe("lite ok");
    expect(fetchMock.mock.calls.map(modelOf)).toEqual(["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });

  it("gives up after a bounded number of calls and reports the provider error", async () => {
    only(KEY_A, KEY_B);
    const fetchMock = vi.fn(async () => fail(429, "RESOURCE_EXHAUSTED", "quota"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generate("gemini", req())).rejects.toThrow("gemini_429:RESOURCE_EXHAUSTED:quota");
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("does not retry non-transient errors (e.g. invalid argument)", async () => {
    only(KEY_A);
    const fetchMock = vi.fn(async () => fail(422, "INVALID_ARGUMENT"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generate("gemini", req("gemini-x"))).rejects.toThrow("gemini_422");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores thought parts", async () => {
    only(KEY_A);
    vi.stubGlobal("fetch", vi.fn(async () => ok("", { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "answer" }] } }] })));
    const r = await generate("gemini", req("gemini-3.8-flash", 700));
    expect(r.text).toBe("answer");
  });
});
