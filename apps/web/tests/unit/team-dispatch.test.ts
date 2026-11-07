import { afterEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";

describe("a task is handed to its own server call ONLY when that call confirms (else it runs here, never waits forever)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const load = async () => (await import("@/lib/team/runner")).dispatchTaskRun;
  const env = () => {
    vi.stubEnv("CRON_SECRET", "fake-test-cron-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  };

  it("202 + accepted → handed over", async () => {
    env();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, accepted: true }), { status: 202 })));
    expect(await (await load())(ORG, TASK)).toBe(true);
  });
  it("refused (401), a login / error page (200 html), a redirect, or no answer → false (the caller runs it)", async () => {
    env();
    const dispatch = await load();
    for (const r of [new Response("{}", { status: 401 }), new Response("<html>login</html>", { status: 200 }), new Response(null, { status: 307, headers: { location: "https://vercel.com/login" } })]) {
      vi.stubGlobal("fetch", vi.fn(async () => r));
      expect(await dispatch(ORG, TASK)).toBe(false);
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }));
    expect(await dispatch(ORG, TASK)).toBe(false);
  });
  it("no secret / no https address → false without calling anything", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await (await load())(ORG, TASK)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
