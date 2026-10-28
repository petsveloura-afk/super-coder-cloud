import Link from "next/link";
import type { Metadata } from "next";
import { Megaphone, Plus } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { campaignRates, isStatusFilter, summarizeCampaigns, CAMPAIGN_STATUS_FILTERS } from "@/lib/campaigns/metrics";
import { cn } from "@/lib/utils";
import { CampaignOverview } from "@/components/campaigns/campaign-overview";
import { CampaignAgent } from "@/components/campaigns/campaign-agent";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("campaigns.title") };
}

const TONE: Record<string, "neutral" | "accent" | "success" | "danger" | "gold"> = { draft: "neutral", scheduled: "gold", sending: "accent", sent: "success", canceled: "danger" };

export default async function CampaignsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams?: Promise<{ status?: string; channel?: string; q?: string }> }) {
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
  const all = data ?? [];
  // wave 26: filters (status / channel / free text) + a performance summary over all campaigns
  const sp = (await searchParams) ?? {};
  const statusF = isStatusFilter(sp.status) ? sp.status : "all";
  const channelF = typeof sp.channel === "string" && sp.channel ? sp.channel : "all";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const rows = all.filter((c) => (statusF === "all" || c.status === statusF) && (channelF === "all" || c.channel === channelF) && (!q || String(c.name).toLowerCase().includes(q)));
  const sum = summarizeCampaigns(all.map((c) => ({ status: c.status as string, channel: c.channel as string, stats: c.stats as never })));
  const channelsUsed = [...new Set(all.map((c) => c.channel as string))];
  const href = (over: Record<string, string>) => {
    const u = new URLSearchParams();
    const cur: Record<string, string> = { status: statusF, channel: channelF, q, ...over };
    for (const [k, v] of Object.entries(cur)) if (v && v !== "all") u.set(k, v);
    const qs = u.toString();
    return `/${locale}/campaigns${qs ? `?${qs}` : ""}`;
  };
  const newLink = (
    <Link href={`/${locale}/campaigns/new`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-medium text-accent-fg hover:bg-accent-solid-hover">
      <Plus className="h-4 w-4" /> {t("campaigns.new")}
    </Link>
  );
  return (
    <>
      <PageHeader title={t("campaigns.title")} description={t("campaigns.subtitle")} actions={newLink} />
      {ctx.can("ai.use") ? <CampaignAgent compact /> : null}
      {all.length > 0 ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="campaign-kpis">
            {[
              { label: t("campaigns.kpi.total"), value: formatNumber(locale, sum.total), hint: t("campaigns.kpi.drafts", { count: sum.drafts }) },
              { label: t("campaigns.kpi.sent"), value: formatNumber(locale, sum.sent), hint: t("campaigns.kpi.recipients", { count: formatNumber(locale, sum.recipients) }) },
              { label: t("campaigns.kpi.delivery"), value: formatPercent(locale, sum.deliveryRate), hint: t("campaigns.kpi.failed", { count: sum.failed }) },
              { label: t("campaigns.kpi.active"), value: formatNumber(locale, sum.active), hint: t("campaigns.kpi.activeHint") },
            ].map((k) => (
              <Card key={k.label} className="p-4">
                <div className="text-[12.5px] text-muted">{k.label}</div>
                <div className="mt-1 text-2xl font-bold">{k.value}</div>
                <div className="mt-0.5 text-[11.5px] text-subtle">{k.hint}</div>
              </Card>
            ))}
          </div>
          <CampaignOverview rows={all.map((c) => ({ status: c.status as string, channel: c.channel as string, stats: c.stats as never, launched_at: c.launched_at as string | null, scheduled_at: c.scheduled_at as string | null, created_at: c.created_at as string }))} t={t} locale={locale} />
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="campaign-filters">
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {CAMPAIGN_STATUS_FILTERS.map((s) => (
                <Link key={s} href={href({ status: s })} role="tab" aria-selected={statusF === s} className={cn("rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition", statusF === s ? "border-transparent bg-accent-solid text-accent-fg" : "border-line text-muted hover:bg-surface-hover")}>
                  {s === "all" ? t("campaigns.filters.all") : t(`campaigns.statuses.${s}`)}
                  <span className="ms-1.5 text-[11px] opacity-70">{s === "all" ? all.length : all.filter((c) => c.status === s).length}</span>
                </Link>
              ))}
            </div>
            <form action={`/${locale}/campaigns`} method="get" className="ms-auto flex flex-wrap items-center gap-2">
              {statusF !== "all" ? <input type="hidden" name="status" value={statusF} /> : null}
              <select name="channel" defaultValue={channelF} aria-label={t("campaigns.channel")} className="h-9 rounded-xl border border-line bg-surface px-3 text-[13px]">
                <option value="all">{t("campaigns.filters.allChannels")}</option>
                {channelsUsed.map((c) => (
                  <option key={c} value={c}>
                    {t(`campaigns.channels.${c}`)}
                  </option>
                ))}
              </select>
              <input name="q" defaultValue={q} placeholder={t("campaigns.filters.search")} aria-label={t("campaigns.filters.search")} className="h-9 w-44 rounded-xl border border-line bg-surface px-3 text-[13px]" />
              <button type="submit" className="h-9 rounded-xl border border-line px-3 text-[13px] font-medium hover:bg-surface-hover">
                {t("campaigns.filters.apply")}
              </button>
            </form>
          </div>
        </>
      ) : null}
      {all.length > 0 && rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">{t("campaigns.filters.none")}</Card>
      ) : rows.length === 0 ? (
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
                    {st.recipients ? (
                      <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-hover sm:block" aria-hidden>
                        <span className="block h-full rounded-full bg-accent-solid" style={{ width: `${Math.round(campaignRates(st).progress * 100)}%` }} />
                      </span>
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
