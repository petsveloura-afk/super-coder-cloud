import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ArticleDialog, KbList, type ArticleRow } from "@/components/support/kb-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("kb.title") };
}

/** Wave 16 — knowledge base: public help-center articles + what the AI agent answers from. */
export default async function KnowledgeBasePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("tickets.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.from("kb_articles").select("id, title, body, category, published, views, helpful").eq("organization_id", ctx.org.id).order("category", { nullsFirst: false }).order("position").order("title").limit(500);
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  return (
    <>
      <Link href={`/${locale}/support`} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("support.title")}
      </Link>
      <PageHeader
        title={t("kb.title")}
        description={t("kb.subtitle")}
        actions={
          <>
            <Link href={`/${locale}/help/${ctx.org.slug}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-hover">
              <ExternalLink className="h-4 w-4" /> {t("kb.openPublic")}
            </Link>
            {ctx.can("tickets.write") ? <ArticleDialog /> : null}
          </>
        }
      />
      <Card>
        <CardHeader title={t("kb.articles", { count: (data ?? []).length })} description={t("kb.aiHint")} />
        <KbList articles={(data ?? []) as ArticleRow[]} canWrite={ctx.can("tickets.write")} />
      </Card>
    </>
  );
}
