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
 * GET|POST /api/cron/social-brain — wave 61: the daily autopilot post, pictures / videos for the planned week,
 * real engagement of published posts and the brain's learning. Each step has its own budget; one failing
 * never stops the others. Bearer CRON_SECRET.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const t0 = Date.now();
  const left = () => 55_000 - (Date.now() - t0);
  const brain = await import("@/lib/social/brain");
  const autopilot = await brain.runSocialAutopilot(42_000).catch((e) => ({ error: (e as Error).message }));
  const media = left() > 22_000 ? await brain.fillPendingMedia(left() - 2_000).catch((e) => ({ error: (e as Error).message })) : { skipped: "time" };
  const metrics = left() > 6_000 ? await brain.syncPostMetrics(Math.min(15_000, left() - 3_000)).catch((e) => ({ error: (e as Error).message })) : { skipped: "time" };
  return NextResponse.json({ ok: true, autopilot, media, metrics }, { headers: { "Cache-Control": "no-store" } });
}

// spec A4: every run is recorded in job_runs and never overlaps itself
const recorded = cronRoute("social-brain", handle);
export const GET = recorded;
export const POST = recorded;
