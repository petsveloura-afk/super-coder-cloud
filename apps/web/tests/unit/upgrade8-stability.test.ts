import { describe, expect, it } from "vitest";
import { addKeyHelp, backoffJitterMs, guardRoute, healthUpdates, maxParallel, modelFitsKind, noteCall, noteStart, providerHasKey, retryAfterMs, skipReason, skipText, skippedView, spreadTasks, type UsageState } from "@/lib/team/stability-core";
import { circuitOf, modelKey, recordResult, type HealthState } from "@/lib/team/model-health-core";
import { classifyToolFailure, explainToolFailure, reasonCode, statusForToolFailure } from "@/lib/team/tool-failure-core";
import { fingerprint, findExisting, intentSimilarity, planMerge, type WorkItem } from "@/lib/team/dedupe-core";
import { localizeLog, localizeTitle, titleInstruction } from "@/lib/team/title-i18n-core";
import { buildQueue, median, nextToHandle, responseStats, slaAlert } from "@/lib/team/response-queue-core";
import { canRestart, restartReason, revivable, staleBlocked } from "@/lib/team/restart-core";
import { runEmployeeTask, type EngineDeps, type EngineMember } from "@/lib/team/engine-core";

const KEY = "k".repeat(30);
const ENV = { GROQ_API_KEY: KEY, GEMINI_API_KEY: KEY };
const NOW = 1_700_000_000_000;
const route = [
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "gemini", model: "gemini-3.6-flash" },
  { provider: "mistral", model: "mistral-small-latest" },
];
const ctx = (usage: UsageState = {}, env: Record<string, string | undefined> = ENV) => ({ env, usage, now: NOW });

describe("stability — providers", () => {
  it("a busy (resting) provider is skipped", () => {
    expect(skipReason("write", "groq", "openai/gpt-oss-120b", ctx({ groq: { restUntil: NOW + 5000, dayCount: 0, streak: 0, inflight: 0 } }))).toBe("resting");
  });
  it("a provider without a server key is skipped", () => {
    expect(providerHasKey("mistral", ENV)).toBe(false);
    expect(skipReason("write", "mistral", "mistral-small-latest", ctx())).toBe("no_key");
    expect(providerHasKey("groq", ENV)).toBe(true);
  });
  it("a text model is never used for images or vision", () => {
    expect(modelFitsKind("vision", "groq", "openai/gpt-oss-120b")).toBe(false);
    expect(modelFitsKind("vision", "gemini", "gemini-3.6-flash")).toBe(true);
    expect(modelFitsKind("image", "groq", "llama-3.3-70b-versatile")).toBe(false);
    expect(modelFitsKind("image", "gemini", "gemini-2.5-flash-image")).toBe(true);
  });
  it("the vision route drops the text-only first choice", () => {
    const g = guardRoute("vision", route, ctx());
    expect(g.route.map((r) => r.provider)).toEqual(["gemini"]);
    expect(g.skipped.map((s) => s.reason).sort()).toEqual(["no_key", "wrong_kind"]);
  });
  it("over the daily quota and failure streaks are skipped", () => {
    expect(skipReason("write", "groq", "x", ctx({ groq: { restUntil: 0, dayCount: 99_999, streak: 0, inflight: 0 } }))).toBe("over_daily_quota");
    expect(skipReason("write", "groq", "x", ctx({ groq: { restUntil: 0, dayCount: 0, streak: 4, inflight: 0 } }))).toBe("fail_streak");
  });
  it("parallel limit per provider", () => {
    expect(skipReason("write", "groq", "x", ctx({ groq: { restUntil: 0, dayCount: 0, streak: 0, inflight: maxParallel("groq") } }))).toBe("too_many_parallel");
  });
  it("when everything would be skipped the original route comes back", () => {
    const g = guardRoute("write", [{ provider: "mistral", model: "m" }], ctx());
    expect(g.route).toHaveLength(1);
    expect(g.skipped).toEqual([]);
  });
  it("never exposes a key", () => {
    const g = guardRoute("write", route, ctx());
    expect(JSON.stringify(g)).not.toContain(KEY);
    expect(JSON.stringify(skippedView(g.skipped, "he"))).not.toContain(KEY);
  });
  it("Retry-After in seconds and as an HTTP date; garbage is null", () => {
    expect(retryAfterMs("30", NOW)).toBe(30_000);
    expect(retryAfterMs(new Date(NOW + 60_000).toUTCString(), NOW)).toBeGreaterThan(55_000);
    expect(retryAfterMs("soon", NOW)).toBeNull();
    expect(retryAfterMs(null, NOW)).toBeNull();
  });
  it("a 429 with Retry-After rests the provider exactly that long", () => {
    const u = noteCall(noteStart({}, "groq"), "groq", { ok: false, retryAfter: "20", error: "429" }, NOW);
    expect(u.groq!.restUntil).toBe(NOW + 20_000);
    expect(u.groq!.inflight).toBe(0);
  });
  it("backoff grows, is capped and jittered", () => {
    expect(backoffJitterMs(1, {}, () => 0)).toBeLessThan(backoffJitterMs(4, {}, () => 0));
    expect(backoffJitterMs(30, { capMs: 1000 }, () => 1)).toBeLessThanOrEqual(1000);
    expect(backoffJitterMs(3, {}, () => 0)).not.toBe(backoffJitterMs(3, {}, () => 1));
  });
  it("tasks spread across employees", () => {
    const t = [{ id: "1", assignee_id: "a" }, { id: "2", assignee_id: "a" }, { id: "3", assignee_id: "b" }, { id: "4", assignee_id: "c" }];
    expect(spreadTasks(t, 3).map((x) => x.id)).toEqual(["1", "3", "4"]);
    expect(spreadTasks(t, 0)).toEqual([]);
  });
  it("texts exist in three languages incl. the no-key line and the Groq help", () => {
    expect(skipText("no_key", "he")).toBe("ספק ללא מפתח — מדולג");
    expect(skipText("no_key", "en")).toContain("without a key");
    expect(skipText("no_key", "ar")).toBeTruthy();
    expect(addKeyHelp("groq", "he")).toContain("GROQ_API_KEY");
    expect(addKeyHelp("groq", "en")).toContain("console.groq.com");
  });
});

