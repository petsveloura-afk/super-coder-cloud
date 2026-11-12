/**
 * Built-in clock for an always-on server (Railway, Docker, any long-running Node host) — pure parts, unit-tested.
 *
 * On Vercel the platform woke the background jobs up (Vercel Cron + GitHub + Supabase pg_cron + the WhatsApp bridge
 * heartbeat). On an always-on server the app can keep its own clock: every background route is called on a fixed interval
 * from inside the server itself (loopback HTTP with the CRON_SECRET), staggered so they never all start together.
 *
 * Safe by design:
 *   • every route already runs under its own database lock (job_runs) — a call from this clock, from pg_cron, from GitHub or
 *     from the bridge heartbeat at the same moment simply skips; nothing ever runs twice;
 *   • one call per job at a time inside this server (a slow run is never stacked);
 *   • never on Vercel or during a build; it can be turned off with SELF_CLOCK=off.
 */

export interface ClockJob {
  /** a short name (logs) */
  name: string;
  /** the route the job calls */
  path: string;
  /** how often, ms */
  everyMs: number;
  /** the first run after start, ms (staggering) */
  firstMs: number;
  /** HTTP method the route accepts */
  method: "GET" | "POST";
  /** how long one call may take, ms */
  timeoutMs: number;
}

const s = 1000;
const m = 60 * s;

/** the background jobs and their pace (the same jobs GitHub / pg_cron call, at a steadier pace) */
export const CLOCK_JOBS: ClockJob[] = [
  { name: "dispatch", path: "/api/jobs/dispatch", everyMs: 1 * m, firstMs: 20 * s, method: "POST", timeoutMs: 70 * s },
  { name: "team", path: "/api/cron/team", everyMs: 1 * m, firstMs: 35 * s, method: "POST", timeoutMs: 75 * s },
  { name: "meta-sync", path: "/api/cron/meta-sync", everyMs: 1 * m, firstMs: 45 * s, method: "POST", timeoutMs: 60 * s },
  { name: "social", path: "/api/cron/social", everyMs: 2 * m, firstMs: 50 * s, method: "POST", timeoutMs: 70 * s },
  { name: "email-poll", path: "/api/channels/email/poll", everyMs: 2 * m, firstMs: 65 * s, method: "POST", timeoutMs: 70 * s },
  { name: "followups", path: "/api/ai/followups", everyMs: 5 * m, firstMs: 80 * s, method: "POST", timeoutMs: 70 * s },
  { name: "growth", path: "/api/cron/growth", everyMs: 5 * m, firstMs: 95 * s, method: "POST", timeoutMs: 70 * s },
  { name: "social-brain", path: "/api/cron/social-brain", everyMs: 5 * m, firstMs: 110 * s, method: "POST", timeoutMs: 75 * s },
  { name: "agents", path: "/api/cron/agents", everyMs: 10 * m, firstMs: 125 * s, method: "POST", timeoutMs: 75 * s },
  { name: "billing-sweep", path: "/api/billing/sweep", everyMs: 60 * m, firstMs: 140 * s, method: "POST", timeoutMs: 70 * s },
  { name: "keepalive", path: "/api/keepalive", everyMs: 6 * 60 * m, firstMs: 155 * s, method: "GET", timeoutMs: 60 * s },
];

export type Env = Record<string, string | undefined>;

/** is this an always-on server where the built-in clock should run? */
export function clockEnabled(env: Env): { on: boolean; reason: string } {
  const flag = (env.SELF_CLOCK ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return { on: false, reason: "turned_off" };
  if (env.VERCEL) return { on: false, reason: "vercel" };
  if (env.NEXT_PHASE === "phase-production-build") return { on: false, reason: "build" };
  if (env.NODE_ENV !== "production" && flag !== "on") return { on: false, reason: "not_production" };
  if (!(env.CRON_SECRET ?? "").trim()) return { on: false, reason: "no_cron_secret" };
  if (flag === "on" || flag === "1" || flag === "true") return { on: true, reason: "forced_on" };
  const railway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_SERVICE_ID || env.RAILWAY_PROJECT_ID);
  return railway ? { on: true, reason: "railway" } : { on: false, reason: "not_always_on" };
}

/** the server's own address (loopback — never leaves the machine, no TLS, no public DNS) */
export function loopbackBase(env: Env): string {
  const port = Number(env.PORT) > 0 ? Number(env.PORT) : 3000;
  return `http://127.0.0.1:${port}`;
}

/** the public address of the app on Railway / elsewhere (for links and the database clock), or null */
export function publicBase(env: Env): string | null {
  const candidates = [env.NEXT_PUBLIC_APP_URL, env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : ""];
  for (const c of candidates) {
    const v = (c ?? "").trim().replace(/\/+$/, "");
    if (/^https:\/\/[^\s/]+/.test(v) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(v)) return v;
  }
  return null;
}

/** the delay before the next run of a job (a failed run is retried sooner, never faster than 30s) */
export function nextDelay(job: ClockJob, ok: boolean): number {
  return ok ? job.everyMs : Math.max(30_000, Math.min(job.everyMs, 2 * 60_000));
}
