import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODELS, generate, pickProvider, providerConfigured } from "@/lib/ai/providers";

/** Google Gemini provider (free tier): request shape, response parsing, provider selection. */
describe("Gemini provider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("is picked only when its key is set, after Anthropic and OpenAI", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect(pickProvider()).toBeNull();
    process.env.GEMINI_API_KEY = "AIza-test";
    expect(providerConfigured("gemini")).toBe(true);
    expect(pickProvider()).toBe("gemini");
    expect(pickProvider("anthropic")).toBe("gemini"); // preferred but not configured → falls back
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(pickProvider()).toBe("anthropic");
    expect(pickProvider("gemini")).toBe("gemini");
    expect(DEFAULT_MODELS.gemini).toMatch(/^gemini-/);
  });

  it("sends system + history in Gemini format and parses text and token usage", async () => {
    process.env.GEMINI_API_KEY = "AIza-test";
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "שלום " }, { text: "עולם" }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 }, modelVersion: "gemini-2.5-flash" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", {
      model: "gemini-2.5-flash",
      system: "You are helpful",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
      temperature: 0.3,
      maxTokens: 500,
    });
    expect(r).toEqual({ text: "שלום עולם", inputTokens: 120, outputTokens: 30, model: "gemini-2.5-flash", provider: "gemini" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gemini.example/v1beta/models/gemini-2.5-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test");
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe("You are helpful");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig).toEqual({ temperature: 0.3, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } });
  });

  it("trims the key and retries with ?key= when header auth is rejected (AQ. keys)", async () => {
    process.env.GEMINI_API_KEY = " AQ.test-key\n";
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAUTHENTICATED" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", { model: "gemini-2.5-flash", system: "", messages: [{ role: "user", content: "x" }], temperature: 0, maxTokens: 10 });
    expect(r.text).toBe("ok");
    expect(fetchMock.mock.calls[0]![1].headers["x-goog-api-key"]).toBe("AQ.test-key");
    expect(fetchMock.mock.calls[1]![0]).toBe("https://gemini.example/v1beta/models/gemini-2.5-flash:generateContent?key=AQ.test-key");
    expect(fetchMock.mock.calls[1]![1].headers["x-goog-api-key"]).toBeUndefined();
  });

  it("throws a provider error on HTTP failure (credits are released by the caller)", async () => {
    process.env.GEMINI_API_KEY = "AIza-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }), { status: 429 })));
    await expect(generate("gemini", { model: "gemini-2.5-flash", system: "", messages: [{ role: "user", content: "x" }], temperature: 0, maxTokens: 10 })).rejects.toThrow("gemini_429:RESOURCE_EXHAUSTED:quota");
  });

  it("retries on 503 'high demand' and falls back to a lighter model", async () => {
    process.env.GEMINI_API_KEY = "AQ.test-key";
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    delete process.env.AI_GEMINI_FALLBACK_MODELS;
    const busy = () => new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "high demand" } }), { status: 503 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(busy()) // gemini-flash-latest, try 1
      .mockResolvedValueOnce(busy()) // gemini-flash-latest, try 2
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fallback ok" }] } }], modelVersion: "gemini-2.5-flash" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", { model: "gemini-flash-latest", system: "", messages: [{ role: "user", content: "x" }], temperature: 0, maxTokens: 10 });
    expect(r.text).toBe("fallback ok");
    expect(fetchMock.mock.calls.map((c) => String(c[0]).split("/models/")[1])).toEqual([
      "gemini-flash-latest:generateContent",
      "gemini-flash-latest:generateContent",
      "gemini-2.5-flash:generateContent",
    ]);
  });

  it("does not retry non-transient errors (e.g. bad request)", async () => {
    process.env.GEMINI_API_KEY = "AQ.test-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT" } }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generate("gemini", { model: "gemini-x", system: "", messages: [{ role: "user", content: "x" }], temperature: 0, maxTokens: 10 })).rejects.toThrow("gemini_404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores thought parts and gives non-Flash models extra room for thinking", async () => {
    process.env.GEMINI_API_KEY = "AQ.test-key";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "answer" }] } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate("gemini", { model: "gemini-2.5-pro", system: "", messages: [{ role: "user", content: "x" }], temperature: 0, maxTokens: 700 });
    expect(r.text).toBe("answer");
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.generationConfig).toEqual({ temperature: 0, maxOutputTokens: 2748 });
  });
});
