import { CLOCK_JOBS, clockEnabled, loopbackBase, nextDelay, publicBase, type ClockJob } from "./self-clock-core";

/**
 * The built-in clock (see self-clock-core). Started once from instrumentation.ts when the server boots.
 *
 * It also re-points the database clock (Supabase pg_cron → the app's public address) once per boot, so after moving the
 * app to a new address (Vercel → Railway, a new domain) the database stops calling the old address by itself. That step
 * uses the existing, idempotent functions schedule_platform_jobs / schedule_team_job / schedule_meta_inbound_sync, and is
 * skipped when SELF_CLOCK_DB=off or when no public https address is known.
 */

const g = globalThis as unknown as { __sccClock?: { started: boolean; running: Set<string>; last: Record<string, { at: string; ok: boolean; status: number | null }> } };

export function clockState() {
  return g.__sccClock ?? { started: false, running: new Set<string>(), last: {} };
}

async function callJob(base: string, job: ClockJob, secret: string): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(`${base}${job.path}`, {
      method: job.method,
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-scc-clock": "1" },
      body: job.method === "POST" ? "{}" : undefined,
      signal: AbortSignal.timeout(job.timeoutMs),
      cache: "no-store",
      redirect: "manual",
    });
    // 503 = "not configured" (e.g. no service key) — not a failure of the clock itself
    return { ok: res.ok || res.status === 503, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

async function repointDatabaseClock(secret: string): Promise<void> {
  if ((process.env.SELF_CLOCK_DB ?? "").trim().toLowerCase() === "off") return;
  const site = publicBase(process.env);
  if (!site || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const calls: [string, Record<string, string>][] = [
      ["schedule_platform_jobs", { p_site_url: site, p_cron_secret: secret }],
      ["schedule_team_job", { p_site_url: site, p_cron_secret: secret }],
      ["schedule_meta_inbound_sync", { p_site_url: site, p_cron_secret: secret }],
    ];
    for (const [fn, args] of calls) {
      const { data, error } = await admin.rpc(fn, args);
      // never print the secret — only the function, the address and the outcome
      console.info("self-clock: database clock", fn, site, error ? `skipped (${error.message.slice(0, 120)})` : String(data ?? "ok").slice(0, 120));
    }
  } catch (e) {
    console.warn("self-clock: database clock not updated", (e as Error).message.slice(0, 160));
  }
}

export function startSelfClock(): void {
  const st = clockEnabled(process.env);
  if (!st.on) {
    console.info("self-clock: off", st.reason);
    return;
  }
  if (g.__sccClock?.started) return;
  g.__sccClock = { started: true, running: new Set<string>(), last: {} };
  const state = g.__sccClock;
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const base = loopbackBase(process.env);
  console.info("self-clock: on", st.reason, `${CLOCK_JOBS.length} jobs via ${base}`);

  const schedule = (job: ClockJob, delay: number) => {
    const t = setTimeout(async () => {
      if (state.running.has(job.name)) return schedule(job, job.everyMs);
      state.running.add(job.name);
      let ok = false;
      try {
        const r = await callJob(base, job, secret);
        ok = r.ok;
        state.last[job.name] = { at: new Date().toISOString(), ok: r.ok, status: r.status };
        if (!r.ok) console.warn("self-clock:", job.name, "HTTP", r.status ?? "no answer");
      } finally {
        state.running.delete(job.name);
        schedule(job, nextDelay(job, ok));
      }
    }, delay);
    // never keeps the process alive on its own (a clean shutdown is not blocked by the clock)
    (t as unknown as { unref?: () => void }).unref?.();
  };
  for (const job of CLOCK_JOBS) schedule(job, job.firstMs);
  // the database clock follows the app's public address (once per boot, a little after start)
  const t = setTimeout(() => void repointDatabaseClock(secret), 30_000);
  (t as unknown as { unref?: () => void }).unref?.();
}
