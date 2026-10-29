import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** One row per Meta webhook outcome (no message text). Best-effort: logging must never break the webhook. */
export async function logMetaWebhook(status: "received" | "bad_signature" | "no_account" | "error", o: { object?: string | null; entry?: string | null; detail?: string | null } = {}): Promise<void> {
  try {
    await createAdminClient().from("meta_webhook_events").insert({ status, object: o.object ?? null, entry_id: o.entry ?? null, detail: (o.detail ?? "").slice(0, 300) || null });
  } catch {
    /* the table may not exist yet (migration not applied) */
  }
}

export async function purgeMetaWebhookLog(days = 3): Promise<void> {
  try {
    await createAdminClient().from("meta_webhook_events").delete().lt("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
  } catch {
    /* ignore */
  }
}
