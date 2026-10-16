import Link from "next/link";
import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { CalendarClock, Clock, MapPin, User } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AppointmentStatusButtons, BookingTypeCard, NewAppointmentButton, NewBookingTypeButton, type TypeValue } from "@/components/appointments/appointments-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { contactOptions, memberOptions } from "@/lib/lookups";
import { publicEnv } from "@/lib/env";
import { cn } from "@/lib/utils";
import { LOCALE_META } from "@/lib/i18n/config";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("appointments.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS = ["upcoming", "past", "pages"] as const;
const TONE: Record<string, "accent" | "success" | "neutral" | "danger" | "warning"> = { scheduled: "accent", confirmed: "success", completed: "neutral", canceled: "danger", no_show: "warning" };

export default async function AppointmentsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("appointments.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as (typeof TABS)[number]) : "upcoming";
  const canManage = ctx.can("appointments.manage");
  const supabase = await createClient();
  const now = new Date();
  const [members, contacts] = await Promise.all([memberOptions(ctx.org.id), contactOptions(ctx.org.id)]);
  const memberName = new Map(members.map((m) => [m.id, m.label]));
  const contactName = new Map(contacts.map((c) => [c.id, c.label]));
  const intl = LOCALE_META[locale].intl;

  let body: React.ReactNode = null;
  if (tab === "pages") {
    const { data: types } = await supabase
      .from("appointment_types")
      .select("id, name, slug, description, duration_min, buffer_min, location, timezone, availability, min_notice_hours, max_days_ahead, status, host_id")
      .eq("organization_id", ctx.org.id)
      .order("created_at");
    body = (
      <Card>
        <CardHeader title={t("booking.pagesTitle")} description={t("booking.pagesHint")} action={canManage ? <NewBookingTypeButton members={members} defaultSlug={`meet-${randomBytes(3).toString("hex")}`} /> : null} />
        {(types ?? []).length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={t("booking.noPages")} />
          </div>
        ) : (
          <ul className="grid gap-3 p-4 lg:grid-cols-2">
            {(types ?? []).map((ty) => (
              <li key={ty.id}>
                <BookingTypeCard
                  id={ty.id as string}
                  value={{ ...(ty as unknown as TypeValue), description: (ty.description as string | null) ?? "", location: (ty.location as string | null) ?? "" }}
                  url={`${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/book/${ty.slug}`}
                  members={members}
                  hostId={ty.host_id as string}
                  hostName={memberName.get(ty.host_id as string) ?? "—"}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  } else {
    let q = supabase
      .from("appointments")
      .select("id, title, starts_at, ends_at, status, location, notes, contact_id, host_id")
      .eq("organization_id", ctx.org.id)
      .limit(300);
    q = tab === "upcoming" ? q.gte("ends_at", now.toISOString()).order("starts_at") : q.lt("ends_at", now.toISOString()).order("starts_at", { ascending: false });
    const [{ data }, { data: orgRow }] = await Promise.all([q, supabase.from("organizations").select("timezone").eq("id", ctx.org.id).maybeSingle()]);
    const rows = data ?? [];
    const timeZone = (orgRow?.timezone as string | undefined) || "Asia/Jerusalem";
    const dayFmt = new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", timeZone });
    const timeFmt = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", timeZone });
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = dayFmt.format(new Date(r.starts_at as string));
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    body =
      rows.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={t(tab === "upcoming" ? "appointments.emptyUpcoming" : "appointments.emptyPast")} body={tab === "upcoming" ? t("appointments.emptyHint") : undefined} />
        </Card>
      ) : (
        <div className="space-y-4">
          {Array.from(groups.entries()).map(([day, items]) => (
            <Card key={day}>
              <CardHeader title={day} />
              <ul className="divide-y divide-line">
                {items.map((a) => (
                  <li key={a.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                    <div className="w-28 shrink-0 font-semibold">
                      <bdi dir="ltr">
                        {timeFmt.format(new Date(a.starts_at as string))}–{timeFmt.format(new Date(a.ends_at as string))}
                      </bdi>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{a.title}</span>
                        <Badge tone={TONE[a.status as string] ?? "neutral"}>{t(`appointments.statuses.${a.status}`)}</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] text-muted">
                        {a.contact_id ? (
                          <Link href={`/${locale}/crm/${a.contact_id}`} className="flex items-center gap-1 hover:text-accent">
                            <User className="h-3.5 w-3.5" /> {contactName.get(a.contact_id as string) ?? "—"}
                          </Link>
                        ) : null}
                        {a.host_id ? (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> {memberName.get(a.host_id as string) ?? "—"}
                          </span>
                        ) : null}
                        {a.location ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" /> {a.location}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {canManage ? <AppointmentStatusButtons id={a.id as string} status={a.status as string} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      );
  }

  return (
    <>
      <PageHeader title={t("appointments.title")} description={t("appointments.subtitle")} actions={canManage ? <NewAppointmentButton contacts={contacts} members={members} /> : null} />
      <Card className="mb-4 p-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={t("appointments.title")}>
          {TABS.map((x) => (
            <Link
              key={x}
              href={`/${locale}/appointments${x === "upcoming" ? "" : `?tab=${x}`}`}
              role="tab"
              aria-selected={tab === x}
              className={cn("flex h-9 shrink-0 items-center rounded-xl px-3.5 text-[13px]", tab === x ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg")}
            >
              {t(`appointments.tabs.${x}`)}
            </Link>
          ))}
        </div>
      </Card>
      {body}
    </>
  );
}
