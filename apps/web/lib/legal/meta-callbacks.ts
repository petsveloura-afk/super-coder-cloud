import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Meta callbacks (Facebook Login for Business and Instagram Login): a person removed the app or asked to delete their data.
 * The id Meta sends is the person's id FOR THIS APP. With Instagram Login it is the Instagram account we stored (ig_id /
 * ig_app_id) — that connection is removed (data deletion) or switched off (deauthorize). A Facebook person's id is not
 * stored by the platform (Pages are), so their request is recorded and handled by the team within 30 days.
 * Every request is written to the audit log.
 */
export async function handleMetaUserRemoval(kind: "deletion" | "deauthorize", userId: string, code: string | null): Promise<{ accounts: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { accounts: 0 };
  const admin = createAdminClient();
  const id = String(userId).replace(/[^0-9]/g, "").slice(0, 40);
  if (!id) return { accounts: 0 };
  const { data } = await admin.from("channel_accounts").select("id, organization_id, kind, config").eq("kind", "instagram").or(`config->>ig_id.eq.${id},config->>ig_app_id.eq.${id}`).limit(20);
  const rows = (data ?? []) as { id: string; organization_id: string; kind: string; config: Record<string, string> | null }[];
  for (const r of rows) {
    if (kind === "deletion") await admin.from("channel_accounts").delete().eq("id", r.id);
    else await admin.from("channel_accounts").update({ status: "disabled", last_error: "deauthorized: the account owner removed the app in Instagram / Facebook — connect again to resume", updated_at: new Date().toISOString() }).eq("id", r.id);
    await admin
      .from("audit_logs")
      .insert({ organization_id: r.organization_id, action: kind === "deletion" ? "meta.data_deletion" : "meta.deauthorize", entity_type: "channel_account", metadata: { channel: r.kind, username: r.config?.username ?? null, code } })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  if (!rows.length) {
    await admin
      .from("audit_logs")
      .insert({ organization_id: null, action: kind === "deletion" ? "meta.data_deletion" : "meta.deauthorize", entity_type: "meta_user", metadata: { meta_user_id: id, code, matched: 0 } })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  return { accounts: rows.length };
}
