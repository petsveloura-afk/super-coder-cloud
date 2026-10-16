import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sealSecrets } from "./secrets";
import type { MailboxConfig } from "./email";

/**
 * Stores (or replaces) the workspace's mailbox — one e-mail channel per workspace.
 * Runs with the signed-in user's session, so RLS (integrations.manage) applies.
 */
export async function saveMailbox(input: {
  orgId: string;
  userId: string;
  config: MailboxConfig;
  secrets: Record<string, string>;
  uidValidity?: string;
  lastUid?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const config = {
    ...input.config,
    imap_port: String(input.config.imap_port),
    smtp_port: String(input.config.smtp_port),
    uid_validity: input.uidValidity ?? "",
    last_uid: String(input.lastUid ?? 0),
    last_poll_at: new Date().toISOString(),
  };
  const row = {
    config,
    secret_enc: sealSecrets(input.secrets),
    status: "active",
    last_error: null,
    name: input.config.address,
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase.from("channel_accounts").select("id").eq("organization_id", input.orgId).eq("kind", "email").maybeSingle();
  const { error } = existing
    ? await supabase.from("channel_accounts").update(row).eq("id", existing.id).eq("organization_id", input.orgId)
    : await supabase.from("channel_accounts").insert({ ...row, organization_id: input.orgId, kind: "email", created_by: input.userId });
  return error ? { ok: false, error: error.message } : { ok: true };
}
