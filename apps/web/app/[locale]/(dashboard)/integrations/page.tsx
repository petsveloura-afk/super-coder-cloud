import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Bot, CheckCircle2, CircleDashed, CreditCard, Mail, Plug, Timer, Zap } from "lucide-react";
import { integrationAvailability } from "@scc/shared/env";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ApiDocs, ApiKeys, Webhooks, type ApiKeyRow, type WebhookRow } from "@/components/integrations/developer";
import { UpgradeNote } from "@/components/billing/upgrade-note";
import { orgHasFeature } from "@/lib/billing/features";
import { ChannelsSection } from "@/components/integrations/channels-section";
import { ConnectHub, type HubProps } from "@/components/integrations/connect-hub";
import { ConversionsCard, type ConversionConn } from "@/components/integrations/conversions-card";
import { IntegrationsNotice } from "@/components/integrations/integrations-notice";
import { IntegrationsMarketplace, type MarketProps } from "@/components/integrations/marketplace";
import { WhatsAppConnect } from "@/components/integrations/whatsapp-connect";
import { TeamUpdates, type BusinessView, type RecipientView } from "@/components/integrations/team-updates";
import { metaPublicConfig } from "@/lib/channels/meta";
import { bridgeConfigured } from "@/lib/channels/wa-bridge";
import { mailOAuthConfigured } from "@/lib/channels/oauth-mail";
import { encryptionReady } from "@/lib/channels/secrets";
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

  const hasApiAccess = canApi ? await orgHasFeature(ctx.org.id, "api_access") : false;
  const avail = integrationAvailability(process.env);
  const platform = [
    { icon: Bot, name: t("integrations.platform.ai"), on: avail.anthropic || avail.openai || avail.gemini, hint: t("integrations.platform.aiHint") },
    { icon: Mail, name: t("integrations.platform.email"), on: avail.email, hint: t("integrations.platform.emailHint") },
    { icon: CreditCard, name: t("integrations.platform.payments"), on: avail.payments, hint: t("integrations.platform.paymentsHint") },
    { icon: Timer, name: t("integrations.platform.jobs"), on: Boolean(process.env.CRON_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY), hint: t("integrations.platform.jobsHint") },
  ];
  const baseUrl = publicEnv.appUrl.replace(/\/$/, "");

  // wave 6 — simple connection hub
  const [{ data: chRows }, { data: agentRows }] = await Promise.all([
    supabase.from("channel_accounts").select("kind, name, status, config, last_error").eq("organization_id", ctx.org.id),
    supabase.from("ai_agents").select("name, enabled, autopilot_channels").eq("organization_id", ctx.org.id).order("created_at"),
  ]);
  const ch = (k: string) => ((chRows ?? []) as { kind: string; name: string; status: string; config: Record<string, string>; last_error: string | null }[]).find((r) => r.kind === k);
  const pilot = ((agentRows ?? []) as { name: string; enabled: boolean; autopilot_channels: string[] | null }[]).find((a) => a.enabled && (a.autopilot_channels ?? []).length > 0);
  const wa = ch("whatsapp");
  const qr = ch("whatsapp_qr");
  const tg = ch("telegram");
  const mail = ch("email");
  const tgu = ch("telegram_user");
  const hub: HubProps = {
    orgSlug: ctx.org.slug,
    appUrl: baseUrl,
    agent: { exists: Boolean(pilot), name: pilot?.name ?? null, channels: pilot?.autopilot_channels ?? [] },
    channels: {
      web: { connected: Boolean(pilot?.autopilot_channels?.includes("web")) },
      whatsapp: { connected: Boolean(wa && wa.status !== "disabled"), label: wa ? `${wa.config.display_phone_number ?? ""} ${wa.config.verified_name ? `· ${wa.config.verified_name}` : ""}`.trim() : null, error: wa?.status === "error" ? wa.last_error : null, mode: wa?.config.mode ?? null },
      whatsapp_qr: { connected: qr?.config.state === "connected", label: qr?.config.phone ? `+${qr.config.phone}` : null, error: qr?.status === "error" ? qr.last_error : null },
      telegram: { connected: Boolean(tg && tg.status !== "disabled"), label: tg?.config.username ? `@${tg.config.username}` : null, error: tg?.status === "error" ? tg.last_error : null },
      email: { connected: Boolean(mail && mail.status !== "disabled"), address: mail?.config.address ?? null, auth: mail?.config.auth ?? null, error: mail?.status === "error" ? mail.last_error : null },
      telegram_user: { connected: tgu?.config.state === "connected", label: tgu?.config.username ? `@${tgu.config.username}` : tgu?.config.phone ? `+${tgu.config.phone}` : null, error: tgu?.status === "error" ? tgu.last_error : null },
    },
    meta: metaPublicConfig(),
    bridge: bridgeConfigured(),
    oauth: { google: mailOAuthConfigured("google"), microsoft: mailOAuthConfigured("microsoft") },
    encryption: encryptionReady(),
    canManage: canChannels,
  };

  // wave 10 — team updates + Telegram Business
  const [{ data: recRows }, { data: bizRows }] = canChannels
    ? await Promise.all([
        // wave 15: members' personal channels (user_id) are managed in Settings → "My channels"
        supabase.from("notify_recipients").select("id, kind, target, label, events, enabled, invite_code, last_sent_at, last_error, sent_count").eq("organization_id", ctx.org.id).is("user_id", null).order("created_at"),
        supabase.from("telegram_business_connections").select("id, owner_name, owner_username, can_reply, is_enabled, messages_in, messages_out, last_message_at").eq("organization_id", ctx.org.id).order("updated_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  // wave 16: the AI voice agent answers calls on the Twilio number (Voice webhook)
  let voiceUrl: string | null = null;
  let voiceOn = false;
  if (canChannels && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data: smsAcc } = await createAdminClient().from("channel_accounts").select("webhook_token").eq("organization_id", ctx.org.id).eq("kind", "sms").maybeSingle();
    if (smsAcc?.webhook_token) {
      const { voiceWebhookUrl } = await import("@/lib/voice/agent");
      voiceUrl = voiceWebhookUrl(smsAcc.webhook_token as string);
      voiceOn = await import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "voice_ai"));
    }
  }

  // wave 17
  let conversionConns: Partial<Record<"meta_capi" | "ga4" | "tiktok", ConversionConn>> = {};
  let conversionsOn = false;
  if (canChannels && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { listIntegrations } = await import("@/lib/integrations/store");
    conversionConns = await listIntegrations(ctx.org.id, ["meta_capi", "ga4", "tiktok"]);
    conversionsOn = await orgHasFeature(ctx.org.id, "conversion_api");
  }

  // wave 19 — the integrations marketplace (one-click connections by category)
  let market: MarketProps | null = null;
  if (canChannels) {
    const fb = ch("messenger");
    const ig = ch("instagram");
    const sr = process.env.SUPABASE_SERVICE_ROLE_KEY ? await import("@/lib/supabase/admin").then((m) => m.createAdminClient()) : null;
    const { listIntegrations } = await import("@/lib/integrations/store");
    const ints = sr ? await listIntegrations(ctx.org.id, ["shopify", "woocommerce", "google_business", "morning", "icount", "meta_capi", "ga4", "tiktok", "paypal"]) : {};
    const { storeStats } = await import("@/lib/stores/stats");
    const [shopStats, { data: cal }, { count: hookCount }] = await Promise.all([
      storeStats(ctx.org.id, "shopify"),
      supabase.from("calendar_connections").select("provider, status").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).eq("provider", "google").maybeSingle(),
      canApi ? supabase.from("webhooks").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).or("description.ilike.Zapier%,description.ilike.Make%,description.ilike.REST hook%") : Promise.resolve({ count: 0 }),
    ]);
    const { metaPagesPublicConfig } = await import("@/lib/channels/meta-pages");
    const { googleConfigured } = await import("@/lib/google/connect");
    const { shopifyConfigured } = await import("@/lib/stores/shopify");
    const shop = ints.shopify;
    const woo = ints.woocommerce;
    market = {
      appUrl: baseUrl,
      canManage: canChannels,
      platformAdmin: ctx.isPlatformAdmin,
      metaPages: metaPagesPublicConfig(),
      metaWa: metaPublicConfig(),
      facebook: { connected: Boolean(fb && fb.status !== "disabled"), label: fb?.config.page_name ?? fb?.name ?? null, error: fb?.status === "error" ? fb.last_error : fb?.last_error ?? null },
      instagram: { connected: Boolean(ig && ig.status !== "disabled"), label: ig?.config.username ? `@${ig.config.username}` : null },
      whatsappMode: wa?.config.mode ?? null,
      google: { configured: googleConfigured(), calendar: Boolean(cal && cal.status === "active"), gmail: mail?.config.auth === "google", business: Boolean(ints.google_business && ints.google_business.status === "active"), email: (ints.google_business?.config as { email?: string } | undefined)?.email ?? mail?.config.address ?? null },
      shopify: { configured: shopifyConfigured(), connected: Boolean(shop && shop.status === "active"), shop: (shop?.config as { shop?: string } | undefined)?.shop ?? null, error: shop?.last_error ?? null, orders30: shopStats.orders, revenue30: shopStats.revenue },
      woo: { connected: Boolean(woo && woo.status === "active" && (woo.config as { state?: string }).state === "connected"), origin: (woo?.config as { origin?: string } | undefined)?.origin ?? null, pending: woo?.status === "pending", error: woo?.last_error ?? null },
      zapier: { hooks: hookCount ?? 0, apiAccess: hasApiAccess },
      others: [
        { key: "conversions", connected: Boolean(ints.meta_capi || ints.ga4 || ints.tiktok) },
        { key: "invoicing", connected: Boolean(ints.morning || ints.icount) },
        { key: "payments", connected: Boolean(ints.paypal) },
        { key: "calendar", connected: Boolean(cal) },
        { key: "telegram_business", connected: Boolean((bizRows ?? []).length) },
        { key: "voice", connected: Boolean(voiceUrl) },
      ],
    };
  }

  return (
    <>
      <PageHeader title={t("integrations.title")} description={t("integrations.hubSubtitle")} />
      {/* wave 20: WhatsApp in one button — official (Meta) or straight from the phone (QR / code) */}
      {canChannels ? (
        <WhatsAppConnect
          meta={hub.meta}
          bridge={hub.bridge}
          official={hub.channels.whatsapp}
          quick={hub.channels.whatsapp_qr}
          canManage={canChannels}
          aiOn={hub.agent.channels.includes("whatsapp") || hub.agent.channels.includes("whatsapp_qr")}
          platformAdmin={ctx.isPlatformAdmin}
        />
      ) : null}
      {market ? (
        <Suspense fallback={null}>
          <IntegrationsMarketplace {...market} />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <IntegrationsNotice />
      </Suspense>
      {canChannels ? <ConnectHub {...hub} /> : null}
      {canChannels ? <div id="team-updates" /> : null}
      {canChannels ? <TeamUpdates recipients={(recRows ?? []) as RecipientView[]} business={(bizRows ?? []) as BusinessView[]} botUsername={tg?.config.username || null} /> : null}
      {canChannels && voiceUrl ? (
        <Card className="mb-4" data-testid="voice-card" id="voice">
          <CardHeader title={t("voice.title")} description={t("voice.subtitle")} />
          <div className="space-y-2 p-5 text-[13px]">
            <p className="text-muted">{t("voice.webhookHint")}</p>
            <bdi dir="ltr" className="block break-all rounded-xl border border-line bg-elevated p-2.5 font-mono text-[12px]">
              {voiceUrl}
            </bdi>
            <p className="text-subtle">{t(voiceOn ? "voice.ready" : "plans.locked.voice_ai.title")}</p>
            {/* wave 57: the number is wired automatically; everything about the phone agent in one screen */}
            <p className="text-success">{t("phone.autoWiredNote")}</p>
            <a href={`/${locale}/phone`} className="inline-block font-semibold text-accent hover:underline">
              {t("phone.openHub")}
            </a>
          </div>
        </Card>
      ) : null}

      {/* wave 17: ad conversions (Meta CAPI / GA4 / TikTok) */}
      {canChannels ? <div id="conversions"><ConversionsCard conns={conversionConns} locked={!conversionsOn} /></div> : null}

      {ctx.isPlatformAdmin ? (
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
      ) : null}

      <details className="group mb-4 rounded-2xl border border-line bg-surface" data-testid="advanced-integrations">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4">
          <span>
            <span className="block font-semibold">{t("integrations.advancedTitle")}</span>
            <span className="block text-[12.5px] text-muted">{t("integrations.advancedHint")}</span>
          </span>
          <span className="text-[12.5px] font-medium text-accent group-open:hidden">{t("integrations.advancedOpen")}</span>
        </summary>
        <div className="space-y-4 border-t border-line p-4">
      {canChannels ? <ChannelsSection orgId={ctx.org.id} locale={locale} /> : null}

      {canApi ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card id="api-keys">
            <CardHeader title={t("integrations.apiKeys")} description={t("integrations.apiKeysHint")} />
            <div className="space-y-3 p-4">
              {/* wave 13: API access is part of the Business plan */}
              {hasApiAccess ? null : <UpgradeNote locale={locale} feature="api_access" plan="business" compact />}
              {hasApiAccess || (keysRes.data ?? []).length ? <ApiKeys keys={(keysRes.data ?? []) as ApiKeyRow[]} /> : null}
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
        </div>
      </details>
    </>
  );
}
