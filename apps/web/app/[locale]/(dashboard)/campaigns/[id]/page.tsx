import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { CampaignEditor, type CampaignValue } from "@/components/campaigns/campaign-editor";
import { CampaignActions } from "@/components/campaigns/campaign-actions";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPercent } from "@/lib/format";
import { campaignRates, isRecipientFilter, RECIPIENT_FILTERS } from "@/lib/campaigns/metrics";
import { cn } from "@/lib/utils";
import { channelsReady } from "@/lib/campaign-channels";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("campaigns.title") };
}

export default async function CampaignPage({ params, searchParams }: { params: Params; searchParams?: Promise<{ r?: string }> }) {
  const locale = await resolveLocale(params);
  const { id: rawId } = await params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("campaigns.manage")) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("campaigns").select("id, name, channel, subject, body, audience, status, scheduled_at, stats, launched_at").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!c) notFound();
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const header = (
    <Link href={`/${locale}/campaigns`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
      <Back className="h-4 w-4" /> {t("campaigns.title")}
    </Link>
  );
  if (c.status === "draft") {
    const [{ data: tags }, ready, tplRes] = await Promise.all([
      supabase.from("tags").select("name").eq("organization_id", ctx.org.id).order("name").limit(500),
      channelsReady(ctx.org.id),
      // wave 17 (separate read: works before the migration too)
      supabase.from("campaigns").select("wa_template").eq("id", id.data).maybeSingle(),
    ]);
    const waTemplate = !tplRes.error ? ((tplRes.data?.wa_template as CampaignValue["wa_template"]) ?? null) : null;
    return (
      <>
        {header}
        <PageHeader title={c.name as string} description={t("campaigns.statuses.draft")} actions={<CampaignActions id={c.id as string} status="draft" />} />
        <CampaignEditor
          id={c.id as string}
          initial={{ name: c.name as string, channel: c.channel as CampaignValue["channel"], subject: (c.subject as string | null) ?? "", body: c.body as string, audience: (c.audience as CampaignValue["audience"]) ?? {}, scheduled_at: (c.scheduled_at as string | null) ?? undefined, wa_template: waTemplate }}
          tags={(tags ?? []).map((x) => x.name as string)}
          channelsReady={ready}
        />
      </>
    );
  }
  const rf = (await searchParams)?.r;
  const recFilter = isRecipientFilter(rf) ? rf : "all";
  let recQuery = supabase
    .from("campaign_recipients")
    .select("id, contact_id, status, error, sent_at, contacts(first_name, last_name, email, phone)")
    .eq("organization_id", ctx.org.id)
    .eq("campaign_id", c.id);
  if (recFilter !== "all") recQuery = recQuery.eq("status", recFilter);
  const [{ data: recipients }, { data: statusRows }] = await Promise.all([
    recQuery.order("sent_at", { ascending: false, nullsFirst: true }).limit(200),
    // wave 26: live breakdown by status (real counts, even while the send is in progress)
    supabase.from("campaign_recipients").select("status").eq("organization_id", ctx.org.id).eq("campaign_id", c.id).limit(20000),
  ]);
  const counts: Record<string, number> = {};
  for (const r of (statusRows ?? []) as { status: string }[]) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const st = (c.stats as { recipients?: number; sent?: number; failed?: number }) ?? {};
  const rates = campaignRates(st);
  return (
    <>
      {header}
      <PageHeader title={c.name as string} description={`${t(`campaigns.channels.${c.channel}`)} · ${t(`campaigns.statuses.${c.status}`)}`} actions={<CampaignActions id={c.id as string} status={c.status as string} />} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: t("campaigns.recipients"), value: st.recipients ?? 0 },
          { label: t("campaigns.sent"), value: st.sent ?? 0 },
          { label: t("campaigns.failed"), value: st.failed ?? 0 },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <div className="text-[12.5px] text-muted">{k.label}</div>
            <div className="mt-1 text-2xl font-bold" data-testid={`stat-${k.label}`}>
              {k.value}
            </div>
          </Card>
        ))}
      </div>
      <Card className="mb-4 p-5" data-testid="campaign-progress">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="font-semibold">{t("campaigns.kpi.delivery")}: {formatPercent(locale, rates.deliveryRate)}</span>
          <span className="text-muted">{t("campaigns.progressLabel", { pct: Math.round(rates.progress * 100) })}</span>
          {rates.failed ? <span className="text-danger">{t("campaigns.failureRate", { pct: Math.round(rates.failureRate * 100) })}</span> : null}
          {rates.pending ? <span className="text-subtle">{t("campaigns.pending", { count: rates.pending })}</span> : null}
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rates.progress * 100)}>
          <span className="block h-full bg-success" style={{ width: `${rates.recipients ? (rates.sent / rates.recipients) * 100 : 0}%` }} />
          <span className="block h-full bg-danger" style={{ width: `${rates.recipients ? (rates.failed / rates.recipients) * 100 : 0}%` }} />
        </div>
      </Card>
      <Card className="mb-4 p-5">
        {c.subject ? <div className="mb-2 font-semibold">{c.subject}</div> : null}
        <p className="whitespace-pre-wrap text-sm text-muted">{c.body}</p>
        {c.scheduled_at ? <p className="mt-3 text-[12.5px] text-subtle">{t("campaigns.scheduledFor", { date: formatDateTime(locale, c.scheduled_at as string) })}</p> : null}
      </Card>
      <Card>
        <CardHeader title={t("campaigns.recipients")} />
        <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3" role="tablist" data-testid="recipient-filters">
          {RECIPIENT_FILTERS.map((f) => (
            <Link key={f} href={f === "all" ? `/${locale}/campaigns/${c.id}` : `/${locale}/campaigns/${c.id}?r=${f}`} role="tab" aria-selected={recFilter === f} className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium transition", recFilter === f ? "border-transparent bg-accent-solid text-accent-fg" : "border-line text-muted hover:bg-surface-hover")}>
              {f === "all" ? t("campaigns.filters.all") : t(`campaigns.recipientStatus.${f}`)}
              <span className="ms-1.5 text-[11px] opacity-70">{f === "all" ? (statusRows ?? []).length : (counts[f] ?? 0)}</span>
            </Link>
          ))}
        </div>
        <ul className="divide-y divide-line">
          {(recipients ?? []).map((r) => {
            const ct = r.contacts as unknown as { first_name: string; last_name: string; email: string | null; phone: string | null } | null;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
                <Link href={`/${locale}/crm/${r.contact_id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                  {ct ? `${ct.first_name} ${ct.last_name}`.trim() : "—"}
                </Link>
                <Badge tone={r.status === "sent" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{t(`campaigns.recipientStatus.${r.status}`)}</Badge>
                {r.error ? <span className="truncate text-[12px] text-danger">{r.error as string}</span> : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
