import "server-only";
import { createClient } from "@/lib/supabase/server";
import { emailConfigured } from "@/lib/email/send";

/** Which campaign channels can actually send for this workspace. */
export async function channelsReady(orgId: string): Promise<Record<string, boolean>> {
  const supabase = await createClient();
  const { data } = await supabase.from("channel_accounts").select("kind, status").eq("organization_id", orgId);
  const ready: Record<string, boolean> = { email: emailConfigured() };
  for (const r of data ?? []) ready[r.kind as string] = r.status !== "disabled";
  return ready;
}
