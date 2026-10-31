import Link from "next/link";
import { UpgradeNote } from "@/components/billing/upgrade-note";
import { orgHasFeature } from "@/lib/billing/features";
import type { Metadata } from "next";
import { Bell } from "lucide-react";
import type { AuditLogRow } from "@scc/database";
import { Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { OrgSettingsForm, ProfileForm } from "@/components/settings/settings-forms";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { auditLabel } from "@/lib/i18n/translate";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { markNotificationsReadAction } from "./actions";
import { ConversationPolicyCard, LeadRoutingCard, MyChannelsCard, type MyChannel } from "@/components/settings/team-plus";
import { memberOptions } from "@/lib/lookups";
import { CalendarCard, type CalendarConn } from "@/components/settings/calendar-card";
import { PushCard } from "@/components/settings/push-card";
import { vapidReady } from "@/lib/push/webpush-core";
import { ProfileProCard, type MyStats } from "@/components/settings/profile-pro";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("settings.title") };
}

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams?: Promise<{ calendar?: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const supabase = await createClient();

  const [orgRes, notifRes, auditRes] = await Promise.all([
    supabase.from("organizations").select("name, timezone, currency, locale").eq("id", ctx.org.id).single(),
    supabase
      .from("notifications")
      .select("id, title_key, params, created_at, read_at, link")
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.can("audit.read") && (await orgHasFeature(ctx.org.id, "audit_log"))
      ? supabase
          .from("audit_logs")
          .select("id, action, entity_type, created_at")
          .eq("organization_id", ctx.org.id)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: null }),
  ]);
  // wave 15 + conversation guard: my channels, availability, lead routing, automated-message rules
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
  const [myRes, botRes, meRes, orgPlusRes, membersAll, availRes, routingOn] = await Promise.all([
    supabase.from("notify_recipients").select("id, kind, target, events, enabled, invite_code, last_error").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).order("created_at"),
    admin ? admin.from("channel_accounts").select("config").eq("organization_id", ctx.org.id).eq("kind", "telegram").maybeSingle() : Promise.resolve({ data: null }),
    admin ? admin.from("organization_members").select("available").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).maybeSingle() : Promise.resolve({ data: null }),
    admin ? admin.from("organizations").select("lead_routing, conversation_policy").eq("id", ctx.org.id).maybeSingle() : Promise.resolve({ data: null }),
    ctx.can("settings.manage") ? memberOptions(ctx.org.id) : Promise.resolve([]),
    admin && ctx.can("settings.manage") ? admin.from("organization_members").select("user_id, available").eq("organization_id", ctx.org.id) : Promise.resolve({ data: [] }),
    orgHasFeature(ctx.org.id, "lead_routing"),
  ]);
  const myChannels = (myRes.error ? [] : (myRes.data ?? [])) as MyChannel[];
  // wave 16: my calendar connections (two-way sync)
  const [calRes, calOn] = await Promise.all([
    supabase.from("calendar_connections").select("id, provider, account_email, push_events, block_busy, status, last_sync_at, last_error").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId),
    orgHasFeature(ctx.org.id, "calendar_sync"),
  ]);
  const { calendarConfigured } = await import("@/lib/calendar/sync");
  const calStatus = (await searchParams)?.calendar ?? null;
  const botUsername = ((botRes.data?.config as { username?: string } | null)?.username as string | undefined) ?? null;
  const iAmAvailable = (meRes.data as { available?: boolean } | null)?.available !== false;
  const availability = new Map(((availRes.data ?? []) as { user_id: string; available: boolean | null }[]).map((r) => [r.user_id, r.available !== false]));
  const routing = ((orgPlusRes.data as { lead_routing?: Record<string, unknown> } | null)?.lead_routing ?? {}) as { mode?: string; members?: string[]; contacts?: boolean; conversations?: boolean };
  const policy = ((orgPlusRes.data as { conversation_policy?: Record<string, unknown> } | null)?.conversation_policy ?? {}) as Record<string, unknown>;

  const org = orgRes.data ?? { name: ctx.org.name, timezone: "Asia/Jerusalem", currency: "ILS", locale: "he" };
  const notifications = (notifRes.data ?? []) as { id: string; title_key: string; params: Record<string, string>; created_at: string; read_at: string | null; link?: string | null }[];
  const audit = auditRes.data as Pick<AuditLogRow, "id" | "action" | "entity_type" | "created_at">[] | null;
  // wave 52 — personal profile pro: extra fields (tolerant before the migration runs) + my week
  const nowIso = new Date().toISOString();
  const [proRes, myOpenTasks, myOverdue, myDeals, myConvs] = await Promise.all([
    supabase.from("profiles").select("avatar_url, job_title, phone, bio").eq("id", ctx.userId).maybeSingle(),
    ctx.can("tasks.read") ? supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("assignee_id", ctx.userId).in("status", ["open", "in_progress"]) : Promise.resolve({ count: null }),
    ctx.can("tasks.read") ? supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("assignee_id", ctx.userId).in("status", ["open", "in_progress"]).lt("due_at", nowIso) : Promise.resolve({ count: null }),
    ctx.can("deals.read") ? supabase.from("deals").select("value").eq("organization_id", ctx.org.id).eq("owner_id", ctx.userId).eq("status", "open").limit(1000) : Promise.resolve({ data: null }),
    ctx.can("inbox.read") ? supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("assignee_id", ctx.userId).eq("status", "open") : Promise.resolve({ count: null }),
  ]);
  const pro = (proRes.error ? null : proRes.data) as { avatar_url: string | null; job_title: string | null; phone: string | null; bio: string | null } | null;
  const dealRows = ((myDeals as { data: { value: number | string }[] | null }).data ?? []) as { value: number | string }[];
  const myStats: MyStats = {
    openTasks: (myOpenTasks as { count: number | null }).count ?? 0,
    overdueTasks: (myOverdue as { count: number | null }).count ?? 0,
    openDeals: dealRows.length,
    openDealsValue: formatCurrency(locale, dealRows.reduce((sum, d) => sum + Number(d.value ?? 0), 0), (org as { currency?: string }).currency || "ILS"),
    myConversations: (myConvs as { count: number | null }).count ?? 0,
  };

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("settings.organization")} />
          <div className="p-5">
            <OrgSettingsForm org={org} readOnly={!ctx.can("org.update")} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("settings.profile")} />
          <div className="p-5">
            <ProfileForm fullName={ctx.profile?.full_name ?? ""} preferredLocale={ctx.profile?.locale ?? locale} />
          </div>
        </Card>
        {/* wave 52 — personal profile pro */}
        <Card id="my-profile" className="scroll-mt-24 xl:col-span-2">
          <CardHeader title={t("settings.pro.title")} description={t("settings.pro.subtitle")} />
          <ProfileProCard
            name={ctx.profile?.full_name ?? ""}
            email={ctx.email}
            role={t(`team.roles.${ctx.role}`)}
            avatarUrl={pro?.avatar_url ?? null}
            jobTitle={pro?.job_title ?? ""}
            phone={pro?.phone ?? ""}
            bio={pro?.bio ?? ""}
            stats={myStats}
          />
        </Card>

        <Card id="my-channels" className="scroll-mt-24">
          <CardHeader title={t("myChannels.title")} description={t("myChannels.subtitle")} />
          <MyChannelsCard channels={myChannels} botUsername={botUsername} available={iAmAvailable} />
        </Card>
        {/* wave 17: notifications on this phone / computer */}
        {/* wave 59: anchor for "phone notifications" links (quick start, guide) */}
        <div id="push" className="scroll-mt-20">
          <PushCard vapidKey={vapidReady() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null} />
        </div>
        <Card id="calendar" className="scroll-mt-24">
          <CardHeader title={t("calendar.title")} description={t("calendar.subtitle")} />
          <CalendarCard
            connections={(calRes.error ? [] : (calRes.data ?? [])) as CalendarConn[]}
            configured={{ google: calendarConfigured("google"), microsoft: calendarConfigured("microsoft") }}
            locked={!calOn}
            status={calStatus && /^(connected|failed|cancelled|forbidden|not_configured)$/.test(calStatus) ? calStatus : null}
          />
        </Card>
        {ctx.can("settings.manage") ? (
          <Card id="routing" className="scroll-mt-24">
            <CardHeader title={t("routing.title")} description={t("routing.subtitle")} />
            <LeadRoutingCard routing={routing} members={(membersAll as { id: string; label: string }[]).map((m) => ({ ...m, available: availability.get(m.id) ?? true }))} locked={!routingOn} />
          </Card>
        ) : null}
        {ctx.can("settings.manage") ? (
          <Card id="conversation-policy" className="scroll-mt-24">
            <CardHeader title={t("guard.policyTitle")} description={t("guard.policySubtitle")} />
            <ConversationPolicyCard policy={policy} />
          </Card>
        ) : null}

        <Card id="notifications" className="scroll-mt-24">
          <CardHeader
            title={t("common.notifications")}
            action={
              notifications.some((n) => !n.read_at) ? (
                <form action={markNotificationsReadAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <Button type="submit" size="sm" variant="ghost">✓</Button>
                </form>
              ) : null
            }
          />
          {notifications.length === 0 ? (
            <EmptyState icon={<Bell className="h-6 w-6" />} title={t("common.noNotifications")} />
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map((n) => (
                <li key={n.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  {!n.read_at ? <span className="h-2 w-2 rounded-full bg-accent" /> : <span className="h-2 w-2" />}
                  {n.link && /^\/[a-z]/.test(n.link) ? (
                    <Link href={`/${locale}${n.link}`} className="flex-1 hover:text-accent hover:underline">
                      {t(n.title_key, n.params)}
                    </Link>
                  ) : (
                    <span className="flex-1">{t(n.title_key, n.params)}</span>
                  )}
                  <span className="text-[12px] text-subtle">{formatDateTime(locale, n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {audit ? (
          <Card>
            <CardHeader title={t("settings.auditLog")} />
            {audit.length === 0 ? (
              <p className="p-5 text-sm text-subtle">{t("settings.auditEmpty")}</p>
            ) : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto" tabIndex={0} aria-label={t("settings.auditLog")}>
                {audit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate text-[13px] text-muted" title={a.action}>{auditLabel(t, a.action)}</span>
                    <span className="shrink-0 text-[12px] text-subtle">{formatDateTime(locale, a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : ctx.can("audit.read") ? (
          <Card>
            <CardHeader title={t("settings.auditLog")} />
            <div className="p-4">
              {/* wave 13: the audit log is part of the Pro plan and up */}
              <UpgradeNote locale={locale} feature="audit_log" plan="pro" compact />
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
