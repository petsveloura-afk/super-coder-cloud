"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";
import { computeSlots } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { bookPublicAppointment } from "@/app/[locale]/(public)/actions";

export interface PublicBooking {
  name: string;
  description: string | null;
  duration_min: number;
  buffer_min: number;
  location: string | null;
  timezone: string;
  availability: Record<string, [string, string][]>;
  min_notice_hours: number;
  max_days_ahead: number;
  org: string;
  host: string;
  busy: [string, string][];
}

export function BookingWidget({ slug, booking }: { slug: string; booking: PublicBooking }) {
  const { t, intl, locale, dir } = useI18n();
  const slots = useMemo(
    () =>
      computeSlots({
        availability: booking.availability,
        timezone: booking.timezone,
        durationMin: booking.duration_min,
        bufferMin: booking.buffer_min,
        minNoticeHours: booking.min_notice_hours,
        maxDaysAhead: booking.max_days_ahead,
        busy: booking.busy,
      }),
    [booking],
  );
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: viewerTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const days = useMemo(() => Array.from(new Set(slots.map(dayKey))), [slots]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dayIndex, setDayIndex] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ token: string; starts_at: string } | null>(null);
  const [pending, start] = useTransition();

  const day = days[dayIndex];
  const daySlots = slots.filter((s) => dayKey(s) === day);
  const fmtDay = new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long" });
  const fmtTime = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit" });
  const Prev = dir === "rtl" ? ChevronRight : ChevronLeft;
  const Next = dir === "rtl" ? ChevronLeft : ChevronRight;

  if (confirmed) {
    return (
      <div role="status" className="rounded-3xl border border-line bg-surface p-8 text-center">
        <CalendarCheck className="mx-auto h-12 w-12 text-success" />
        <h1 className="mt-4 text-xl font-bold">{t("booking.confirmed")}</h1>
        <p className="mt-2 text-muted">
          {booking.name} · {fmtDay.format(new Date(confirmed.starts_at))} · {fmtTime.format(new Date(confirmed.starts_at))}
        </p>
        <a href={`/${locale}/book/cancel/${confirmed.token}`} className="mt-5 inline-block text-[13px] text-subtle underline">
          {t("booking.cancelLink")}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <header>
        <p className="text-[12.5px] font-medium text-subtle">
          {booking.org}
          {booking.host ? ` · ${booking.host}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{booking.name}</h1>
        <div className="mt-2 flex flex-wrap gap-3 text-[13px] text-muted">
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" /> {t("booking.minutes", { count: booking.duration_min })}
          </span>
          {booking.location ? (
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" /> {booking.location}
            </span>
          ) : null}
        </div>
        {booking.description ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{booking.description}</p> : null}
      </header>

      {slots.length === 0 ? (
        <p className="rounded-xl bg-elevated p-4 text-center text-sm text-muted">{t("booking.noSlots")}</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" aria-label={t("common.previous")} disabled={dayIndex === 0} onClick={() => { setDayIndex((i) => i - 1); setSlot(null); }}>
              <Prev className="h-5 w-5" />
            </Button>
            <h2 className="font-semibold" aria-live="polite">{day ? fmtDay.format(new Date(`${day}T12:00:00`)) : ""}</h2>
            <Button variant="ghost" size="icon" aria-label={t("common.next")} disabled={dayIndex >= days.length - 1} onClick={() => { setDayIndex((i) => i + 1); setSlot(null); }}>
              <Next className="h-5 w-5" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label={t("booking.pickTime")}>
            {daySlots.map((s) => (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={slot === s}
                onClick={() => setSlot(s)}
                className={cn("h-11 rounded-xl border text-sm font-medium transition-colors", slot === s ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-accent")}
              >
                <bdi dir="ltr">{fmtTime.format(new Date(s))}</bdi>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-subtle">{t("booking.timezoneNote", { tz: viewerTz })}</p>
        </>
      )}

      {slot ? (
        <form
          className="space-y-4 border-t border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setError(null);
            start(async () => {
              const res = await bookPublicAppointment({
                slug,
                start: slot,
                name: String(fd.get("name") ?? ""),
                email: String(fd.get("email") ?? ""),
                phone: String(fd.get("phone") ?? ""),
                notes: String(fd.get("notes") ?? ""),
              });
              if (res.ok && res.data) setConfirmed(res.data as { token: string; starts_at: string });
              else setError(t(res.error ?? "errors.generic"));
            });
          }}
        >
          {error ? (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Field label={`${t("booking.yourName")} *`} htmlFor="bk-name">
            <Input id="bk-name" name="name" required autoComplete="name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("crm.email")} htmlFor="bk-email">
              <Input id="bk-email" name="email" type="email" dir="ltr" autoComplete="email" />
            </Field>
            <Field label={t("crm.phone")} htmlFor="bk-phone">
              <Input id="bk-phone" name="phone" type="tel" dir="ltr" autoComplete="tel" />
            </Field>
          </div>
          <Field label={t("booking.notes")} htmlFor="bk-notes">
            <Textarea id="bk-notes" name="notes" />
          </Field>
          <Button type="submit" size="lg" loading={pending} className="w-full justify-center">
            {t("booking.confirm", { time: fmtTime.format(new Date(slot)) })}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
