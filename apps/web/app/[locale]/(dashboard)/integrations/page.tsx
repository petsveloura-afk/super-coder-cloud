import Link from "next/link";
import type { Metadata } from "next";
import { Bot, CheckCircle2, CircleDashed, CreditCard, Mail, Plug, Timer, Zap } from "lucide-react";
import { integrationAvailability } from "@scc/shared/env";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ApiDocs, ApiKeys, Webhooks, type ApiKeyRow, type WebhookRow } from "@/components/integrations/developer";
import { ChannelsSection } from "@/components/integrations/channels-section";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("integrations.title") };
}

export default async function IntegrationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const canApi = ctx.can("api.manage");
  const canChannels = ctx.can("integrations.manage");
  if (!canApi && !canChannels) {
    return (
      <Card>
        <EmptyState icon={<Plug className="h-6 w-6" />} title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const [keysRes, hooksRes, deliveriesRes, inboundRes] = await Promise.all([
    canApi ? supabase.from("api_keys").select("id, name, prefix, scopes, last_used_at, revoked_at, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    canApi ? supabase.from("webhooks").select("id, url, description, events, secret, enabled, last_status, last_delivery_at, failure_count").eq("organization_id", ctx.org.id).order("created_at") : Promise.resolve({ data: [] }),
    canApi ? supabase.from("jobs").select("id, webhook_id, status, response_status, created_at, last_error").eq("organization_id", ctx.org.id).not("webhook_id", "is", null).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    ctx.can("automations.manage") ? supabase.from("automations").select("id, name, enabled").eq("organization_id", ctx.org.id).eq("trigger_type", "webhook.inbound") : Promise.resolve({ data: [] }),
  ]);

  const avail = integrationAvailability(process.env);
  const platform = [
    { icon: Bot, name: t("integrations.platform.ai"), on: avail.anthropic || avail.openai, hint: t("integrations.platform.aiHint") },
    { icon: Mail, name: t("integrations.platform.email"), on: avail.email, hint: t("integrations.platform.emailHint") },
    { icon: CreditCard, name: t("integrations.platform.payments"), on: avail.payments, hint: t("integrations.platform.paymentsHint") },
    { icon: Timer, name: t("integrations.platform.jobs"), on: Boolean(process.env.CRON_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY), hint: t("integrations.platform.jobsHint") },
  ];
  const baseUrl = publicEnv.appUrl.replace(/\/$/, "");

  return (
    <>
      <PageHeader title={t("integrations.title")} description={t("integrations.subtitle")} />

      <Card className="mb-4">
        <CardHeader title={t("integrations.platformTitle")} description={t("integrations.platformHint")} />
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {platform.map((p) => (
            <li key={p.name} className="flex items-start gap-3 rounded-xl border border-line p-4">
              <p.icon className="mt-0.5 h-5 w-5 text-accent" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-semibold">
                  {p.name}
                  {p.on ? <CheckCircle2 className="h-4 w-4 text-success" aria-label={t("integrations.connected")} /> : <CircleDashed className="h-4 w-4 text-subtle" aria-label={t("integrations.notConnected")} />}
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted">{p.on ? t("integrations.connected") : p.hint}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {canChannels ? <ChannelsSection orgId={ctx.org.id} locale={locale} /> : null}

      {canApi ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title={t("integrations.apiKeys")} description={t("integrations.apiKeysHint")} />
            <div className="p-4">
              <ApiKeys keys={(keysRes.data ?? []) as ApiKeyRow[]} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t("integrations.webhooks")} description={t("integrations.webhooksHint")} />
            <div className="p-4">
              <Webhooks hooks={(hooksRes.data ?? []) as WebhookRow[]} deliveries={(deliveriesRes.data ?? []) as never} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t("integrations.inbound")} description={t("integrations.inboundHint")} />
            <div className="space-y-2 p-4 text-sm">
              {(inboundRes.data ?? []).length === 0 ? (
                <p className="text-subtle">{t("integrations.noInbound")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {(inboundRes.data ?? []).map((a) => (
                    <li key={a.id as string}>
                      <Link href={`/${locale}/automations/${a.id}`} className="flex items-center gap-2 hover:text-accent">
                        <Zap className="h-4 w-4 text-gold" /> {a.name as string}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/${locale}/automations/new?recipe=inboundLead`} className="inline-block text-accent hover:underline">
                {t("integrations.createInbound")}
              </Link>
            </div>
          </Card>
          <Card>
            <CardHeader title={t("integrations.apiDocs")} />
            <div className="p-4">
              <ApiDocs baseUrl={baseUrl} />
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
