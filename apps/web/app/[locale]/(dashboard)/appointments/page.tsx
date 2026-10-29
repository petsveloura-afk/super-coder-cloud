import Link from "next/link";
import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { Activity, CalendarCheck, CalendarClock, CalendarDays, Clock, Hourglass, MapPin, Search, Timer, User, UserX, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select } from "@/components/ui/primitives";
import { AppointmentStatusButtons, BookingTypeCard, NewAppointmentButton, NewBookingTypeButton, type TypeValue } from "@/components/appointments/appointments-client";
import { AddToCalendar, CopyDetails, JoinButton, NextMeetingBanner, NotesButton, RescheduleButton } from "@/components/appointments/pro";
import { MonthGrid, TimeGrid, type CalEvent } from "@/components/appointments/calendar-views";
import { Heatmap, StatusDonut, WeeklyTrend } from "@/components/appointments/insights-charts";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { contactOptions, memberOptions } from "@/lib/lookups";
import { publicEnv } from "@/lib/env";
import { cn } from "@/lib/utils";
import { LOCALE_META } from "@/lib/i18n/config";
import { formatNumber, formatPercent } from "@/lib/format";
import { ScreenPulse } from "@/components/ui/screen-pulse";
import { appointmentsPulse } from "@/lib/insights/screens-core";
import {
  addDays,
  addMonths,
  computeApptStats,
  dayKeyOf,
  detectJoinLink,
  isDayKey,
  minutesOfDay,
  monthGrid,
  monthOfKey,
  paddedRange,
  relativeTime,
  safeZone,
  startOfWeekKey,
  zonedParts,
  type ApptRow,
} from "@/lib/appointments/insights";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("appointments.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS = ["upcoming", "calendar", "past", "pages", "insights"] as const;
const VIEWS = ["week", "month", "day"] as const;
const STATUSES = ["scheduled", "confirmed", "completed", "canceled", "no_show"] as const;
const TONE: Record<string, "accent" | "success" | "neutral" | "danger" | "warning"> = { scheduled: "accent", confirmed: "success", completed: "neutral", canceled: "danger", no_show: "warning" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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

  // organisation time zone + a 6-month window used by the KPI strip and the insights tab
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const until = new Date(now.getTime() + 90 * 86_400_000).toISOString();
  const [{ data: orgRow }, { data: statData }, upcomingCount] = await Promise.all([
    supabase.from("organizations").select("timezone").eq("id", ctx.org.id).maybeSingle(),
    supabase
      .from("appointments")
      .select("id, title, starts_at, ends_at, status, host_id, type_id, contact_id, created_at")
      .eq("organization_id", ctx.org.id)
      .gte("starts_at", since)
      .lte("starts_at", until)
      .order("starts_at")
      .limit(2000),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).in("status", ["scheduled", "confirmed"]).gte("ends_at", now.toISOString()),
  ]);
  const timeZone = safeZone((orgRow?.timezone as string | undefined) || "Asia/Jerusalem");
  const statRows = (statData ?? []) as unknown as ApptRow[];
  const todayKey = dayKeyOf(now, timeZone);
  const weekStart = startOfWeekKey(todayKey);
  const weekEnd = addDays(weekStart, 6);
  const isActive = (s: string) => s === "scheduled" || s === "confirmed";
  const todayCount = statRows.filter((r) => r.status !== "canceled" && dayKeyOf(r.starts_at, timeZone) === todayKey).length;
  const weekCount = statRows.filter((r) => r.status !== "canceled" && (() => { const k = dayKeyOf(r.starts_at, timeZone); return k >= weekStart && k <= weekEnd; })()).length;
  const past90 = computeApptStats(statRows.filter((r) => new Date(r.starts_at) <= now), timeZone, now);
  // wave 53 — smart tips: no-shows in the last 30 days and whether a booking page exists
  const since30 = now.getTime() - 30 * 86_400_000;
  const last30 = statRows.filter((r) => new Date(r.starts_at).getTime() >= since30 && new Date(r.starts_at) <= now);
  const { count: typesCount } = await supabase.from("appointment_types").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id);
  const apptPulse = appointmentsPulse({ today: todayCount, week: weekCount, upcoming: upcomingCount.count ?? 0, noShows30: last30.filter((r) => r.status === "no_show").length, held30: last30.filter((r) => r.status === "completed").length, types: typesCount ?? 0 });

  const timeFmt = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", timeZone });
  const range = (a: { starts_at: string; ends_at: string }) => `${timeFmt.format(new Date(a.starts_at))}–${timeFmt.format(new Date(a.ends_at))}`;
  const pct = (v: number | null) => (v === null ? "—" : formatPercent(locale, v));
  const tabHref = (x: string, extra?: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (x !== "upcoming") q.set("tab", x);
    for (const [k, v] of Object.entries(extra ?? {})) if (v) q.set(k, v);
    const s = q.toString();
    return `/${locale}/appointments${s ? `?${s}` : ""}`;
  };

  const kpis = [
    { icon: CalendarCheck, label: t("appointments.pro.kpi.today"), value: formatNumber(locale, todayCount), tone: "accent" },
    { icon: CalendarDays, label: t("appointments.pro.kpi.thisWeek"), value: formatNumber(locale, weekCount), tone: "teal" },
    { icon: Hourglass, label: t("appointments.pro.kpi.upcoming"), value: formatNumber(locale, upcomingCount.count ?? 0), tone: "gold" },
    { icon: Activity, label: t("appointments.pro.kpi.showRate"), value: pct(past90.showRate), sub: t("appointments.pro.kpi.last90"), tone: "success" },
    { icon: UserX, label: t("appointments.pro.kpi.noShowRate"), value: pct(past90.noShowRate), sub: t("appointments.pro.kpi.last90"), tone: past90.noShowRate !== null && past90.noShowRate > 0.2 ? "danger" : "warning" },
    { icon: Timer, label: t("appointments.pro.kpi.bookedHours"), value: formatNumber(locale, past90.bookedHours), sub: t("appointments.pro.kpi.last90"), tone: "accent" },
  ] as const;

  let body: React.ReactNode = null;
  if (tab === "pages") {
    const { data: types } = await supabase
      .from("appointment_types")
      .select("id, name, slug, description, duration_min, buffer_min, location, timezone, availability, min_notice_hours, max_days_ahead, status, host_id")
      .eq("organization_id", ctx.org.id)
      .order("created_at");
    const perType = new Map<string, { bookings: number; held: number; noShow: number }>();
    for (const r of statRows) {
      if (!r.type_id) continue;
      const v = perType.get(r.type_id) ?? { bookings: 0, held: 0, noShow: 0 };
      v.bookings++;
      if (r.status === "completed") v.held++;
      if (r.status === "no_show") v.noShow++;
      perType.set(r.type_id, v);
    }
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
                  stats={perType.get(ty.id as string) ?? { bookings: 0, held: 0, noShow: 0 }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  } else if (tab === "calendar") {
    const view = (VIEWS as readonly string[]).includes(String(sp.view)) ? (one(sp.view) as (typeof VIEWS)[number]) : "week";
    const anchorRaw = one(sp.d);
    const anchor = isDayKey(anchorRaw) ? anchorRaw : todayKey;
    const days = view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeekKey(anchor), i));
    const month = monthOfKey(anchor);
    const weeks = monthGrid(month);
    const first = view === "month" ? weeks[0]![0]! : days[0]!;
    const last = view === "month" ? weeks[weeks.length - 1]![6]! : days[days.length - 1]!;
    const pr = paddedRange(first, last);
    const { data: calData } = await supabase
      .from("appointments")
      .select("id, title, starts_at, ends_at, status, location, notes, contact_id, host_id")
      .eq("organization_id", ctx.org.id)
      .gte("starts_at", pr.from)
      .lt("starts_at", pr.to)
      .order("starts_at")
      .limit(1000);
    const events: CalEvent[] = ((calData ?? []) as unknown as ApptRow[])
      .map((r) => {
        const sp0 = zonedParts(r.starts_at, timeZone);
        const ep = zonedParts(r.ends_at, timeZone);
        const key = dayKeyOf(r.starts_at, timeZone);
        const sameDay = dayKeyOf(r.ends_at, timeZone) === key;
        return {
          id: r.id,
          title: r.title,
          dayKey: key,
          start: minutesOfDay(sp0),
          end: sameDay ? minutesOfDay(ep) || 1440 : 1440,
          status: String(r.status),
          timeLabel: range(r),
          who: r.contact_id ? contactName.get(r.contact_id) ?? null : null,
          href: r.contact_id ? `/${locale}/crm/${r.contact_id}` : null,
        } satisfies CalEvent;
      })
      .filter((e) => e.dayKey >= first && e.dayKey <= last);
    const step = view === "month" ? addMonths(month, 0) : "";
    void step;
    const prevKey = view === "month" ? `${addMonths(month, -1)}-01` : addDays(anchor, view === "day" ? -1 : -7);
    const nextKey = view === "month" ? `${addMonths(month, 1)}-01` : addDays(anchor, view === "day" ? 1 : 7);
    const calHref = (v: string, d?: string) => tabHref("calendar", { view: v === "week" ? undefined : v, d });
    const dayName = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });
    const dayNum = new Intl.DateTimeFormat(intl, { day: "numeric", timeZone: "UTC" });
    const title =
      view === "month"
        ? new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`))
        : view === "day"
          ? new Intl.DateTimeFormat(intl, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${anchor}T12:00:00Z`))
          : `${new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${days[0]}T12:00:00Z`))} – ${new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${days[6]}T12:00:00Z`))}`;
    const nowParts = zonedParts(now, timeZone);
    body = (
      <Card className="overflow-hidden" data-testid="calendar-view">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-1">
            <Link href={calHref(view, prevKey)} className="grid h-9 w-9 place-items-center rounded-xl border border-line hover:bg-surface-hover" aria-label={t("appointments.pro.cal.prev")}>
              <span aria-hidden className="text-lg leading-none rtl:rotate-180">‹</span>
            </Link>
            <Link href={calHref(view, nextKey)} className="grid h-9 w-9 place-items-center rounded-xl border border-line hover:bg-surface-hover" aria-label={t("appointments.pro.cal.next")}>
              <span aria-hidden className="text-lg leading-none rtl:rotate-180">›</span>
            </Link>
            <Link href={calHref(view)} className="ms-1 inline-flex h-9 items-center rounded-xl border border-line px-3 text-[13px] font-medium hover:bg-surface-hover">
              {t("appointments.pro.cal.today")}
            </Link>
          </div>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold sm:text-base">{title}</h2>
          <div className="flex gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label={t("appointments.pro.cal.view")}>
            {VIEWS.map((v) => (
              <Link key={v} href={calHref(v, anchor === todayKey ? undefined : anchor)} role="tab" aria-selected={view === v} className={cn("rounded-lg px-3 py-1 text-[13px]", view === v ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-fg")}>
                {t(`appointments.pro.cal.${v}`)}
              </Link>
            ))}
          </div>
        </div>
        {view === "month" ? (
          <MonthGrid
            weeks={weeks}
            month={month}
            events={events}
            todayKey={todayKey}
            weekdayLabels={Array.from({ length: 7 }, (_, i) => dayName.format(new Date(Date.UTC(2026, 0, 4 + i, 12))))}
            dayHref={(k) => calHref("day", k)}
            moreLabel={(n) => t("appointments.pro.cal.more", { count: n })}
          />
        ) : (
          <TimeGrid
            days={days}
            events={events}
            todayKey={todayKey}
            nowMinutes={minutesOfDay(nowParts)}
            dayLabel={(k) => ({ weekday: dayName.format(new Date(`${k}T12:00:00Z`)), date: dayNum.format(new Date(`${k}T12:00:00Z`)) })}
            dayHref={view === "week" ? (k) => calHref("day", k) : undefined}
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[12px] text-muted">
          {STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--${s === "scheduled" ? "accent" : s === "confirmed" ? "success" : s === "completed" ? "text-subtle" : s === "canceled" ? "danger" : "warning"})` }} />
              {t(`appointments.statuses.${s}`)}
            </span>
          ))}
          <span className="ms-auto text-subtle">{t("appointments.pro.cal.tz", { tz: timeZone })}</span>
        </div>
      </Card>
    );
  } else if (tab === "insights") {
    const types = await supabase.from("appointment_types").select("id, name").eq("organization_id", ctx.org.id);
    const typeName = new Map(((types.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    const s = computeApptStats(statRows.filter((r) => new Date(r.starts_at) <= now), timeZone, now);
    const upcomingOnly = statRows.filter((r) => new Date(r.starts_at) > now && isActive(String(r.status)));
    const busy = s.busiest;
    const weekdayName = (d: number) => new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + d, 12)));
    const tips: { tone: "warning" | "success" | "accent"; text: string }[] = [];
    if (s.noShowRate !== null && s.noShowRate > 0.15) tips.push({ tone: "warning", text: t("appointments.pro.insights.tipNoShow", { rate: formatPercent(locale, s.noShowRate) }) });
    if (s.cancelRate !== null && s.cancelRate > 0.25) tips.push({ tone: "warning", text: t("appointments.pro.insights.tipCancel", { rate: formatPercent(locale, s.cancelRate) }) });
    if (s.showRate !== null && s.showRate >= 0.85 && s.completed >= 5) tips.push({ tone: "success", text: t("appointments.pro.insights.tipGoodShow", { rate: formatPercent(locale, s.showRate) }) });
    if (busy) tips.push({ tone: "accent", text: t("appointments.pro.insights.tipBusiest", { day: weekdayName(busy.weekday), hour: `${String(busy.hour).padStart(2, "0")}:00` }) });
    if (s.avgLeadDays !== null && s.avgLeadDays > 10) tips.push({ tone: "accent", text: t("appointments.pro.insights.tipLead", { days: s.avgLeadDays }) });
    if (upcomingOnly.length === 0) tips.push({ tone: "warning", text: t("appointments.pro.insights.tipEmptyCalendar") });
    const cards = [
      { label: t("appointments.pro.kpi.showRate"), value: pct(s.showRate), sub: t("appointments.pro.insights.heldOf", { held: s.completed, total: s.completed + s.noShow }) },
      { label: t("appointments.pro.kpi.noShowRate"), value: pct(s.noShowRate), sub: t("appointments.pro.insights.count", { count: s.noShow }) },
      { label: t("appointments.pro.kpi.cancelRate"), value: pct(s.cancelRate), sub: t("appointments.pro.insights.count", { count: s.canceled }) },
      { label: t("appointments.pro.kpi.bookedHours"), value: formatNumber(locale, s.bookedHours), sub: s.avgMinutes ? t("appointments.pro.insights.avgLength", { minutes: s.avgMinutes }) : undefined },
      { label: t("appointments.pro.kpi.avgLead"), value: s.avgLeadDays === null ? "—" : t("appointments.pro.insights.days", { count: s.avgLeadDays }) },
      { label: t("appointments.pro.insights.busiest"), value: busy ? `${weekdayName(busy.weekday)} ${String(busy.hour).padStart(2, "0")}:00` : "—", sub: busy ? t("appointments.pro.insights.count", { count: busy.count }) : undefined },
    ];
    body =
      s.total === 0 ? (
        <Card>
          <EmptyState icon={<Activity className="h-6 w-6" />} title={t("appointments.pro.insights.empty")} body={t("appointments.emptyHint")} />
        </Card>
      ) : (
        <div className="space-y-4" data-testid="appointment-insights">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {cards.map((c) => (
              <Card key={c.label} className="p-4">
                <div className="text-[12.5px] text-muted">{c.label}</div>
                <div className="mt-1.5 text-lg font-bold sm:text-xl">
                  <bdi dir="ltr">{c.value}</bdi>
                </div>
                {c.sub ? <div className="mt-0.5 text-[12px] text-subtle">{c.sub}</div> : null}
              </Card>
            ))}
          </div>
          {tips.length ? (
            <Card className="p-4">
              <h3 className="mb-2 text-[13px] font-semibold text-muted">{t("appointments.pro.insights.tipsTitle")}</h3>
              <ul className="grid gap-2 md:grid-cols-2">
                {tips.map((x, i) => (
                  <li key={i} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px]", x.tone === "warning" ? "border-warning/30 bg-warning-soft" : x.tone === "success" ? "border-success/30 bg-success-soft" : "border-accent/25 bg-accent-soft")}>
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                    <span>{x.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("appointments.pro.insights.statusMix")} description={t("appointments.pro.insights.window")} />
              <div className="p-5">
                <StatusDonut data={s.byStatus} total={s.total} label={t("appointments.pro.insights.statusMix")} />
              </div>
            </Card>
            <Card>
              <CardHeader title={t("appointments.pro.insights.weekly")} description={t("appointments.pro.insights.weeklyHint")} />
              <div className="p-4">
                <WeeklyTrend data={s.weekly} label={t("appointments.pro.insights.weekly")} />
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title={t("appointments.pro.insights.heatmap")} description={t("appointments.pro.insights.heatmapHint")} />
              <div className="p-4">
                <Heatmap heat={s.heat} max={s.heatMax} label={t("appointments.pro.insights.heatmap")} />
              </div>
            </Card>
            <Card>
              <CardHeader title={t("appointments.pro.insights.byHost")} />
              <ul className="divide-y divide-line">
                {s.byHost.slice(0, 8).map((h) => {
                  const resolved = h.completed + h.noShow;
                  return (
                    <li key={h.host ?? "none"} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{h.host ? memberName.get(h.host) ?? "—" : "—"}</span>
                      <span className="text-[12px] text-muted">{t("appointments.pro.insights.count", { count: h.count })}</span>
                      <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-hover sm:block" aria-hidden>
                        <div className="h-full rounded-full bg-success" style={{ width: `${resolved ? Math.round((h.completed / resolved) * 100) : 0}%` }} />
                      </div>
                      <bdi dir="ltr" className="w-12 text-end font-semibold tabular-nums">
                        {resolved ? pct(h.completed / resolved) : "—"}
                      </bdi>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card>
              <CardHeader title={t("appointments.pro.insights.byType")} />
              <ul className="divide-y divide-line">
                {s.byType.slice(0, 8).map((x) => (
                  <li key={x.type ?? "manual"} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{x.type ? typeName.get(x.type) ?? "—" : t("appointments.pro.insights.manual")}</span>
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                      <div className="h-full rounded-full bg-accent-solid" style={{ width: `${Math.round((x.count / s.total) * 100)}%` }} />
                    </div>
                    <bdi dir="ltr" className="w-10 text-end font-semibold tabular-nums">
                      {formatNumber(locale, x.count)}
                    </bdi>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      );
  } else {
    const fq = (one(sp.q) ?? "").trim().slice(0, 80);
    const fs = (STATUSES as readonly string[]).includes(String(one(sp.status))) ? String(one(sp.status)) : "";
    const fh = members.some((m) => m.id === one(sp.host)) ? String(one(sp.host)) : "";
    const filtered = Boolean(fq || fs || fh);
    let q = supabase
      .from("appointments")
      .select("id, title, starts_at, ends_at, status, location, notes, contact_id, host_id")
      .eq("organization_id", ctx.org.id)
      .limit(300);
    if (fq) q = q.ilike("title", `%${fq.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    if (fs) q = q.eq("status", fs);
    if (fh) q = q.eq("host_id", fh);
    q = tab === "upcoming" ? q.gte("ends_at", now.toISOString()).order("starts_at") : q.lt("ends_at", now.toISOString()).order("starts_at", { ascending: false });
    const { data } = await q;
    const rows = data ?? [];
    const dayFmt = new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", timeZone });
    const groups = new Map<string, { key: string; items: typeof rows }>();
    for (const r of rows) {
      const k = dayFmt.format(new Date(r.starts_at as string));
      const g = groups.get(k) ?? { key: dayKeyOf(r.starts_at as string, timeZone), items: [] };
      g.items.push(r);
      groups.set(k, g);
    }
    const next = tab === "upcoming" && !filtered ? rows.find((r) => isActive(String(r.status))) : undefined;
    const nextJoin = next ? detectJoinLink(next.location as string | null, next.notes as string | null) : null;

    const filterBar = (
      <Card className="mb-4 p-3" data-testid="appointment-filters">
        <form method="get" action={`/${locale}/appointments`} className="grid gap-2 sm:grid-cols-[1fr_200px_auto_auto] sm:items-center">
          {tab !== "upcoming" ? <input type="hidden" name="tab" value={tab} /> : null}
          {fs ? <input type="hidden" name="status" value={fs} /> : null}
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input name="q" defaultValue={fq} placeholder={t("appointments.pro.filters.search")} aria-label={t("appointments.pro.filters.search")} className="ps-9" maxLength={80} />
          </div>
          <Select name="host" defaultValue={fh} aria-label={t("appointments.host")}>
            <option value="">{t("appointments.pro.filters.allHosts")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("appointments.pro.filters.apply")}
          </Button>
          {filtered ? (
            <Link href={tabHref(tab)} className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-[13px] text-muted hover:bg-surface-hover hover:text-fg">
              <X className="h-4 w-4" /> {t("appointments.pro.filters.clear")}
            </Link>
          ) : null}
        </form>
        <div className="mt-2 flex gap-1 overflow-x-auto" role="group" aria-label={t("appointments.pro.filters.status")}>
          {["", ...STATUSES].map((st) => (
            <Link
              key={st || "all"}
              href={tabHref(tab, { q: fq || undefined, status: st || undefined, host: fh || undefined })}
              aria-pressed={fs === st}
              className={cn("inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[12.5px] transition-colors", fs === st ? "border-accent/40 bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:bg-surface-hover hover:text-fg")}
            >
              {st ? t(`appointments.statuses.${st}`) : t("appointments.pro.filters.allStatuses")}
            </Link>
          ))}
        </div>
      </Card>
    );

    body = (
      <>
        {next ? (
          <div className="mb-4">
            <NextMeetingBanner
              title={next.title as string}
              startsAt={next.starts_at as string}
              endsAt={next.ends_at as string}
              timeLabel={`${dayFmt.format(new Date(next.starts_at as string))} · ${range(next as { starts_at: string; ends_at: string })}`}
              who={next.contact_id ? contactName.get(next.contact_id as string) ?? null : null}
              location={next.location as string | null}
              joinUrl={nextJoin?.url ?? null}
              href={next.contact_id ? `/${locale}/crm/${next.contact_id}` : null}
            />
          </div>
        ) : null}
        {filterBar}
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarClock className="h-6 w-6" />}
              title={filtered ? t("appointments.pro.filters.noResults") : t(tab === "upcoming" ? "appointments.emptyUpcoming" : "appointments.emptyPast")}
              body={tab === "upcoming" && !filtered ? t("appointments.emptyHint") : undefined}
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {Array.from(groups.entries()).map(([day, group]) => {
              const items = group.items;
              const isToday = group.key === todayKey;
              return (
                <Card key={day} className={cn(isToday && "border-accent/40")}>
                  <CardHeader
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        {day}
                        {isToday ? <Badge tone="accent">{t("appointments.pro.todayBadge")}</Badge> : group.key === addDays(todayKey, 1) ? <Badge tone="teal">{t("appointments.pro.tomorrowBadge")}</Badge> : null}
                        <span className="text-[12px] font-normal text-subtle">{t("appointments.pro.dayCount", { count: items.length })}</span>
                      </span>
                    }
                  />
                  <ul className="divide-y divide-line">
                    {items.map((a) => {
                      const join = detectJoinLink(a.location as string | null, a.notes as string | null);
                      const live = isActive(String(a.status)) && new Date(a.starts_at as string) <= now && new Date(a.ends_at as string) > now;
                      const canMove = canManage && isActive(String(a.status));
                      const plain = [a.title, `${day} ${range(a as { starts_at: string; ends_at: string })}`, a.location, join && join.url !== a.location ? join.url : null].filter(Boolean).join("\n");
                      return (
                        <li key={a.id as string} className={cn("appt-row flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center", live && "bg-success-soft/40")}>
                          <div className="w-28 shrink-0 font-semibold">
                            <bdi dir="ltr">{range(a as { starts_at: string; ends_at: string })}</bdi>
                            {tab === "upcoming" ? <div className="text-[11.5px] font-normal text-subtle">{live ? t("appointments.pro.inProgress") : relativeTime(a.starts_at as string, intl, now)}</div> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">{a.title}</span>
                              <Badge tone={TONE[a.status as string] ?? "neutral"}>{t(`appointments.statuses.${a.status}`)}</Badge>
                              {live ? (
                                <Badge tone="success">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> {t("appointments.pro.live")}
                                </Badge>
                              ) : null}
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
                                <span className="flex min-w-0 items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{a.location}</span>
                                </span>
                              ) : null}
                            </div>
                            {a.notes ? <p className="mt-1 line-clamp-2 text-[12.5px] text-subtle">{a.notes}</p> : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {join && isActive(String(a.status)) ? <JoinButton url={join.url} /> : null}
                            {canManage ? <AppointmentStatusButtons id={a.id as string} status={a.status as string} /> : null}
                            <div className="flex items-center">
                              {canMove ? <RescheduleButton id={a.id as string} startsAt={a.starts_at as string} endsAt={a.ends_at as string} /> : null}
                              {canManage ? <NotesButton id={a.id as string} notes={(a.notes as string | null) ?? ""} location={(a.location as string | null) ?? ""} /> : null}
                              <AddToCalendar appt={{ id: a.id as string, title: a.title as string, starts_at: a.starts_at as string, ends_at: a.ends_at as string, location: a.location as string | null, notes: a.notes as string | null }} />
                              <CopyDetails text={plain} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("appointments.title")} description={t("appointments.subtitle")} actions={canManage ? <NewAppointmentButton contacts={contacts} members={members} /> : null} />
      {/* wave 53 — smart tips (the KPI cards below already show the numbers) */}
      <ScreenPulse screen="appointments" pulse={{ ...apptPulse, stats: [] }} locale={locale} t={t} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="appointment-kpis">
        {kpis.map((k) => (
          <Card key={k.label} className="kpi-card group relative overflow-hidden p-4">
            <div aria-hidden className={cn("kpi-glow", `kpi-glow-${k.tone}`)} />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-muted">{k.label}</div>
                <div className="mt-1.5 text-xl font-bold sm:text-2xl">
                  <bdi dir="ltr">{k.value}</bdi>
                </div>
                {"sub" in k && k.sub ? <div className="mt-0.5 text-[11.5px] text-subtle">{k.sub}</div> : null}
              </div>
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl border", k.tone === "danger" ? "border-danger/25 bg-danger-soft text-danger" : k.tone === "warning" ? "border-warning/25 bg-warning-soft text-warning" : k.tone === "success" ? "border-success/25 bg-success-soft text-success" : k.tone === "teal" ? "border-teal/25 bg-teal-soft text-teal" : k.tone === "gold" ? "border-gold/30 bg-gold-soft text-gold" : "border-accent/25 bg-accent-soft text-accent")}>
                <k.icon className="h-[18px] w-[18px]" />
              </span>
            </div>
          </Card>
        ))}
      </div>
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
