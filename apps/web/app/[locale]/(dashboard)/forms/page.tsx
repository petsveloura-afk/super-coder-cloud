import Link from "next/link";
import type { Metadata } from "next";
import { FileInput, Plus } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("forms.pageTitle") };
}

export default async function FormsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("forms.manage")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.from("forms").select("id, name, slug, status, submission_count, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false });
  const forms = data ?? [];
  const newLink = (
    <Link href={`/${locale}/forms/new`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-medium text-accent-fg hover:bg-accent-solid-hover">
      <Plus className="h-4 w-4" /> {t("forms.new")}
    </Link>
  );
  return (
    <>
      <PageHeader title={t("forms.pageTitle")} description={t("forms.subtitle")} actions={newLink} />
      {forms.length === 0 ? (
        <Card>
          <EmptyState icon={<FileInput className="h-6 w-6" />} title={t("forms.empty")} body={t("forms.emptyBody")} action={newLink} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {forms.map((f) => (
              <li key={f.id}>
                <Link href={`/${locale}/forms/${f.id}`} className="flex flex-col gap-1 px-5 py-4 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4">
                  <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
                  <Badge tone={f.status === "active" ? "success" : "neutral"}>{t(`forms.status.${f.status}`)}</Badge>
                  <span className="text-[13px] text-muted">{t("forms.submissions", { count: formatNumber(locale, Number(f.submission_count)) })}</span>
                  <span className="text-[12px] text-subtle">{formatDate(locale, f.created_at as string)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
