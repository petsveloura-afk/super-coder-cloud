import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJson, normalizeAiSite, siteJsonInstructions, siteSlug } from "@/lib/ai/site-json";
import { parseAgentReply, siteToolInstructions } from "@/lib/ai/agent-markers";
import { generateImage } from "@/lib/ai/images";

describe("agent tool marker", () => {
  it("strips the control line and reports the requested site kind", () => {
    expect(parseAgentReply("מעולה, בונה!\n[[BUILD_SITE:landing]]")).toEqual({ text: "מעולה, בונה!", buildSite: "landing" });
    expect(parseAgentReply("Sure [[ build_site : FULL ]]")).toEqual({ text: "Sure", buildSite: "full" });
    expect(parseAgentReply("[[BUILD_SITE]]").buildSite).toBe("landing");
    expect(parseAgentReply("just text")).toEqual({ text: "just text", buildSite: null });
  });

  it("only advertises the tool when the user may build, and full sites only on paid plans", () => {
    expect(siteToolInstructions({ canBuild: false, full: true, images: true })).toBe("");
    const free = siteToolInstructions({ canBuild: true, full: false, images: false });
    expect(free).toContain("[[BUILD_SITE:landing]]");
    expect(free).not.toContain("[[BUILD_SITE:full]]");
    expect(free).toMatch(/paid plan/);
    expect(siteToolInstructions({ canBuild: true, full: true, images: true })).toContain("[[BUILD_SITE:full]]");
  });
});

describe("AI site JSON → valid site", () => {
  const raw = {
    name: "פט-ליין",
    accent: "#E8590C",
    mode: "light",
    seo: { title: "פט-ליין", description: "מספרה לחיות" },
    image_prompt: "dog",
    blocks: [
      { type: "features", data: { title: "למה אנחנו", items: [{ title: "א", text: "ב" }, { title: "", text: "" }] } },
      { type: "contact", data: { title: "צרו קשר", phone: "03-1234567" } },
      { type: "hero", data: { title: "כותרת", subtitle: "תת", cta_label: "דברו", cta_href: "javascript:alert(1)" } },
      { type: "cta", data: { title: "מוכנים?", label: "כן", href: "https://example.com" } },
      { type: "form", data: { title: "טופס", form_slug: "made-up" } },
      { type: "evil", data: { html: "<script>" } },
    ],
  };

  it("extracts JSON from fences / chatter", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blah {"a":2} blah')).toEqual({ a: 2 });
    expect(extractJson("no json")).toBeNull();
  });

  it("coerces, orders (hero first, contact last), drops unknown/unsafe parts", () => {
    const s = normalizeAiSite(raw, "landing", { formSlug: null, bookingSlug: null }, "fallback")!;
    expect(s.name).toBe("פט-ליין");
    expect(s.theme).toEqual({ accent: "#E8590C", mode: "light" });
    expect(s.blocks.map((b) => b.type)).toEqual(["hero", "features", "cta", "contact"]);
    const hero = s.blocks[0]!;
    expect(hero.type === "hero" && hero.data.cta_href).toBe("#contact"); // javascript: removed
    const feats = s.blocks[1]!;
    expect(feats.type === "features" && feats.data.items).toHaveLength(1); // empty item dropped
    expect(s.imagePrompt).toBe("dog");
  });

  it("only keeps a form block that points at a real form, and caps blocks per mode", () => {
    const withForm = normalizeAiSite(raw, "landing", { formSlug: "contact-us", bookingSlug: null }, "x")!;
    const form = withForm.blocks.find((b) => b.type === "form")!;
    expect(form.type === "form" && form.data.form_slug).toBe("contact-us");
    const many = { ...raw, blocks: [raw.blocks[2], ...Array.from({ length: 30 }, () => raw.blocks[3])] };
    expect(normalizeAiSite(many, "landing", {}, "x")!.blocks.length).toBe(7);
    expect(normalizeAiSite(many, "full", {}, "x")!.blocks.length).toBe(16);
  });

  it("rejects answers without a hero or with bad shapes", () => {
    expect(normalizeAiSite({ blocks: [{ type: "faq", data: { items: [] } }] }, "landing", {}, "x")).toBeNull();
    expect(normalizeAiSite("nope", "landing", {}, "x")).toBeNull();
    expect(normalizeAiSite({ ...raw, accent: "red" }, "landing", {}, "x")!.theme.accent).toBe("#3366E6");
  });

  it("makes ASCII, schema-valid slugs even from Hebrew names", () => {
    expect(siteSlug("פט-ליין", "ab12cd34")).toBe("site-ab12cd");
    expect(siteSlug("Pet Line TLV!", "ZZ99")).toBe("pet-line-tlv-zz99");
    expect(siteSlug("Pet Line", "ab12")).toMatch(/^[a-z0-9][a-z0-9-]{2,60}$/);
  });

  it("asks for the right language and only offers existing forms/bookings", () => {
    const he = siteJsonInstructions("full", "he", { formSlug: "lead", bookingSlug: null });
    expect(he).toContain("Hebrew");
    expect(he).toContain('"form_slug":"lead"');
    expect(he).not.toContain("booking_slug");
  });
});

describe("Gemini images", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("returns the inline image and falls back across models", async () => {
    process.env.GEMINI_API_KEY = "AQ.image-key-aaaaaaaaaaaaaaaa";
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    delete process.env.AI_GEMINI_IMAGE_MODELS;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "x" }, { inlineData: { mimeType: "image/png", data: Buffer.from("png!").toString("base64") } }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const img = await generateImage("a dog");
    expect(img.mimeType).toBe("image/png");
    expect(img.data.toString()).toBe("png!");
    expect(img.model).toBe("gemini-2.5-flash-image");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("gemini-3.1-flash-image:generateContent?key=");
  });

  it("reports a clear error when no model produced an image", async () => {
    process.env.GEMINI_API_KEY = "AQ.image-key-aaaaaaaaaaaaaaaa";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 })));
    await expect(generateImage("a dog")).rejects.toThrow(/^image_429/);
  });
});
