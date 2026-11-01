import { NextResponse, type NextRequest } from "next/server";
import { cronRoute } from "@/lib/ops/job-runs";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET|POST /api/cron/team — the digital team's clock: for every business whose team is ON (flag team_v1 + settings,
 * no emergency stop) it runs the tasks that are ready (dependencies done), the daily initiative scan and the weekly
 * team meeting. Businesses without the team are skipped at once. Bearer CRON_SECRET.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const { teamTick } = await import("@/lib/team/runner");
  const team = await teamTick(50_000).catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json({ ok: true, team }, { headers: { "Cache-Control": "no-store" } });
}

// every run is recorded in job_runs and never overlaps itself
const recorded = cronRoute("team", handle);
export const GET = recorded;
export const POST = recorded;
