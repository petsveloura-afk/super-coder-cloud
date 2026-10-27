import type { createClient } from "@/lib/supabase/server";
import { dbErrorKey } from "@/lib/action-state";

/**
 * Wave 32 — one place that makes a DRAFT copy of a site (content, design, settings, legal pages —
 * never the visits, leads or publish state). Used by "duplicate" and by the bulk actions.
 */
type Db = Awaited<ReturnType<typeof createClient>>;

export async function cloneSiteDraft(db: Db, o: { orgId: string; userId: string; locale: string; id: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: src } = await db.from("sites").select("name, slug, theme, seo, blocks, settings, pages").eq("id", o.id).eq("organization_id", o.orgId).maybeSingle();
  if (!src) return { ok: false, error: "errors.notFound" };
  const word = o.locale === "he" ? "עותק" : o.locale === "ar" ? "نسخة" : "copy";
  const base = String(src.slug).replace(/-copy-[a-z0-9]{4}$/, "").slice(0, 50);
  for (let i = 0; i < 4; i++) {
    const slug = `${base}-copy-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await db
      .from("sites")
      .insert({
        organization_id: o.orgId,
        created_by: o.userId,
        name: `${String(src.name)} (${word})`.slice(0, 120),
        slug,
        status: "draft",
        theme: src.theme,
        seo: src.seo,
        blocks: src.blocks,
        ...(src.settings ? { settings: src.settings } : {}),
        ...(src.pages ? { pages: src.pages } : {}),
        published_at: null,
      })
      .select("id")
      .single();
    if (!error && data) return { ok: true, id: data.id as string };
    if (error?.code !== "23505") return { ok: false, error: dbErrorKey(error!) };
  }
  return { ok: false, error: "websites.slugTaken" };
}
