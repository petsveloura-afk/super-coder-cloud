import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEGRADED_BELOW, HEALTH_WINDOW_MS, MAX_SAMPLES, MIN_SAMPLES, providerHealth, rankByHealth, recordSample, reorderWithin, summarizeWindow, type HealthWindow } from "@/lib/ai/provider-health-core";
import { hintForFeature, hintOrder } from "@/lib/ai/task-hint-core";
import { backgroundShouldWait, enterLive, GATE_DEFAULTS, leaveLive, liveCount, pruneLive } from "@/lib/ai/lane-gate-core";

const NOW = 10_000_000;
const rec = (st: HealthWindow, p: string, ok: boolean, ago = 0, ms = 400): HealthWindow => recordSample(st, p, { t: NOW - ago, ok, ms }, NOW);
const many = (st: HealthWindow, p: string, oks: boolean[], ago = 1000): HealthWindow => oks.reduce((s, ok) => rec(s, p, ok, ago), st);

describe("wave 66 — provider health window (pure)", () => {
  it("keeps only the last 15 minutes and never mutates the input", () => {
    const a: HealthWindow = {};
    const b = rec(a, "groq", true, HEALTH_WINDOW_MS + 5000);
    expect(a).toEqual({});
    const c = rec(b, "groq", true, 1000);
    expect(c.groq).toHaveLength(1); // the 15-minute-old sample was dropped when the new one arrived
    expect(providerHealth(b, "groq", NOW).calls).toBe(0); // and is ignored when reading
  });
  it("bounds the memory per provider", () => {
    let st: HealthWindow = {};
    for (let i = 0; i < MAX_SAMPLES + 50; i++) st = rec(st, "gemini", true, 10);
    expect(st.gemini).toHaveLength(MAX_SAMPLES);
  });
  it("ignores garbage samples instead of throwing", () => {
    const st = recordSample({}, "groq", { t: Number.NaN, ok: true, ms: 1 }, NOW);
    expect(st).toEqual({});
    expect(recordSample({}, "", { t: NOW, ok: true, ms: 1 }, NOW)).toEqual({});
  });
  it("computes success rate and the average time of the successful calls only", () => {
    let st: HealthWindow = {};
    st = rec(st, "groq", true, 100, 200);
    st = rec(st, "groq", true, 100, 400);
    st = rec(st, "groq", false, 100, 9000);
    const h = providerHealth(st, "groq", NOW);
    expect(h).toMatchObject({ calls: 3, okCalls: 2, avgMs: 300, neutral: false, degraded: false });
    expect(h.successRate).toBeCloseTo(2 / 3);
    expect(h.shaky).toBe(true);
  });
  it("a provider with fewer than 3 calls is neutral even if every call failed", () => {
    const st = many({}, "gemini", [false, false]);
    const h = providerHealth(st, "gemini", NOW);
    expect(MIN_SAMPLES).toBe(3);
    expect(h).toMatchObject({ calls: 2, neutral: true, degraded: false, shaky: false });
    const route = [{ provider: "gemini" }, { provider: "groq" }];
    expect(rankByHealth(route, st, NOW)).toEqual(route);
  });
  it("flags degraded only with enough data and a rate under 50%", () => {
    expect(DEGRADED_BELOW).toBe(0.5);
    expect(providerHealth(many({}, "x", [false, false, false]), "x", NOW).degraded).toBe(true);
    expect(providerHealth(many({}, "x", [true, false, true, false]), "x", NOW).degraded).toBe(false); // exactly 50% is not degraded
    expect(providerHealth(many({}, "x", [true, true, true, true, false]), "x", NOW)).toMatchObject({ degraded: false, shaky: false });
  });
  it("a degraded provider goes after the healthy ones; order is kept inside each tier", () => {
    const st = many({}, "gemini", [false, false, false, false]);
    const route = [{ provider: "gemini", model: "a" }, { provider: "gemini", model: "b" }, { provider: "groq", model: "c" }, { provider: "cerebras", model: "d" }, { provider: "groq", model: "e" }];
    const out = rankByHealth(route, st, NOW);
    expect(out.map((r) => r.model)).toEqual(["c", "d", "e", "a", "b"]);
    expect(out).toHaveLength(route.length); // nothing removed
  });
  it("never removes: when everything is degraded the order is unchanged", () => {
    let st: HealthWindow = {};
    for (const p of ["groq", "gemini"]) st = many(st, p, [false, false, false]);
    const route = [{ provider: "gemini" }, { provider: "groq" }];
    expect(rankByHealth(route, st, NOW)).toEqual(route);
  });
  it("the provider recovers when its failures leave the 15-minute window", () => {
    const st = many({}, "gemini", [false, false, false, false], HEALTH_WINDOW_MS + 1000);
    const route = [{ provider: "gemini" }, { provider: "groq" }];
    expect(rankByHealth(route, st, NOW)).toEqual(route);
  });
  it("shaky providers go after healthy but before degraded", () => {
    let st: HealthWindow = {};
    st = many(st, "gemini", [false, false, false, true]); // 25% → degraded
    st = many(st, "groq", [true, true, true, false, true]); // 80% → healthy
    st = many(st, "cerebras", [true, true, false]); // 67% → shaky
    const route = [{ provider: "gemini" }, { provider: "cerebras" }, { provider: "groq" }];
    expect(rankByHealth(route, st, NOW).map((r) => r.provider)).toEqual(["groq", "cerebras", "gemini"]);
  });
  it("paid providers keep the positions they had — free capacity is never swapped with paid", () => {
    const st = many({}, "groq", [false, false, false]);
    const route = [{ provider: "groq" }, { provider: "anthropic" }, { provider: "cerebras" }, { provider: "openai" }];
    const out = rankByHealth(route, st, NOW).map((r) => r.provider);
    expect(out).toEqual(["cerebras", "anthropic", "groq", "openai"]);
    // a degraded paid provider never jumps ahead of the free ones either
    const st2 = many({}, "anthropic", [false, false, false]);
    expect(rankByHealth([{ provider: "gemini" }, { provider: "anthropic" }, { provider: "openai" }], st2, NOW).map((r) => r.provider)).toEqual(["gemini", "openai", "anthropic"]);
  });
  it("reorderWithin is stable and only moves items inside their class", () => {
    const items = [{ c: "a", n: 3 }, { c: "b", n: 9 }, { c: "a", n: 1 }, { c: "a", n: 1 }];
    const out = reorderWithin(items, (x) => x.c, (x, y) => x.n - y.n);
    expect(out.map((x) => `${x.c}${x.n}`)).toEqual(["a1", "b9", "a1", "a3"]);
    expect(out[1]).toBe(items[1]);
  });
  it("summarizes the window for a health card, worst first, without silent providers", () => {
    let st: HealthWindow = {};
    st = many(st, "groq", [true, true, true]);
    st = many(st, "gemini", [false, false, false]);
    st = many(st, "mistral", [true]);
    st = many(st, "old", [true, true, true], HEALTH_WINDOW_MS + 5000);
    const rows = summarizeWindow(st, NOW);
    expect(rows.map((r) => `${r.provider}:${r.status}`)).toEqual(["gemini:degraded", "mistral:neutral", "groq:healthy"]);
  });
});

