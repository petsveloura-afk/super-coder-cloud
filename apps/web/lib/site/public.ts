import "server-only";
import { headers } from "next/headers";
import type { SiteBlock } from "@scc/shared/engagement";
import { createAnonClient } from "@/lib/supabase/anon";

export interface PublicSite {
  name: string;
  slug?: string;
  theme: { accent?: string; mode?: "dark" | "light"; template?: string; accent2?: string; font?: string; radius?: string; animations?: boolean };
  seo: { title?: string; description?: string };
  blocks: SiteBlock[];
  org: string;
  org_slug: string;
  // wave 13
  settings?: Record<string, unknown> | null;
  pages?: Record<string, string> | null;
  custom_domain?: string | null;
  branding?: boolean;
}

/** wave 13: the richer read (settings, legal pages, domain, branding); falls back to the original one */
export async function loadPublicSite(slug: string): Promise<PublicSite | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return null;
  const anon = createAnonClient();
  const v2 = await anon.rpc("get_public_site_v2", { p_slug: slug });
  if (!v2.error) return (v2.data as PublicSite | null) ?? null;
  const { data } = await anon.rpc("get_public_site", { p_slug: slug });
  return (data as PublicSite | null) ?? null;
}

/** "" on a custom domain / subdomain (set by the proxy), otherwise /{locale}/s/{slug} */
export async function siteBasePath(locale: string, slug: string): Promise<string> {
  const h = await headers();
  return h.get("x-scc-site-host") ? "" : `/${locale}/s/${slug}`;
}
