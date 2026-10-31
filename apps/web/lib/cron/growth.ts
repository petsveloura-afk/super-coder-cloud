import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Waves 15-18 — background work run every few minutes (GitHub Actions → /api/cron/growth):
 * each step has its own budget and never blocks the others.
 */
export type StepResult = Record<string, unknown> | { error: string };

async function step(name: string, out: Record<string, StepResult>, fn: () => Promise<Record<string, unknown>>) {
  try {
    out[name] = await fn();
  } catch (e) {
    console.error(`growth step ${name} failed`, (e as Error).message);
    out[name] = { error: (e as Error).message.slice(0, 200) };
  }
}

export async function runGrowthCron(): Promise<Record<string, StepResult>> {
  const out: Record<string, StepResult> = {};
  const cronStart = Date.now(); // wave 59: later steps only start while there is time left
  const admin = createAdminClient();
  // conversation guard: planned follow-ups and scheduled messages
  await step("schedules", out, async () => {
    const { runDueSchedules } = await import("@/lib/conversations/scheduler");
    return { ...(await runDueSchedules(15_000)) };
  });
  // wave 15
  await step("taskReminders", out, async () => {
    const { runTaskReminders } = await import("@/lib/tasks/reminders");
    return { ...(await runTaskReminders(15_000)) };
  });
  await step("identities", out, async () => {
    const { data } = await admin.rpc("auto_merge_channel_duplicates", { p_limit: 50 });
    return { merged: Number(data ?? 0) };
  });
  await step("scores", out, async () => {
    const { data } = await admin.rpc("refresh_stale_scores", { p_limit: 300 });
    return { scored: Number(data ?? 0) };
  });
  // waves 16-18 register more steps here
  const { moreGrowthSteps } = await import("./growth-more");
  for (const [name, fn] of moreGrowthSteps()) await step(name, out, fn);
  // wave 59: weekly coach, connection health, outbound calls, review questions
  const { wave59Steps } = await import("./wave59");
  for (const [name, fn] of wave59Steps()) {
    if (Date.now() - cronStart > 40_000) {
      out[name] = { skipped: "time" };
      continue;
    }
    await step(name, out, fn);
  }
  return out;
}
