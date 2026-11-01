import "server-only";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_FACTS, imageSlots, placeImages, usableReviews, type BusinessFacts, type ToolSite } from "./site-tools-core";

/**
 * The site agent's tools — server part: reads the business's real facts and finds free photos.
 * Every tool is best effort and never throws: a missing table / key just means less help, never a failed build.
 */
export async function loadBusinessFacts(orgId: string): Promise<BusinessFacts> {
  const f: BusinessFacts = { ...EMPTY_FACTS, products: [], reviews: [], knowledge: [] };
  try {
    const supabase = await createClient();
    const [org, site, products, reviews, kb, channels] = await Promise.all([
      supabase.from("organizations").select("name, currency").eq("id", orgId).maybeSingle(),
      supabase.from("sites").select("settings").eq("organization_id", orgId).not("settings", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("products").select("name, description, unit_price").eq("organization_id", orgId).eq("active", true).order("created_at").limit(10),
      supabase.from("reviews").select("author, rating, body").eq("organization_id", orgId).gte("rating", 4).order("created_at", { ascending: false }).limit(30),
      supabase.from("kb_articles").select("title, body").eq("organization_id", orgId).eq("published", true).order("position").limit(6),
      supabase.from("channel_accounts").select("kind, config").eq("organization_id", orgId).in("kind", ["messenger", "instagram"]).neq("status", "disabled"),
    ]);
    f.name = (org.data?.name as string | undefined) ?? "";
    f.currency = (org.data?.currency as string | undefined)?.trim() || "ILS";
    const s = ((site.data?.settings ?? {}) as Record<string, unknown>) || {};
    const g = (k: string) => (typeof s[k] === "string" ? (s[k] as string).trim() : "");
    f.phone = g("phone");
    f.email = g("email");
    f.whatsapp = g("whatsapp_button");
    f.address = g("address");
    f.legalName = g("legal_name");
    f.logoUrl = g("logo_url");
    f.tagline = g("tagline");
    f.facebook = g("facebook");
    f.instagram = g("instagram");
    for (const c of (channels.data ?? []) as { kind: string; config: Record<string, string> | null }[]) {
      if (c.kind === "messenger" && !f.facebook && /^\d{3,40}$/.test(c.config?.page_id ?? "")) f.facebook = `https://www.facebook.com/${c.config!.page_id}`;
      if (c.kind === "instagram" && !f.instagram && /^[A-Za-z0-9._]{1,30}$/.test(c.config?.username ?? "")) f.instagram = `https://www.instagram.com/${c.config!.username}`;
    }
    f.products = ((products.data ?? []) as { name: string; description: string | null; unit_price: number | string }[]).map((p) => ({ name: p.name.slice(0, 120), price: Number(p.unit_price) || 0, description: (p.description ?? "").slice(0, 300) }));
    f.reviews = usableReviews((reviews.data ?? []) as { author: string | null; rating: number | null; body: string | null }[]);
    f.knowledge = ((kb.data ?? []) as { title: string; body: string }[]).map((k) => ({ title: k.title.slice(0, 160), body: k.body.replace(/\s+/g, " ").slice(0, 600) })).filter((k) => k.body.length > 20);
  } catch (e) {
    console.error("site facts failed", (e as Error).message);
  }
  return f;
}

/**
 * Free photos for every image slot the site still lacks (Pexels → Pixabay → Openverse, stored in the business's
 * public folder). Runs the slots in parallel within `budgetMs`. Returns the updated site and how many were placed.
 */
export async function freeSiteImages<T extends ToolSite>(orgId: string, site: T, imagePrompt: string, budgetMs = 20_000): Promise<{ site: T; placed: number }> {
  const slots = imageSlots(site, imagePrompt);
  if (!slots.length) return { site, placed: 0 };
  try {
    const { chainFor } = await import("@/lib/social/image-providers-core");
    const after = chainFor(process.env).after.filter((p) => p === "pexels" || p === "pixabay" || p === "openverse");
    if (!after.length) return { site, placed: 0 };
    const { runFreeChain } = await import("@/lib/social/image-providers");
    const deadline = new Promise<null>((r) => setTimeout(() => r(null), budgetMs));
    const jobs = slots.map((slot, i) =>
      Promise.race([
        // vary the query a little so a gallery does not get the same photo six times
        runFreeChain(orgId, i === 0 ? slot.query : `${slot.query} ${["detail", "people", "work", "space", "service", "happy", "close up", "team"][i % 8]}`, "facebook", after, budgetMs - 2_000)
          .then((r) => ({ slot, url: r.url }))
          .catch(() => null),
        deadline,
      ]),
    );
    const found = (await Promise.all(jobs)).filter((x): x is { slot: (typeof slots)[number]; url: string } => Boolean(x));
    return { site: placeImages(site, found), placed: found.length };
  } catch (e) {
    console.error("site free images failed", (e as Error).message);
    return { site, placed: 0 };
  }
}
