import Link from "next/link";
import type { Metadata } from "next";
import { Megaphone, Plus } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("campaigns.title") };
}

const TONE: Record<string, "neutral" | "accent" | "success" | "danger" | "gold"> = { draft: "neutral", scheduled: "gold", sending: "accent", sent: "success", canceled: "danger" };

export default async function CampaignsPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const { data } = await supabase.from("campaigns").select("id, name, channel, status, stats, scheduled_at, launched_at, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false });
  const rows = data ?? [];
  const newLink = (
    <Link href={`/${locale}/campaigns/new`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-medium text-accent-fg hover:bg-accent-solid-hover">
      <Plus className="h-4 w-4" /> {t("campaigns.new")}
    </Link>
  );
  return (
    <>
      <PageHeader title={t("campaigns.title")} description={t("campaigns.subtitle")} actions={newLink} />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Megaphone className="h-6 w-6" />} title={t("campaigns.empty")} body={t("campaigns.emptyBody")} action={newLink} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((c) => {
              const st = (c.stats as { recipients?: number; sent?: number; failed?: number }) ?? {};
              return (
                <li key={c.id}>
                  <Link href={`/${locale}/campaigns/${c.id}`} className="flex flex-col gap-1 px-5 py-4 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4">
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                    <span className="text-[13px] text-muted">{t(`campaigns.channels.${c.channel}`)}</span>
                    <Badge tone={TONE[c.status as string] ?? "neutral"}>{t(`campaigns.statuses.${c.status}`)}</Badge>
                    {st.recipients !== undefined ? (
                      <span className="text-[12.5px] text-muted">{t("campaigns.statsLine", { sent: st.sent ?? 0, total: st.recipients ?? 0, failed: st.failed ?? 0 })}</span>
                    ) : null}
                    <span className="text-[12px] text-subtle">{formatDateTime(locale, (c.launched_at ?? c.scheduled_at ?? c.created_at) as string)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
