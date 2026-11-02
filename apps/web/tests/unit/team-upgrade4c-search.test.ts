import { describe, expect, it } from "vitest";
import { duckBlocked, enabledProviders, finalizeHits, parseBrave, parseDuckHtml, parseGoogleCse, parseSearxng, parseSerper, parseTavily, searxngInstances, unwrapDuckLink } from "@/lib/team/search-providers-core";

describe("search providers — which are enabled", () => {
  it("with nothing set only the keyless fallback is on", () => {
    expect(enabledProviders({})).toEqual(["duckduckgo"]);
  });
  it("keyed providers switch on by themselves and keep the best-first order", () => {
    expect(enabledProviders({ BRAVE_SEARCH_API_KEY: "k", TAVILY_API_KEY: "k", SERPER_API_KEY: "k" })).toEqual(["tavily", "serper", "brave", "duckduckgo"]);
  });
  it("google cse needs both key and cx", () => {
    expect(enabledProviders({ GOOGLE_CSE_API_KEY: "k" })).not.toContain("google_cse");
    expect(enabledProviders({ GOOGLE_CSE_API_KEY: "k", GOOGLE_CSE_ID: "x" })).toContain("google_cse");
  });
  it("keyless can be turned off", () => {
    expect(enabledProviders({ MARKET_SEARCH_KEYLESS: "off" })).toEqual([]);
  });
  it("searxng accepts only public https instances", () => {
    expect(searxngInstances({ SEARXNG_URLS: "https://s.example.org/, http://plain.example.org, https://localhost:8080, https://10.0.0.5" })).toEqual(["https://s.example.org"]);
    expect(enabledProviders({ SEARXNG_URLS: "https://s.example.org" })).toEqual(["searxng", "duckduckgo"]);
  });
});

describe("search providers — response parsers", () => {
  it("tavily", () => {
    expect(parseTavily({ results: [{ title: "A", url: "https://a.example.com/x", content: "text <b>one</b>" }] })).toEqual([{ title: "A", url: "https://a.example.com/x", snippet: "text one" }]);
  });
  it("serper", () => {
    expect(parseSerper({ organic: [{ title: "B", link: "https://b.example.com/", snippet: "s" }] })[0]?.url).toBe("https://b.example.com/");
  });
  it("brave", () => {
    expect(parseBrave({ web: { results: [{ title: "C", url: "https://c.example.com/", description: "d" }] } })).toHaveLength(1);
  });
  it("google cse", () => {
    expect(parseGoogleCse({ items: [{ title: "D", link: "https://d.example.com/", snippet: "s" }] })).toHaveLength(1);
  });
  it("searxng", () => {
    expect(parseSearxng({ results: [{ title: "E", url: "https://e.example.com/", content: "s" }] })).toHaveLength(1);
  });
  it("garbage in, empty out (never throws)", () => {
    for (const f of [parseTavily, parseSerper, parseBrave, parseGoogleCse, parseSearxng]) {
      expect(f(null)).toEqual([]);
      expect(f({ results: "x", organic: 5, web: [], items: {} })).toEqual([]);
    }
  });
  it("drops private, login and duplicate links and caps at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, url: `https://s${i}.example.com/p`, snippet: "x" }));
    const hits = finalizeHits([{ title: "x", url: "http://localhost/a", snippet: "" }, { title: "x", url: "https://a.example.com/login", snippet: "" }, { title: "d", url: "https://dup.example.com/", snippet: "" }, { title: "d", url: "https://dup.example.com/", snippet: "" }, ...many]);
    expect(hits).toHaveLength(8);
    expect(hits.filter((h) => h.url.includes("dup.example.com"))).toHaveLength(1);
    expect(hits.some((h) => /localhost|login/.test(h.url))).toBe(false);
  });
});

describe("duckduckgo (keyless)", () => {
  const html = `<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frival.example.com%2Fpricing&amp;rut=abc">Rival <b>Pricing</b></a></h2><a class="result__snippet" href="x">Plans start at 99 per month</a></div>
  <div class="result"><h2><a class="result__a" href="https://other.example.net/page">Other</a></h2><a class="result__snippet" href="y">Second result</a></div>`;
  it("unwraps redirect links", () => {
    expect(unwrapDuckLink("//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.example.com%2Fa&rut=1")).toBe("https://x.example.com/a");
    expect(unwrapDuckLink("https://duckduckgo.com/y.js?ad=1")).toBe("");
  });
  it("parses results", () => {
    const h = parseDuckHtml(html);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ url: "https://rival.example.com/pricing", title: "Rival Pricing", snippet: "Plans start at 99 per month" });
  });
  it("detects the robot check instead of pretending there are no results", () => {
    expect(duckBlocked("<html>Unfortunately, bots use DuckDuckGo too. anomaly detected</html>")).toBe(true);
    expect(duckBlocked(html)).toBe(false);
    expect(parseDuckHtml("<html>nothing</html>")).toEqual([]);
  });
});
