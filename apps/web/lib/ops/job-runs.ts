import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { countItems } from "./job-runs-core";

/**
 * Cron governance (spec A4): every scheduled route records its run in job_runs (start, finish, items, error)
 * and a job never runs twice at the same time (database lock). Unauthorised calls are passed straight to the
 * route (which answers 401) and are not recorded. A run that died is considered stale after 2 minutes.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function cronRoute(name: string, handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => {
    if (!authorized(request) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return handler(request);
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data: runId, error: startError } = await admin.rpc("start_job_run", { p_name: name, p_stale_minutes: 2 });
    // table not there yet (migration pending) → run exactly as before
    if (startError) return handler(request);
    if (!runId) return Response.json({ ok: true, skipped: "already_running", job: name }, { headers: { "Cache-Control": "no-store" } });
    try {
      const res = await handler(request);
      let items = 0;
      let failed: string | null = null;
      try {
        const body = (await res.clone().json()) as Record<string, unknown>;
        items = countItems(body);
        if (body && typeof body === "object" && "error" in body && typeof body.error === "string") failed = body.error;
      } catch {
        /* non-JSON answer */
      }
      await admin.rpc("finish_job_run", { p_id: runId, p_status: res.ok && !failed ? "ok" : "error", p_items: items, p_error: failed ?? (res.ok ? null : `HTTP ${res.status}`), p_details: {} });
      return res;
    } catch (e) {
      await admin.rpc("finish_job_run", { p_id: runId, p_status: "error", p_items: 0, p_error: (e as Error).message.slice(0, 900), p_details: {} });
      const { captureError } = await import("./log");
      await captureError(e, { source: "job", route: `cron:${name}` });
      throw e;
    }
  };
}

/**
 * Runs `fn` under the same database lock as the cron route of the same name (job_runs), so a heartbeat run and a
 * GitHub/cron run of the same job never overlap. Recorded like any other run. When the lock table is not there
 * yet (migration pending) the job simply runs. Returns null when the job is already running elsewhere.
 */
export async function runLockedJob<T>(name: string, fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ran: false };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: runId, error: startError } = await admin.rpc("start_job_run", { p_name: name, p_stale_minutes: 2 });
  if (startError) return { ran: true, result: await fn() };
  if (!runId) return { ran: false };
  try {
    const result = await fn();
    await admin.rpc("finish_job_run", { p_id: runId, p_status: "ok", p_items: countItems((result ?? {}) as Record<string, unknown>), p_error: null, p_details: {} });
    return { ran: true, result };
  } catch (e) {
    await admin.rpc("finish_job_run", { p_id: runId, p_status: "error", p_items: 0, p_error: (e as Error).message.slice(0, 900), p_details: {} });
    throw e;
  }
}
