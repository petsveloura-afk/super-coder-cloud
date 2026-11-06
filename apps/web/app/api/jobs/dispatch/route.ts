import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchJobs } from "@/lib/jobs/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never open: dispatching requires the shared secret
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET|POST /api/jobs/dispatch — sweep the automation/webhook job queue.
 * Called by Vercel Cron (daily), the GitHub "jobs" workflow (every 5 minutes)
 * and right after user actions (kickJobs). Requires Bearer CRON_SECRET.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const summary = await dispatchJobs({ limit: 25, budgetMs: 40_000 });
  // never-lost team alerts: also from the scheduled sweep (the bridge heartbeat may be down — e.g. while the bridge reconnects)
  const alerts = await import("@/lib/notify/forward")
    .then(async (m) => ({ retry: await m.retryNotifyDeliveries(6_000), catchUp: await m.catchUpMissedAlerts(6_000) }))
    .catch(() => null);
  return NextResponse.json({ ok: true, ...summary, alerts }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
