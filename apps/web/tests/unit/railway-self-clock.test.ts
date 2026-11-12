import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLOCK_JOBS, clockEnabled, loopbackBase, nextDelay, publicBase } from "@/lib/ops/self-clock-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Railway — the built-in background clock", () => {
  const prod = { NODE_ENV: "production", CRON_SECRET: "x".repeat(32) };
  it("runs by itself on Railway; never on Vercel, during a build, without CRON_SECRET or when turned off", () => {
    expect(clockEnabled({ ...prod, RAILWAY_ENVIRONMENT_NAME: "production" })).toEqual({ on: true, reason: "railway" });
    expect(clockEnabled({ ...prod, RAILWAY_ENVIRONMENT_NAME: "production", VERCEL: "1" }).on).toBe(false);
    expect(clockEnabled({ ...prod, RAILWAY_SERVICE_ID: "s", NEXT_PHASE: "phase-production-build" }).on).toBe(false);
    expect(clockEnabled({ NODE_ENV: "production", RAILWAY_SERVICE_ID: "s" })).toEqual({ on: false, reason: "no_cron_secret" });
    expect(clockEnabled({ ...prod, RAILWAY_SERVICE_ID: "s", SELF_CLOCK: "off" }).on).toBe(false);
    expect(clockEnabled({ ...prod, SELF_CLOCK: "on" }).on).toBe(true); // any always-on host (Docker)
    expect(clockEnabled({ ...prod }).on).toBe(false); // unknown host: off unless asked
    expect(clockEnabled({ CRON_SECRET: "x", RAILWAY_SERVICE_ID: "s", NODE_ENV: "development" }).on).toBe(false);
  });
  it("calls every background job on a steady, staggered pace over loopback", () => {
    const paths = CLOCK_JOBS.map((j) => j.path);
    for (const p of ["/api/jobs/dispatch", "/api/cron/team", "/api/cron/social", "/api/cron/agents", "/api/ai/followups", "/api/channels/email/poll", "/api/cron/growth", "/api/cron/social-brain", "/api/billing/sweep", "/api/keepalive", "/api/cron/meta-sync"]) expect(paths).toContain(p);
    expect(new Set(CLOCK_JOBS.map((j) => j.firstMs)).size).toBe(CLOCK_JOBS.length); // never all at once
    expect(CLOCK_JOBS.every((j) => j.everyMs >= 60_000 && j.timeoutMs >= 60_000)).toBe(true);
    expect(loopbackBase({ PORT: "8080" })).toBe("http://127.0.0.1:8080");
    expect(loopbackBase({})).toBe("http://127.0.0.1:3000");
    expect(nextDelay(CLOCK_JOBS[0]!, false)).toBeGreaterThanOrEqual(30_000);
  });
  it("the public address: the app's https URL or Railway's domain — never localhost", () => {
    expect(publicBase({ NEXT_PUBLIC_APP_URL: "https://app.supercoder.agency/" })).toBe("https://app.supercoder.agency");
    expect(publicBase({ NEXT_PUBLIC_APP_URL: "http://localhost:8080", RAILWAY_PUBLIC_DOMAIN: "x-production.up.railway.app" })).toBe("https://x-production.up.railway.app");
    expect(publicBase({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBeNull();
  });
  it("is wired: started at boot, re-points the database clock, shown on /api/health, never prints the secret", () => {
    expect(read("instrumentation.ts")).toContain("startSelfClock()");
    const clock = read("lib/ops/self-clock.ts");
    for (const fn of ["schedule_platform_jobs", "schedule_team_job", "schedule_meta_inbound_sync"]) expect(clock).toContain(fn);
    expect(clock).toContain("SELF_CLOCK_DB");
    expect(clock).not.toMatch(/console\.\w+\([^)]*secret/);
    expect(read("app/api/health/route.ts")).toContain("clock:");
  });
  it("the team's own task runs stay on the server (loopback) on Railway", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toContain("clockEnabled(process.env).on ? loopbackBase(process.env) : raw");
    expect(r).toContain("RAILWAY_PUBLIC_DOMAIN");
  });
  it("Telegram bots follow the app to its new address by themselves", () => {
    const t = read("lib/channels/telegram-setup.ts");
    expect(t).toContain("webhook_base: publicEnv.appUrl");
    expect(t).toContain("(a.config ?? {}).webhook_base !== here");
  });
  it("Railway hosts are the app's own hosts (never looked up as a customer website)", () => {
    const p = read("proxy.ts");
    expect(p).toContain('host.endsWith(".up.railway.app")');
    expect(p).toContain("RAILWAY_PUBLIC_DOMAIN");
  });
  it("the Vercel deploy workflow skips cleanly once the site runs elsewhere", () => {
    const w = readFileSync(join(root, "..", "..", ".github/workflows/sync-production.yml"), "utf8");
    expect(w).toContain('grep -q "vercel.app"');
  });
});