describe("model health — fallback_used (both directions)", () => {
  const first = { provider: "gemini", model: "gemini-3.6-flash" };
  const used = { provider: "mistral", model: "mistral-small-latest" };
  const apply = (ups: ReturnType<typeof healthUpdates>) => ups.reduce((s: HealthState, u) => recordResult(s, modelKey(u.provider, u.model), u.ok, NOW, u.error), {});
  it("a model that really failed counts as a failure", () => {
    const ups = healthUpdates({ first, used: null, ok: false, error: "ai.failed" });
    expect(ups).toEqual([{ provider: "gemini", model: "gemini-3.6-flash", ok: false, error: "ai.failed" }]);
    expect(apply(ups)[modelKey("gemini", "gemini-3.6-flash")]!.failed).toBe(1);
  });
  it("a call that succeeded through a fallback does not hurt anyone", () => {
    const s = apply(healthUpdates({ first, used, ok: true }));
    expect(s[modelKey("gemini", "gemini-3.6-flash")]).toBeUndefined();
    expect(s[modelKey("mistral", "mistral-small-latest")]!.failed).toBe(0);
    expect(circuitOf(s, modelKey("gemini", "gemini-3.6-flash"), NOW)).toBe("closed");
  });
  it("a known failed attempt of the first choice still counts", () => {
    const ups = healthUpdates({ first, used, ok: true, attempts: [{ ...first, ok: false, reason: "429" }] });
    expect(ups.find((u) => u.model === first.model)!.ok).toBe(false);
    expect(ups.find((u) => u.model === used.model)!.ok).toBe(true);
  });
  it("the first choice answering is a success", () => {
    expect(healthUpdates({ first, used: first, ok: true })).toEqual([{ ...first, ok: true }]);
  });
});

