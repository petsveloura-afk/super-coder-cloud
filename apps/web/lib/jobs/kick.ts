import "server-only";
import { after } from "next/server";
import { dispatchJobs } from "./dispatch";

/**
 * Runs the job dispatcher right after the response is sent (Next.js `after`),
 * so e-mails / webhooks queued by automations go out within seconds instead of
 * waiting for the next scheduled sweep. No-op without the service role key.
 */
export function kickJobs() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    after(async () => {
      try {
        await dispatchJobs({ limit: 20, budgetMs: 8_000 });
      } catch (e) {
        console.error("job dispatch failed", (e as Error).message);
      }
    });
  } catch {
    // outside a request scope (e.g. tests) — the scheduled sweep will pick the jobs up
  }
}
