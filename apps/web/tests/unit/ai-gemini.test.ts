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
    expect(body.generationConfig).toEqual({ temperature: 0.3, maxOutputTokens: 500 });
  });

  it("throws a provider error on HTTP failure (credits are released by the caller)", async () => {
    process.env.GEMINI_API_KEY = "AIza-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(generate("gemini", { model: "gemini-2.5-flash", system: "", messages: [{ role: "user", content: "x" }], temperature: 0, maxTokens: 10 })).rejects.toThrow("gemini_429");
  });
});
