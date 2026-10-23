import "server-only";
import type { SiteBlock } from "@scc/shared/engagement";
import { createAdminClient } from "@/lib/supabase/admin";
import { abWinner, applyVariant, type AbStats, type SiteAb } from "./ab-core";

/**
 * Wave 17 — the A/B winner is applied automatically (cron): when one hero variant
 * converts clearly better (95%, both variants ≥ min_views visitors), the site keeps the
 * winner, the test stops and the team gets a notification.
 */
export async function decideAbTests(limit = 30): Promise<{ checked: number; decided: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { checked: 0, decided: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin.from("sites").select("id, organization_id, name, blocks, ab").not("ab", "is", null).limit(limit);
  if (error) return { checked: 0, decided: 0 };
  let decided = 0;
  let checked = 0;
  for (const s of (data ?? []) as { id: string; organization_id: string; name: string; blocks: SiteBlock[]; ab: SiteAb }[]) {
    if (!s.ab?.active || s.ab.winner) continue;
    checked++;
    const { data: st } = await admin.rpc("site_ab_stats", { p_site: s.id });
    const stats = (st ?? { a_views: 0, b_views: 0, a_conv: 0, b_conv: 0 }) as AbStats;
    const w = abWinner(stats, Math.max(30, Number(s.ab.min_views) || 100));
    if (!w) continue;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { ab: { ...s.ab, active: false, winner: w, decided_at: now, final: stats } };
    if (w === "b") patch.blocks = applyVariant(s.blocks ?? [], s.ab, "b");
    const { error: e2 } = await admin.from("sites").update(patch).eq("id", s.id).eq("organization_id", s.organization_id);
    if (e2) continue;
    decided++;
    const { data: admins } = await admin.from("organization_members").select("user_id").eq("organization_id", s.organization_id).in("role", ["agency_owner", "owner", "admin"]).limit(10);
    if (admins?.length) {
      await admin.from("notifications").insert(
        (admins as { user_id: string }[]).map((m) => ({
          organization_id: s.organization_id,
          user_id: m.user_id,
          kind: "site",
          title_key: "abtest.decidedNotification",
          params: { site: s.name, winner: w.toUpperCase() },
          link: `/websites/${s.id}`,
        })),
      );
    }
  }
  return { checked, decided };
}
