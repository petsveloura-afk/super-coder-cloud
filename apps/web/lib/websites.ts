import "server-only";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

/** Active forms + booking pages of the org, for site blocks that embed them. */
export async function siteEmbedOptions(orgId: string) {
  const supabase = await createClient();
  const [{ data: forms }, { data: bookings }] = await Promise.all([
    supabase.from("forms").select("slug, name").eq("organization_id", orgId).eq("status", "active").order("name").limit(200),
    supabase.from("appointment_types").select("slug, name").eq("organization_id", orgId).eq("status", "active").order("name").limit(200),
  ]);
  return {
    forms: (forms ?? []).map((f) => ({ slug: f.slug as string, name: f.name as string })),
    bookings: (bookings ?? []).map((b) => ({ slug: b.slug as string, name: b.name as string })),
  };
}

export function sitePublicBase(locale: string) {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/s`;
}
