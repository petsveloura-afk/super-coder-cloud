import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /api/cron/team-task {org, task} — runs ONE digital-team task in its own server call with a full time budget. It answers
 * at once with 202 {accepted: true} (the caller knows for sure the work started here) and does the work right after the answer,
 * inside this call's time limit. Bearer CRON_SECRET. The task is claimed atomically (pending → in progress) — never runs twice.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: unknown; task?: unknown };
  const org = String(body.org ?? "");
  const task = String(body.task ?? "");
  if (!UUID.test(org) || !UUID.test(task)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  after(async () => {
    const { runTask } = await import("@/lib/team/runner");
    const r = await runTask(org, task, { interactive: false, actorUser: null, deadlineAt: started + 52_000 }).catch((e: Error) => ({ notRun: `error: ${e.message.slice(0, 200)}` }));
    // one line in the server log per run (what happened to the task) — visible in Vercel → Logs
    console.info("team-task", task, "notRun" in r ? `not run: ${r.notRun}` : r.status);
  });
  return NextResponse.json({ ok: true, accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
