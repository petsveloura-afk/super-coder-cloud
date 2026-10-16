import Link from "next/link";
import type { Metadata } from "next";
import { Bell } from "lucide-react";
import type { AuditLogRow } from "@scc/database";
import { Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { OrgSettingsForm, ProfileForm } from "@/components/settings/settings-forms";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { auditLabel } from "@/lib/i18n/translate";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { markNotificationsReadAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("settings.title") };
}

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
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
    ctx.can("audit.read")
      ? supabase
          .from("audit_logs")
          .select("id, action, entity_type, created_at")
          .eq("organization_id", ctx.org.id)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: null }),
  ]);
  const org = orgRes.data ?? { name: ctx.org.name, timezone: "Asia/Jerusalem", currency: "ILS", locale: "he" };
  const notifications = (notifRes.data ?? []) as { id: string; title_key: string; params: Record<string, string>; created_at: string; read_at: string | null; link?: string | null }[];
  const audit = auditRes.data as Pick<AuditLogRow, "id" | "action" | "entity_type" | "created_at">[] | null;

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
        ) : null}
      </div>
    </>
  );
}
