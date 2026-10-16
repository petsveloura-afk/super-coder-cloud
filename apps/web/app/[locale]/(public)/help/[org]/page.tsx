import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NewTicketForm } from "@/components/public/support-portal";
import { createAnonClient } from "@/lib/supabase/anon";
import { getT, resolveLocale } from "@/lib/i18n/server";

type Params = Promise<{ locale: string; org: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("support.portalTitle"), robots: { index: false } };
}

export default async function HelpPage({ params }: { params: Params }) {
  await resolveLocale(params);
  const { org } = await params;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(org)) notFound();
  // Organization name for the header (public, non-sensitive); unknown slugs 404.
  const { data } = await createAnonClient().rpc("public_org_name", { p_slug: org });
  if (!data) notFound();
  return <NewTicketForm org={org} orgName={data as string} />;
}