describe("tool failures", () => {
  it("a missing connection is 'requires_connection', not failed", () => {
    expect(statusForToolFailure("not_sent_guard_or_channel")).toBe("requires_connection");
    expect(classifyToolFailure("oauth token expired").needsConnection).toBe(true);
  });
  it("classifies data, temporary, input and bug", () => {
    expect(classifyToolFailure("contact_not_found").kind).toBe("missing_data");
    expect(classifyToolFailure("fetch failed ETIMEDOUT").kind).toBe("temporary");
    expect(classifyToolFailure("bad_time").kind).toBe("bad_input");
    expect(classifyToolFailure("weird thing").kind).toBe("bug");
    expect(statusForToolFailure("contact_not_found")).toBe("failed");
  });
  it("one action per language", () => {
    for (const l of ["he", "en", "ar"] as const) expect(explainToolFailure("contact_not_found", l).action.length).toBeGreaterThan(10);
    expect(explainToolFailure("oauth", "he").label).toBe("דורש חיבור");
  });
  it("AI-busy errors keep their own reason code", () => {
    expect(reasonCode("ai.failed")).toBe("ai_busy");
    expect(reasonCode("contact_not_found")).toBe("input");
    expect(reasonCode("no_pipeline")).toBe("tool_missing_data");
  });
});

describe("duplicates", () => {
  const T = (id: string, title: string, status = "pending", at = NOW - 3_600_000, extra: Partial<WorkItem> = {}): WorkItem => ({ id, title, status, created_at: at, assignee: "m1", ...extra });
  it("same intent across languages is similar", () => {
    expect(intentSimilarity("Publish posts", "פרסם פוסטים")).toBeGreaterThanOrEqual(0.99);
    expect(intentSimilarity("Publish posts", "Write invoice reminders")).toBeLessThan(0.3);
  });
  it("fingerprint: same intent+recipient+window collides, other recipient does not", () => {
    const a = fingerprint({ title: "Follow up with leads", recipient: "x", at: NOW });
    expect(a).toBe(fingerprint({ title: "follow-up leads", recipient: "x", at: NOW }));
    expect(a).not.toBe(fingerprint({ title: "Follow up with leads", recipient: "y", at: NOW }));
  });
  it("findExisting blocks a duplicate but not another owner's task", () => {
    const open = [T("a", "Define post content & CTA")];
    expect(findExisting({ title: "הגדר תוכן פוסט ו-CTA", assignee: "m1" }, open, NOW)).toBe("a");
    expect(findExisting({ title: "Define post content & CTA", assignee: "m2" }, open, NOW)).toBeNull();
  });
  it("merge plan marks duplicates 'merged', keeps the most advanced, never touches done", () => {
    const items = [T("a", "Publish posts", "pending", NOW - 5000), T("b", "Publish posts", "in_progress", NOW - 4000), T("c", "Publish posts", "done", NOW - 3000), T("d", "Pay rent", "pending")];
    const p = planMerge(items, NOW);
    expect(p.steps).toEqual([{ id: "a", mergedInto: "b", status: "merged", reason: "same_intent" }]);
    expect(p.groups).toBe(1);
  });
});

describe("display translation", () => {
  it("old English titles and log lines show in the business language", () => {
    expect(localizeTitle("Publish posts", "he")).toBe("פרסום פוסטים");
    expect(localizeTitle("Define post content & CTA", "he")).toContain("קריאה לפעולה");
    expect(localizeTitle("Publish posts", "en")).toBe("Publish posts");
    expect(localizeTitle("פרסום פוסטים", "he")).toBe("פרסום פוסטים");
    expect(localizeLog("The plan could not be read.", "he")).toContain("תוכנית");
    expect(localizeLog("Loaded the business profile, 4 memories and the sales playbook.", "he")).toContain("4");
    expect(localizeLog("Model fallback used 2× (plan: a → b).", "ar")).toContain("2");
    expect(localizeLog("Unknown line", "he")).toBe("Unknown line");
  });
  it("new titles are asked for in the business language", () => {
    expect(titleInstruction("he")).toContain("Hebrew");
  });
});

