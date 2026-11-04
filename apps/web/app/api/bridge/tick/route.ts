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
// the AI team and the AI agents run in their own lane so a long team run never delays a customer's answer
let teamLaneRunning = false;
let lastWatchdog = 0;
let lastTeam = 0;
let lastAgents = 0;

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
      // stuck chats (no answer for minutes) are retried and then handed to a person — every minute, not only when GitHub wakes up
      if (Date.now() - lastWatchdog > 55_000) {
        lastWatchdog = Date.now();
        await import("@/lib/ai/watchdog").then((m) => m.runStuckWatchdog(12_000)).catch((e) => console.error("tick: watchdog failed", (e as Error).message));
      }
    } finally {
      running = false;
    }
  });
  // AI team clock + AI agents: GitHub's schedule alone left them asleep for long stretches, so the heartbeat drives them too
  // (same database lock as the cron routes — a heartbeat run and a cron run never overlap)
  if (!teamLaneRunning) {
    teamLaneRunning = true;
    after(async () => {
      try {
        const { runLockedJob } = await import("@/lib/ops/job-runs");
        if (Date.now() - lastTeam > 55_000) {
          lastTeam = Date.now();
          await runLockedJob("team", async () => {
            const { teamTick } = await import("@/lib/team/runner");
            return teamTick(30_000);
          }).catch((e) => console.error("tick: team clock failed", (e as Error).message));
        }
        if (Date.now() - lastAgents > 115_000) {
          lastAgents = Date.now();
          await runLockedJob("agents", async () => {
            const { runAgentsCron } = await import("@/lib/agents/run");
            return runAgentsCron(25_000);
          }).catch((e) => console.error("tick: agents failed", (e as Error).message));
        }
      } finally {
        teamLaneRunning = false;
      }
    });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
