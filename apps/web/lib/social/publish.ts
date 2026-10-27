import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccountById } from "./accounts";
import { MAX_PUBLISH_ATTEMPTS, classifyPublishError, publishRetryDelayMs } from "./errors";

/** a post claimed as "publishing" that never finished (function cut off) is put back in the queue after this long */
const STUCK_MS = 10 * 60_000;

/** Wave 19 — scheduled social posts that are due → Facebook Page / Instagram (claimed once). */
export async function publishDuePosts(budgetMs = 20_000): Promise<{ claimed: number; published: number; failed: number; retried: number; recovered: number }> {
  const started = Date.now();
  const admin = createAdminClient();
  // wave 35: nothing stays stuck in "publishing" if a previous run was cut off
  const { data: stuck } = await admin.from("social_posts").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("status", "publishing").lt("updated_at", new Date(Date.now() - STUCK_MS).toISOString()).select("id");
  const recovered = stuck?.length ?? 0;
  const { data, error } = await admin.rpc("claim_due_social_posts", { p_limit: 10 });
  if (error) return { claimed: 0, published: 0, failed: 0, retried: 0, recovered };
  const rows = (data ?? []) as { id: string; organization_id: string; platforms: string[]; body: string; image_url: string | null; results?: Record<string, unknown> | null }[];
  const { publishPost } = await import("@/lib/channels/meta-pages");
  let published = 0;
  let failed = 0;
  let retried = 0;
  for (const p of rows) {
    if (Date.now() - started > budgetMs) {
      await admin.from("social_posts").update({ status: "scheduled" }).eq("id", p.id);
      continue;
    }
    const { data: accs } = await admin.from("channel_accounts").select("id, kind").eq("organization_id", p.organization_id).in("kind", ["messenger", "instagram"]);
    const byKind = new Map(((accs ?? []) as { id: string; kind: string }[]).map((a) => [a.kind, a.id]));
    const results: Record<string, unknown> = {};
    let ok = 0;
    for (const platform of p.platforms as ("facebook" | "instagram")[]) {
      const accId = byKind.get(platform === "instagram" ? "instagram" : "messenger");
      const acc = accId ? await loadAccountById(accId) : null;
      if (!acc?.secrets.page_token) {
        results[platform] = { ok: false, error: "not_connected" };
        continue;
      }
      const r = await publishPost({ platform, pageId: acc.config.page_id ?? "", igId: acc.config.ig_id ?? null, pageToken: acc.secrets.page_token, text: p.body, imageUrl: p.image_url });
      results[platform] = r.ok ? r : { ...r, kind: classifyPublishError(r.error) };
      if (r.ok) ok++;
    }
    const status = ok === p.platforms.length ? "published" : ok > 0 ? "partial" : "failed";
    const attempts = Number((p.results as { _attempts?: number } | null | undefined)?._attempts ?? 0) + 1;
    const failedKinds = Object.values(results).filter((r) => (r as { ok?: boolean }).ok === false).map((r) => (r as { kind?: string }).kind);
    // temporary trouble on every platform → try again in a few minutes (never when something was already posted: no duplicates)
    if (status === "failed" && failedKinds.length > 0 && failedKinds.every((k) => k === "transient") && attempts < MAX_PUBLISH_ATTEMPTS) {
      retried++;
      await admin.from("social_posts").update({ status: "scheduled", scheduled_at: new Date(Date.now() + publishRetryDelayMs(attempts)).toISOString(), results: { ...results, _attempts: attempts }, updated_at: new Date().toISOString() }).eq("id", p.id);
      continue;
    }
    if (ok) published++;
    else failed++;
    await admin.from("social_posts").update({ status, results: { ...results, _attempts: attempts }, updated_at: new Date().toISOString() }).eq("id", p.id);
  }
  return { claimed: rows.length, published, failed, retried, recovered };
}