describe("response queue", () => {
  const rows = [{ id: "1", waitingSince: NOW - 600 * 60_000 }, { id: "2", waitingSince: NOW - 30 * 60_000, value: 50_000 }, { id: "3", waitingSince: NOW - 90 * 60_000, automated: true }, { id: "4", waitingSince: NOW - 10 * 60_000, answeredAt: NOW }];
  it("orders by age and value, drops robots and answered", () => {
    const q = buildQueue(rows, NOW, 60);
    expect(q.map((x) => x.id)).toEqual(["1", "2"]);
    expect(q[0]!.state).toBe("breached");
    expect(nextToHandle(q, 1)).toHaveLength(1);
  });
  it("median next to the average and an alert", () => {
    const s = responseStats([5, 8, 10, 12, 4000], 60);
    expect(s.medianMinutes).toBe(10);
    expect(s.avgMinutes).toBeGreaterThan(800);
    expect(median([1, 3])).toBe(2);
    expect(slaAlert([], responseStats([200, 300, 400], 60), 60).code).toBe("median_over_target");
    expect(slaAlert([], responseStats([5, 6, 7], 60), 60).level).toBe("none");
  });
});

describe("restart + stale blocked + revive", () => {
  it("restart rules with reasons", () => {
    const base = { id: "t", status: "failed" };
    expect(canRestart(base, { emergencyStop: false })).toEqual({ ok: true });
    expect(canRestart({ id: "t", status: "done" }, { emergencyStop: false })).toEqual({ ok: false, reason: "not_restartable" });
    expect(canRestart(base, { emergencyStop: true })).toEqual({ ok: false, reason: "emergency_stop" });
    expect(canRestart({ ...base, depends_on: ["x"] }, { emergencyStop: false, dependencyStatus: { x: "failed" } })).toEqual({ ok: false, reason: "dependency_failed" });
    expect(canRestart({ id: "t", status: "requires_connection" }, { emergencyStop: false, connectionReady: false })).toEqual({ ok: false, reason: "needs_connection" });
    expect(canRestart({ ...base, error: "daily_credit_cap" }, { emergencyStop: false, creditsLeft: 0 })).toEqual({ ok: false, reason: "budget" });
    expect(restartReason("emergency_stop", "he")).toContain("חירום");
  });
  it("only old blocked items are listed for bulk cancel", () => {
    const old = new Date(NOW - 5 * 86_400_000).toISOString();
    const fresh = new Date(NOW - 3_600_000).toISOString();
    const r = staleBlocked([{ id: "a", status: "blocked", updated_at: old }, { id: "b", status: "blocked", updated_at: fresh }, { id: "c", status: "done", updated_at: old }], NOW);
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });
  it("a task blocked only by a no-longer-failed dependency comes back", () => {
    const t = [{ id: "a", status: "blocked", error: "dependency_failed", depends_on: ["d1"] }, { id: "b", status: "blocked", error: "dependency_failed", depends_on: ["d2"] }, { id: "c", status: "blocked", error: "other", depends_on: ["d1"] }];
    expect(revivable(t, { d1: "pending", d2: "failed" }).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("engine guards still hold (emergency stop, credit cap)", () => {
  const member = { id: "m", role: "sales", name: "x", tone: null, instructions: "", tools: [], autonomy: "approve", auto_actions: [], status: "active", limits: {} } as unknown as EngineMember;
  const deps = { lang: "he", interactive: false, log: async () => undefined, message: async () => undefined } as unknown as EngineDeps;
  const task = { id: "t", title: "x", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null };
  const settings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 12, daily_credit_cap: 100, day_credits: 0 };
  it("emergency stop blocks the task", async () => {
    const out = await runEmployeeTask(deps, member, task, { ...settings, emergency_stop: true });
    expect(out.status).toBe("blocked");
    expect(out.error).toBe("emergency_stop");
  });
  it("the daily credit cap blocks the task", async () => {
    const out = await runEmployeeTask(deps, member, task, { ...settings, day_credits: 100 });
    expect(out.status).toBe("blocked");
    expect(out.error).toMatch(/credit/);
  });
});
