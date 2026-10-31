import "server-only";

/**
 * Wave 59 — background steps (run inside the growth cron, each with its own budget; a failure in one never
 * stops the others): weekly AI coach, connection health alerts, automatic reminder / follow-up calls,
 * expiry of unanswered review questions.
 */
export function wave59Steps(): [string, () => Promise<Record<string, unknown>>][] {
  return [
    [
      "coach",
      async () => {
        const { runWeeklyCoach } = await import("@/lib/ai/coach");
        return { ...(await runWeeklyCoach(1, 9_000)) };
      },
    ],
    [
      "channelHealth",
      async () => {
        const { runChannelHealthAlerts } = await import("@/lib/channels/health");
        return { ...(await runChannelHealthAlerts(30, 5_000)) };
      },
    ],
    [
      "outboundCalls",
      async () => {
        const { runOutboundCalls } = await import("@/lib/voice/outbound");
        return { ...(await runOutboundCalls(8_000)) };
      },
    ],
    [
      "reviewGates",
      async () => {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const { GATE_DAYS } = await import("@/lib/agents/review-gate-core");
        const { error, count } = await createAdminClient()
          .from("review_gates")
          .update({ status: "expired" }, { count: "exact" })
          .eq("status", "asked")
          .lt("created_at", new Date(Date.now() - GATE_DAYS * 86_400_000).toISOString());
        return error ? { skipped: true } : { expired: count ?? 0 };
      },
    ],
  ];
}
