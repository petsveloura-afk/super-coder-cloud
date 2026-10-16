import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CampaignEditor } from "@/components/campaigns/campaign-editor";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { channelsReady } from "@/lib/campaign-channels";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("campaigns.new") };
}

export default async function NewCampaignPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("campaigns.manage")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const [{ data: tags }, ready] = await Promise.all([supabase.from("tags").select("name").eq("organization_id", ctx.org.id).order("name").limit(500), channelsReady(ctx.org.id)]);
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  return (
    <>
      <Link href={`/${locale}/campaigns`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("campaigns.title")}
      </Link>
      <PageHeader title={t("campaigns.new")} description={t("campaigns.newHint")} />
      <CampaignEditor initial={{ name: "", channel: "email", subject: "", body: "", audience: {} }} tags={(tags ?? []).map((x) => x.name as string)} channelsReady={ready} />
    </>
  );
}
