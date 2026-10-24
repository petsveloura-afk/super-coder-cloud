import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { verifyBridgeSignature } from "@/lib/channels/wa-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/bridge/tick — wave 21: a reliable heartbeat from the always-on WhatsApp bridge
 * (every 30s, signed with WA_BRIDGE_SECRET — no extra setup). GitHub's scheduled runs can be
 * hours late, so this is what makes sure:
 *   • a customer who got "on it…" while the AI was busy gets the real answer within ~30 seconds,
 *   • automations, e-mails and webhooks queued as jobs go out,
 *   • planned follow-ups / scheduled messages that are due are sent.
 * One run at a time per server instance; each part has its own small time budget.
 */
let running = false;
let lastSchedules = 0;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyBridgeSignature(raw, request.headers.get("x-scc-timestamp"), request.headers.get("x-scc-signature"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  if (running) return NextResponse.json({ ok: true, skipped: "busy" });
  running = true;
  after(async () => {
    try {
      const { runPendingReplies } = await import("@/lib/ai/autopilot");
      await runPendingReplies(20_000).catch((e) => console.error("tick: pending replies failed", (e as Error).message));
      const { dispatchJobs } = await import("@/lib/jobs/dispatch");
      await dispatchJobs({ limit: 20, budgetMs: 10_000 }).catch((e) => console.error("tick: jobs failed", (e as Error).message));
      // scheduled messages / planned follow-ups: at most once a minute
      if (Date.now() - lastSchedules > 55_000) {
        lastSchedules = Date.now();
        await import("@/lib/conversations/scheduler").then((m) => m.runDueSchedules(10_000)).catch(() => null);
      }
    } finally {
      running = false;
    }
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
