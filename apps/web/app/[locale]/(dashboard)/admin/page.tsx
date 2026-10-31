import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Building2, Contact, Cpu, Inbox, ListX, MessagesSquare, Users } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { FlagToggle, NewFlagForm, PlanControl } from "@/components/admin/admin-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatNumber } from "@/lib/format";
import { AdminPayments } from "@/components/admin/admin-payments";
import { AiHealth } from "@/components/admin/ai-health";
import { AdminDomains } from "@/components/admin/admin-domains";
import { AdminOverrides } from "@/components/admin/admin-growth";
import { SpeedCard } from "@/components/admin/speed-card";
import { PlatformSetup } from "@/components/admin/platform-setup";
import { setupSteps, voiceSetupSteps } from "@/lib/admin/setup-core";
import { AdminPhones } from "@/components/admin/admin-phones";
import { publicEnv } from "@/lib/env";
import { providerKeys, ROUTE_PROVIDERS } from "@/lib/ai/router-core";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("admin.title"), robots: { index: false } };
}

interface Overview {
  organizations: number;
  users: number;
  new_orgs_30d: number;
  contacts: number;
  plans: Record<string, number>;
  ai_credits_30d: number;
  jobs_dead: number;
  jobs_queued: number;
  messages_30d: number;
}

export default async function AdminPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  // Not advertised to non-admins: behave like an unknown page.
  if (!ctx.isPlatformAdmin) notFound();
  const { t } = await getT(locale);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const page = Math.max(0, Number.parseInt(String(sp.page ?? "0"), 10) || 0);
  const supabase = await createClient();
  const [{ data: ov }, { data: orgs }, { data: flags }, aiUsageRes] = await Promise.all([
    supabase.rpc("platform_overview"),
    supabase.rpc("platform_organizations", { p_search: q || null, p_limit: 50, p_offset: page * 50 }),
    supabase.rpc("platform_flags"),
    // wave 18: AI usage per organization (last 30 days)
    supabase.rpc("platform_ai_usage", { p_days: 30, p_limit: 30 }),
  ]);
  const aiUsage = (aiUsageRes.error ? [] : (aiUsageRes.data ?? [])) as { organization_id: string; name: string; plan: string; credits: number; calls: number; errors: number; input_tokens: number; output_tokens: number; pack_balance: number; monthly_limit: number | null; top_feature: string | null }[];
  const o = (ov ?? {}) as Overview;
  const orgRows = (orgs ?? []) as { id: string; name: string; slug: string; plan: string; is_demo: boolean; created_at: string; members: number; contacts: number; owner_email: string | null }[];
  const flagRows = (flags ?? []) as { key: string; organization_id: string | null; organization_name: string | null; enabled: boolean }[];
  const kpis: [string, number, typeof Users][] = [
    ["admin.kpiOrgs", o.organizations ?? 0, Building2],
    ["admin.kpiUsers", o.users ?? 0, Users],
    ["admin.kpiNewOrgs", o.new_orgs_30d ?? 0, Building2],
    ["admin.kpiContacts", o.contacts ?? 0, Contact],
    ["admin.kpiAi", o.ai_credits_30d ?? 0, Cpu],
    ["admin.kpiMessages", o.messages_30d ?? 0, MessagesSquare],
    ["admin.kpiQueued", o.jobs_queued ?? 0, Inbox],
    ["admin.kpiDead", o.jobs_dead ?? 0, ListX],
  ];

  return (
    <>
      <PageHeader title={t("admin.title")} description={t("admin.subtitle")} />
      {/* wave 20: the platform's one-time setup — after it, every business connects in one click */}
      {/* wave 57: + the agents' voice and phone numbers for every business (set once by the platform owner) */}
      <PlatformSetup steps={setupSteps(process.env, publicEnv.appUrl)} extra={voiceSetupSteps(process.env, publicEnv.appUrl)} />
      <AdminPhones orgs={orgRows.map((o) => ({ id: o.id, name: o.name, plan: o.plan }))} />
      <AiHealth configured={Object.fromEntries(ROUTE_PROVIDERS.map((p) => [p, providerKeys(p, process.env).length]))} />
      <SpeedCard locale={locale} />
      <AdminPayments locale={locale} />
      <AdminDomains locale={locale} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([k, n, Icon]) => (
          <Card key={k} className="p-4">
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Icon className="h-4 w-4" /> {t(k)}
            </p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${k === "admin.kpiDead" && n > 0 ? "text-danger" : ""}`} data-kpi={k}>
              {formatNumber(locale, Number(n))}
            </p>
          </Card>
        ))}
      </div>
      <AdminOverrides />
      <Card className="mb-4 overflow-hidden" data-testid="admin-ai-usage">
        <div className="border-b border-line p-4">
          <h2 className="font-semibold">{t("admin.aiUsageTitle")}</h2>
          <p className="text-[12.5px] text-muted">{t("admin.aiUsageHint")}</p>
        </div>
        {aiUsage.length === 0 ? (
          <p className="p-4 text-[13px] text-subtle">{t("analytics.noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-start font-medium">{t("admin.org")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("admin.aiCredits")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("admin.aiCalls")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("admin.aiErrors")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("admin.aiTokens")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("admin.aiLimit")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("admin.aiPacks")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("admin.aiTop")}</th>
                </tr>
              </thead>
              <tbody>
                {aiUsage.map((u) => (
                  <tr key={u.organization_id} className="border-b border-line/60">
                    <td className="px-4 py-2">
                      {u.name} <span className="text-[12px] text-subtle">({u.plan})</span>
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums">{formatNumber(locale, Number(u.credits))}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{formatNumber(locale, Number(u.calls))}</td>
                    <td className={`px-4 py-2 text-end tabular-nums ${Number(u.errors) > 0 ? "text-danger" : ""}`}>{formatNumber(locale, Number(u.errors))}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{formatNumber(locale, Number(u.input_tokens) + Number(u.output_tokens))}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{u.monthly_limit === null ? "∞" : formatNumber(locale, Number(u.monthly_limit))}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{formatNumber(locale, Number(u.pack_balance))}</td>
                    <td className="px-4 py-2 text-[12.5px]" dir="ltr">
                      {u.top_feature ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="mb-4 flex flex-wrap gap-2 p-4 text-[13px]">
        <span className="text-muted">{t("admin.plans")}:</span>
        {Object.entries(o.plans ?? {}).map(([p, n]) => (
          <Badge key={p} tone="neutral">
            {p}: {n}
          </Badge>
        ))}
      </Card>

      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold">{t("admin.organizations")}</h2>
          <form className="flex gap-2" action={`/${locale}/admin`}>
            <input name="q" defaultValue={q} placeholder={t("common.search")} aria-label={t("common.search")} className="h-9 rounded-xl border border-line bg-surface px-3 text-sm" />
            <button type="submit" className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover">
              {t("common.search")}
            </button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-[12.5px] text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-start font-medium">{t("admin.org")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.owner")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("admin.members")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("admin.contacts")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.created")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.plan")}</th>
              </tr>
            </thead>
            <tbody>
              {orgRows.map((r) => (
                <tr key={r.id} className="border-b border-line/60" data-admin-org={r.slug}>
                  <td className="px-4 py-2">
                    <p className="font-medium">
                      {r.name} {r.is_demo ? <Badge tone="gold">{t("common.demo")}</Badge> : null}
                    </p>
                    <p dir="ltr" className="text-[12px] text-subtle">
                      {r.slug}
                    </p>
                  </td>
                  <td className="px-4 py-2 text-[13px]" dir="ltr">
                    {r.owner_email ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums">{Number(r.members)}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{Number(r.contacts)}</td>
                  <td className="px-4 py-2 text-[13px]">{formatDate(locale, r.created_at)}</td>
                  <td className="px-4 py-2">
                    <PlanControl orgId={r.id} plan={r.plan} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between p-3 text-sm">
          {page > 0 ? (
            <Link href={`/${locale}/admin?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`} className="text-accent hover:underline">
              {t("common.previous")}
            </Link>
          ) : (
            <span />
          )}
          {orgRows.length === 50 ? (
            <Link href={`/${locale}/admin?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`} className="text-accent hover:underline">
              {t("common.next")}
            </Link>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-line p-4">
          <h2 className="font-semibold">{t("admin.flags")}</h2>
          <p className="text-[13px] text-muted">{t("admin.flagsHint")}</p>
          <NewFlagForm orgs={orgRows.map((r) => ({ id: r.id, name: r.name }))} />
        </div>
        {flagRows.length === 0 ? (
          <p className="p-4 text-[13px] text-subtle">{t("admin.noFlags")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {flagRows.map((f) => (
              <li key={`${f.key}-${f.organization_id ?? "global"}`} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-flag={f.key}>
                <code dir="ltr" className="font-medium">
                  {f.key}
                </code>
                <span className="text-[12.5px] text-muted">{f.organization_name ?? t("admin.global")}</span>
                <span className="flex-1" />
                <Badge tone={f.enabled ? "success" : "neutral"}>{t(f.enabled ? "admin.on" : "admin.off")}</Badge>
                <FlagToggle flagKey={f.key} orgId={f.organization_id} enabled={f.enabled} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
