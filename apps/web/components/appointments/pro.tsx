"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarClock, CalendarPlus, CalendarRange, Check, Copy, Download, NotebookPen, Radio, Video } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import { buildIcs, googleCalendarUrl, type ApptRow } from "@/lib/appointments/insights";
import { rescheduleAppointmentAction, updateAppointmentNotesAction } from "@/app/[locale]/(dashboard)/appointments/actions";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- countdown */
function useNow(intervalMs: number): number | null {
  // external clock: stable within one interval bucket, null on the server (no hydration mismatch)
  return useSyncExternalStore(
    (notify) => {
      const id = window.setInterval(notify, intervalMs);
      return () => window.clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
}

function formatCountdown(ms: number, t: (k: string, p?: Record<string, string | number>) => string) {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return t("appointments.pro.countdownDays", { days: d, hours: h });
  if (h > 0) return t("appointments.pro.countdownHours", { hours: h, minutes: m });
  return t("appointments.pro.countdownMinutes", { minutes: m });
}

export interface NextMeetingProps {
  title: string;
  startsAt: string;
  endsAt: string;
  timeLabel: string;
  who?: string | null;
  location?: string | null;
  joinUrl?: string | null;
  href?: string | null;
}

/** "Your next meeting" hero with a live countdown and a one-click join button. */
export function NextMeetingBanner({ title, startsAt, endsAt, timeLabel, who, location, joinUrl, href }: NextMeetingProps) {
  const { t } = useI18n();
  const now = useNow(15_000);
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const live = now !== null && now >= start && now < end;
  const label = now === null ? "" : live ? t("appointments.pro.inProgress") : formatCountdown(start - now, t);
  const soon = now !== null && !live && start - now < 15 * 60_000;
  return (
    <div
      className={cn(
        "pro-hero relative overflow-hidden rounded-[var(--radius-card)] border p-5 sm:p-6",
        live ? "border-success/40" : soon ? "border-warning/40" : "border-accent/30",
      )}
      data-testid="next-meeting"
    >
      <div aria-hidden className="pro-hero-glow" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
            {live ? <Radio className="h-4 w-4 animate-pulse text-success" /> : <CalendarClock className="h-4 w-4 text-accent" />}
            {t("appointments.pro.nextMeeting")}
          </div>
          {href ? (
            <a href={href} className="block truncate text-xl font-bold hover:text-accent sm:text-2xl">
              {title}
            </a>
          ) : (
            <div className="truncate text-xl font-bold sm:text-2xl">{title}</div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <bdi dir="ltr" className="font-semibold text-fg">
              {timeLabel}
            </bdi>
            {who ? <span>{who}</span> : null}
            {location && !joinUrl ? <span className="truncate">{location}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className={cn("pro-countdown rounded-2xl border px-4 py-2 text-center", live ? "border-success/40 bg-success-soft text-success" : soon ? "border-warning/40 bg-warning-soft text-warning" : "border-accent/25 bg-accent-soft text-accent")} aria-live="polite">
            <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{live ? t("appointments.pro.live") : t("appointments.pro.startsIn")}</div>
            <div className="text-lg font-bold tabular-nums" suppressHydrationWarning>
              {live ? "●" : label || "—"}
            </div>
          </div>
          {joinUrl ? <JoinButton url={joinUrl} primary /> : null}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- join */
export function JoinButton({ url, primary }: { url: string; primary?: boolean }) {
  const { t } = useI18n();
  // only ever navigate to http(s)
  if (!/^https?:\/\//i.test(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "btn-press inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition",
        primary ? "btn-brand bg-accent-solid text-accent-fg shadow-[0_8px_22px_-10px_var(--brand)] hover:brightness-110 sm:h-10 sm:px-4 sm:text-sm" : "border border-success/30 bg-success-soft text-success hover:bg-success hover:text-white",
      )}
    >
      <Video className="h-4 w-4" /> {t("appointments.pro.joinCall")}
    </a>
  );
}

/* ----------------------------------------------------------- add to calendar */
export function AddToCalendar({ appt }: { appt: Pick<ApptRow, "id" | "title" | "starts_at" | "ends_at" | "location" | "notes"> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
      } else if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function download() {
    const blob = new Blob([buildIcs(appt)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-${appt.id.slice(0, 8)}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={t("appointments.pro.addToCalendar")} title={t("appointments.pro.addToCalendar")}>
        <CalendarPlus className="h-4 w-4" />
      </Button>
      {open ? (
        <div role="menu" className="absolute end-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-elevated p-1 text-[13px] shadow-2xl">
          <button role="menuitem" type="button" onClick={download} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start hover:bg-surface-hover">
            <Download className="h-4 w-4 text-accent" /> {t("appointments.pro.downloadIcs")}
          </button>
          <a role="menuitem" href={googleCalendarUrl(appt)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start hover:bg-surface-hover">
            <CalendarRange className="h-4 w-4 text-teal" /> {t("appointments.pro.googleCalendar")}
          </a>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- copy details */
export function CopyDetails({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("appointments.pro.copyDetails")}
      title={t("appointments.pro.copyDetails")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success(t("common.copied"));
          window.setTimeout(() => setDone(false), 1800);
        } catch {
          toast.error(t("errors.generic"));
        }
      }}
    >
      {done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

/* ---------------------------------------------------------------- reschedule */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function RescheduleFields({ state, startsAt, minutes }: { state: { fieldErrors?: Record<string, string> }; startsAt: string; minutes: number }) {
  const { t } = useI18n();
  const err = useFieldError(state as never);
  const [startIso, setStartIso] = useState(startsAt);
  const options = Array.from(new Set([15, 30, 45, 60, 90, 120, minutes])).sort((a, b) => a - b);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("appointments.pro.newTime")} htmlFor="rs-start" error={err("start")}>
        <Input id="rs-start" type="datetime-local" dir="ltr" required defaultValue={toLocalInput(startsAt)} onChange={(e) => setStartIso(e.target.value ? new Date(e.target.value).toISOString() : "")} />
        <input type="hidden" name="start" value={startIso} />
      </Field>
      <Field label={t("appointments.duration")} htmlFor="rs-duration" error={err("duration")}>
        <Select id="rs-duration" name="duration" defaultValue={String(minutes)}>
          {options.map((m) => (
            <option key={m} value={m}>
              {t("booking.minutes", { count: m })}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function RescheduleButton({ id, startsAt, endsAt }: { id: string; startsAt: string; endsAt: string }) {
  const { t } = useI18n();
  const minutes = Math.max(5, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000));
  return (
    <FormDialog
      action={rescheduleAppointmentAction}
      title={t("appointments.pro.reschedule")}
      description={t("appointments.pro.rescheduleHint")}
      submitLabel={t("appointments.pro.reschedule")}
      hidden={{ id }}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("appointments.pro.reschedule")} title={t("appointments.pro.reschedule")}>
          <CalendarClock className="h-4 w-4" />
        </Button>
      }
    >
      {(state) => <RescheduleFields state={state} startsAt={startsAt} minutes={minutes} />}
    </FormDialog>
  );
}

/* --------------------------------------------------------------------- notes */
export function NotesButton({ id, notes, location }: { id: string; notes: string; location: string }) {
  const { t } = useI18n();
  return (
    <FormDialog
      action={updateAppointmentNotesAction}
      title={t("appointments.pro.editNotes")}
      submitLabel={t("common.save")}
      hidden={{ id }}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("appointments.pro.editNotes")} title={t("appointments.pro.editNotes")}>
          <NotebookPen className="h-4 w-4" />
        </Button>
      }
    >
      {() => (
        <div className="grid gap-4">
          <Field label={t("appointments.location")} htmlFor="nt-location" hint={t("appointments.pro.locationHint")}>
            <Input id="nt-location" name="location" defaultValue={location} maxLength={300} />
          </Field>
          <Field label={t("booking.notes")} htmlFor="nt-notes">
            <Textarea id="nt-notes" name="notes" defaultValue={notes} maxLength={4000} />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}