describe("wave 66 — model hint by kind of work (pure)", () => {
  it("short work is fast, heavy work is strong, everything else has no opinion", () => {
    for (const f of ["contact_summary", "segment", "transcribe", "brief"]) expect(hintForFeature(f)).toBe("fast");
    for (const f of ["insights", "forecast", "sales_manager", "site_builder"]) expect(hintForFeature(f)).toBe("strong");
    for (const f of ["autopilot", "agent_chat", "voice", "kb", "vision", "collections", "review_reply", "social", "marketing", "copilot", "whatever", "", null, undefined]) expect(hintForFeature(f as string | null | undefined)).toBeNull();
  });
  const gem = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"].map((model) => ({ provider: "gemini", model }));
  const groq = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"].map((model) => ({ provider: "groq", model }));
  it("no hint → the very same array (today's order)", () => {
    const route = [...gem, ...groq];
    expect(hintOrder(route, null)).toBe(route);
    expect(hintOrder(route, undefined, "gemini")).toBe(route);
  });
  it("fast puts the lite model first inside a provider and keeps the providers where they were", () => {
    const route = [...groq, ...gem];
    const out = hintOrder(route, "fast");
    expect(out.map((r) => r.provider)).toEqual(route.map((r) => r.provider));
    expect(out.filter((r) => r.provider === "gemini")[0]!.model).toBe("gemini-3.5-flash-lite");
    expect([...out].map((r) => r.model).sort()).toEqual([...route].map((r) => r.model).sort());
  });
  it("strong keeps the non-lite model ahead of the lite one", () => {
    const route = [{ provider: "gemini", model: "gemini-3.5-flash-lite" }, { provider: "gemini", model: "gemini-3.8-flash" }];
    expect(hintOrder(route, "strong").map((r) => r.model)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });
  it("the preferred provider (the agent's / team's explicit choice) is never touched", () => {
    const route = [{ provider: "gemini", model: "gemini-3.8-flash" }, { provider: "gemini", model: "gemini-3.5-flash-lite" }, ...groq];
    const out = hintOrder(route, "fast", "gemini");
    expect(out.slice(0, 2).map((r) => r.model)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });
  it("keys of one model keep their order (model-major route)", () => {
    const route = [
      { provider: "gemini", model: "gemini-3.8-flash", key: "k1" },
      { provider: "gemini", model: "gemini-3.8-flash", key: "k2" },
      { provider: "gemini", model: "gemini-3.5-flash-lite", key: "k1" },
      { provider: "gemini", model: "gemini-3.5-flash-lite", key: "k2" },
    ];
    expect(hintOrder(route, "fast").map((r) => `${r.model}:${r.key}`)).toEqual(["gemini-3.5-flash-lite:k1", "gemini-3.5-flash-lite:k2", "gemini-3.8-flash:k1", "gemini-3.8-flash:k2"]);
  });
});

describe("wave 66 — lane gate (pure)", () => {
  it("a live request counts until it leaves or its lease expires", () => {
    let st = enterLive({}, "a", 1000, 5000);
    st = enterLive(st, "b", 1000, 5000);
    expect(liveCount(st, 2000)).toBe(2);
    st = leaveLive(st, "a");
    expect(liveCount(st, 2000)).toBe(1);
    expect(liveCount(st, 7000)).toBe(0); // a crashed call stops counting
    expect(pruneLive(st, 7000)).toEqual({});
    expect(leaveLive(st, "nope")).toBe(st);
  });
  it("background waits only while live requests run and only up to the cap", () => {
    const st = enterLive({}, "a", 0);
    expect(backgroundShouldWait(st, 100, 0)).toBe(true);
    expect(backgroundShouldWait(st, 100, GATE_DEFAULTS.maxWaitMs - 1)).toBe(true);
    expect(backgroundShouldWait(st, 100, GATE_DEFAULTS.maxWaitMs)).toBe(false);
    expect(backgroundShouldWait({}, 100, 0)).toBe(false);
    expect(GATE_DEFAULTS.maxWaitMs).toBeLessThanOrEqual(3000);
  });
});

describe("wave 66 — lane gate and health glue (in-process)", () => {
  beforeEach(() => vi.resetModules());
  it("a live request is never delayed, even when other live requests are running", async () => {
    const g = await import("@/lib/ai/lane-gate");
    const r1 = await g.laneEnter("interactive");
    const t0 = Date.now();
    const r2 = await g.laneEnter("interactive");
    expect(Date.now() - t0).toBeLessThan(50);
    expect(g.liveNow()).toBe(2);
    r1();
    r1(); // releasing twice is harmless
    expect(g.liveNow()).toBe(1);
    r2();
    expect(g.liveNow()).toBe(0);
  });
  it("a background request goes on at once when no live request is running", async () => {
    const g = await import("@/lib/ai/lane-gate");
    const t0 = Date.now();
    await g.laneEnter("background", { maxWaitMs: 500, pollMs: 20 });
    expect(Date.now() - t0).toBeLessThan(50);
  });
  it("a background request steps aside while a live one runs, but never longer than the cap — then it goes on", async () => {
    const g = await import("@/lib/ai/lane-gate");
    const live = await g.laneEnter("interactive");
    const t0 = Date.now();
    await g.laneEnter("background", { maxWaitMs: 300, pollMs: 20 });
    const waited = Date.now() - t0;
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(900);
    expect(g.liveNow()).toBe(1); // the live request was untouched
    live();
  });
  it("a background request goes on as soon as the live request finishes", async () => {
    const g = await import("@/lib/ai/lane-gate");
    const live = await g.laneEnter("interactive");
    setTimeout(live, 120);
    const t0 = Date.now();
    await g.laneEnter("background", { maxWaitMs: 2000, pollMs: 20 });
    expect(Date.now() - t0).toBeLessThan(600);
  });
  it("the health glue never throws and never drops a candidate", async () => {
    const h = await import("@/lib/ai/provider-health");
    h.resetHealthWindow();
    expect(() => h.noteAttempt({ provider: "groq", ok: true, ms: Number.NaN })).not.toThrow();
    for (let i = 0; i < 4; i++) h.noteAttempt({ provider: "gemini", ok: false, ms: 900 });
    const route = [{ provider: "gemini", model: "a" }, { provider: "groq", model: "b" }];
    const out = h.tuneCandidates(route);
    expect(out.map((r) => r.provider)).toEqual(["groq", "gemini"]);
    expect(out).toHaveLength(2);
    expect(h.healthRows()[0]).toMatchObject({ provider: "gemini", status: "degraded" });
    expect(h.tuneCandidates(null as unknown as typeof route)).toBeNull(); // a bad input falls back to "unchanged"
  });
});

describe("wave 66 — router integration (mocked network)", () => {
  const saved = { ...process.env };
  const G1 = "G".repeat(24);
  const GROQ = "q".repeat(24);
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) if (/_API_KEY|AI_PROVIDER_ORDER|SUPABASE_SERVICE_ROLE_KEY/.test(k)) delete process.env[k];
    process.env.AI_GEMINI_BASE_URL = "https://gemini.example/v1beta";
    process.env.AI_GROQ_BASE_URL = "https://groq.example/openai/v1";
    process.env.GEMINI_API_KEY = G1;
    process.env.GROQ_API_KEY = GROQ;
    process.env.AI_GEMINI_MODELS = "gemini-3.8-flash";
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/ai/provider-health");
    vi.doUnmock("@/lib/ai/lane-gate");
    vi.resetModules();
  });
  const geminiOk = (t: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }), { status: 200 });
  const groqOk = (t: string) => new Response(JSON.stringify({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: "openai/gpt-oss-120b" }), { status: 200 });
  const net = () => vi.fn(async (url: string) => (String(url).includes("gemini.example") ? geminiOk("g") : groqOk("q")));
  const args = { preferred: "gemini", model: "gemini-3.8-flash", system: "s", messages: [{ role: "user" as const, content: "x" }] };

  it("without health data the order is exactly today's: the preferred provider answers first", async () => {
    const fetchMock = net();
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    const r = await generateRouted(args);
    expect(r.provider).toBe("gemini");
    expect(r.attempts.map((a) => a.provider)).toEqual(["gemini"]);
  });
  it("a provider that failed in a row in the last 15 minutes is tried after the healthy one (re-rank only)", async () => {
    const h = await import("@/lib/ai/provider-health");
    for (let i = 0; i < 4; i++) h.noteAttempt({ provider: "gemini", ok: false, ms: 800 });
    const fetchMock = net();
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    const r = await generateRouted(args);
    expect(r.provider).toBe("groq");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("groq.example");
  });
  it("the router records every attempt (success and response time) into the window", async () => {
    vi.stubGlobal("fetch", net());
    const { generateRouted } = await import("@/lib/ai/router");
    await generateRouted(args);
    await generateRouted(args);
    await generateRouted(args);
    await new Promise((r) => setTimeout(r, 20));
    const h = await import("@/lib/ai/provider-health");
    expect(h.healthRows().find((x) => x.provider === "gemini")).toMatchObject({ calls: 3, status: "healthy" });
  });
  it("the live lease is released after an answer and after a failure", async () => {
    const g = await import("@/lib/ai/lane-gate");
    vi.stubGlobal("fetch", net());
    const { generateRouted } = await import("@/lib/ai/router");
    await generateRouted(args);
    expect(g.liveNow()).toBe(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await generateRouted(args).catch(() => undefined);
    expect(g.liveNow()).toBe(0);
  });
  it("a background request is not held up when nothing live is running", async () => {
    vi.stubGlobal("fetch", net());
    const { generateRouted } = await import("@/lib/ai/router");
    const t0 = Date.now();
    await generateRouted({ ...args, lane: "background" });
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("the hint orders the MODELS of a non-preferred provider and never the provider itself", async () => {
    process.env.AI_GROQ_MODELS = "llama-3.3-70b-versatile,openai/gpt-oss-120b";
    process.env.AI_GEMINI_MODELS = "gemini-3.8-flash,gemini-3.5-flash-lite";
    const { buildCandidates } = await import("@/lib/ai/router-core");
    const { tuneCandidates } = await import("@/lib/ai/provider-health");
    const base = buildCandidates({ preferred: "groq", model: "llama-3.3-70b-versatile", env: process.env, random: () => 0 });
    const tuned = tuneCandidates(base, { preferred: "groq", hint: "fast" });
    expect(tuned.map((c) => c.provider)).toEqual(base.map((c) => c.provider));
    expect(tuned.filter((c) => c.provider === "groq").map((c) => c.model)).toEqual(base.filter((c) => c.provider === "groq").map((c) => c.model));
    expect(tuned.filter((c) => c.provider === "gemini")[0]!.model).toBe("gemini-3.5-flash-lite");
  });
  it("if the health module fails to load, the router behaves exactly as before", async () => {
    vi.doMock("@/lib/ai/provider-health", () => {
      throw new Error("boom");
    });
    const fetchMock = net();
    vi.stubGlobal("fetch", fetchMock);
    const { generateRouted } = await import("@/lib/ai/router");
    const r = await generateRouted(args);
    expect(r.provider).toBe("gemini");
  });
  it("if the lane gate fails to load, the request still runs", async () => {
    vi.doMock("@/lib/ai/lane-gate", () => {
      throw new Error("boom");
    });
    vi.stubGlobal("fetch", net());
    const { generateRouted } = await import("@/lib/ai/router");
    const r = await generateRouted({ ...args, lane: "background" });
    // the background lane walks the free engines in the opposite order (wave 55) — the point here is only that the request runs
    expect(r.text).toBeTruthy();
    expect(r.attempts.some((x) => x.ok)).toBe(true);
  });
});

describe("wave 66 — wiring keeps today's lines", () => {
  const read = (p: string): string => readFileSync(`${import.meta.dirname}/../../${p}`, "utf8");
  it("run-system keeps the explicit team choice and only adds the hint", () => {
    const s = read("lib/ai/run-system.ts");
    expect(s).toContain("preferred: input.routeProvider || input.provider || provider");
    expect(s).toContain("hint: input.routeProvider ? null : hintForFeature(input.feature)");
  });
  it("the router keeps the paid-last chain and the rests (capRest / ai_provider_rests)", () => {
    const s = read("lib/ai/router.ts");
    expect(s).toContain("capRest(cl, process.env)");
    expect(s).toContain('from("ai_provider_rests")');
    expect(s).toContain("tuneInPlace(cands, input.preferred, input.hint)");
  });
});
