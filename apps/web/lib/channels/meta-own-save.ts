import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MetaPage } from "./meta-pages";

/**
 * Stores a Page (+ its Instagram) connected through the business's OWN Meta app — the same rows as the one-click
 * connection (kind messenger / instagram), marked mode "own_app" with the app id, so the inbox, the comments board,
 * the social autopilot and the 1-minute sync work exactly the same.
 */
export async function saveOwnPage(orgId: string, userId: string, page: MetaPage, appId: string): Promise<{ ok: boolean; error?: string; both: boolean }> {
  const { sealSecrets } = await import("./secrets");
  const { subscribePage } = await import("./meta-pages");
  const sub = await subscribePage(page.id, page.token);
  const supabase = await createClient();
  const upsert = async (kind: "messenger" | "instagram", config: Record<string, string>, name: string) => {
    const row = { config, secret_enc: sealSecrets({ page_token: page.token }), status: "active", last_error: sub.ok ? null : `subscribe: ${sub.error ?? ""}`.slice(0, 500), name: name.slice(0, 120), updated_at: new Date().toISOString() };
    const { data: existing } = await supabase.from("channel_accounts").select("id").eq("organization_id", orgId).eq("kind", kind).maybeSingle();
    return existing
      ? supabase.from("channel_accounts").update(row).eq("id", existing.id).eq("organization_id", orgId)
      : supabase.from("channel_accounts").insert({ ...row, organization_id: orgId, kind, created_by: userId });
  };
  const m = await upsert("messenger", { page_id: page.id, page_name: page.name, mode: "own_app", own_app_id: appId }, page.name || "Messenger");
  if (m.error) return { ok: false, error: m.error.message, both: false };
  if (page.instagram) {
    const ig = await upsert("instagram", { ig_id: page.instagram.id, username: page.instagram.username ?? "", page_id: page.id, mode: "own_app", own_app_id: appId }, page.instagram.username ? `@${page.instagram.username}` : "Instagram");
    if (ig.error) return { ok: false, error: ig.error.message, both: false };
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await createAdminClient().from("meta_own_apps").update({ status: "connected", last_error: null, updated_at: new Date().toISOString() }).eq("organization_id", orgId);
  }
  return { ok: true, both: Boolean(page.instagram) };
}
