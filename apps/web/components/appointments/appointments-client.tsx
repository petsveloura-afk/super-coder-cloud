"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import { ShareBox } from "@/components/forms/share-box";
import { createAppointmentAction, deleteAppointmentTypeAction, saveAppointmentTypeAction, setAppointmentStatusAction } from "@/app/[locale]/(dashboard)/appointments/actions";
import type { ActionState } from "@/lib/action-state";

export interface Opt {
  id: string;
  label: string;
  sub?: string | null;
}

/* ------------------------------------------------------- manual booking */
function ManualFields({ state, contacts, members }: { state: ActionState<unknown>; contacts: Opt[]; members: Opt[] }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const [startIso, setStartIso] = useState("");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("appointments.titleField")} htmlFor="ap-title" error={err("title")} className="sm:col-span-2">
        <Input id="ap-title" name="title" defaultValue={state.values?.title ?? ""} required />
      </Field>
      <Field label={t("appointments.start")} htmlFor="ap-start" error={err("start")}>
        <Input id="ap-start" type="datetime-local" dir="ltr" required onChange={(e) => setStartIso(e.target.value ? new Date(e.target.value).toISOString() : "")} />
        <input type="hidden" name="start" value={startIso} />
      </Field>
      <Field label={t("appointments.duration")} htmlFor="ap-duration" error={err("duration")}>
        <Select id="ap-duration" name="duration" defaultValue={state.values?.duration ?? "30"}>
          {[15, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {t("booking.minutes", { count: m })}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("deals.contact")} htmlFor="ap-contact">
        <Select id="ap-contact" name="contactId" defaultValue="">
          <option value="">—</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.sub ? ` · ${c.sub}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("appointments.host")} htmlFor="ap-host">
        <Select id="ap-host" name="hostId" defaultValue="">
          <option value="">{t("deals.ownerMe")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("appointments.location")} htmlFor="ap-location" className="sm:col-span-2">
        <Input id="ap-location" name="location" defaultValue={state.values?.location ?? ""} />
      </Field>
      <Field label={t("booking.notes")} htmlFor="ap-notes" className="sm:col-span-2">
        <Textarea id="ap-notes" name="notes" defaultValue={state.values?.notes ?? ""} />
      </Field>
    </div>
  );
}

export function NewAppointmentButton({ contacts, members }: { contacts: Opt[]; members: Opt[] }) {
  const { t } = useI18n();
  return (
    <FormDialog
      action={createAppointmentAction}
      title={t("appointments.new")}
      submitLabel={t("common.create")}
      trigger={
        <Button>
          <CalendarPlus className="h-4 w-4" /> {t("appointments.new")}
        </Button>
      }
    >
      {(state) => <ManualFields state={state} contacts={contacts} members={members} />}
    </FormDialog>
  );
}

export function AppointmentStatusButtons({ id, status }: { id: string; status: string }) {
  const { t } = useI18n();
  const next: string[] = status === "scheduled" ? ["confirmed", "canceled"] : status === "confirmed" ? ["completed", "no_show", "canceled"] : status === "canceled" ? [] : [];
  return (
    <div className="flex flex-wrap gap-1">
      {next.map((s) => (
        <ConfirmActionButton
          key={s}
          action={setAppointmentStatusAction}
          fields={{ id, status: s }}
          confirm={s === "canceled" ? t("appointments.confirmCancel") : false}
          variant={s === "canceled" ? "ghost" : "secondary"}
          size="sm"
          icon={<span />}
          label={t(`appointments.actions.${s}`)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------- booking pages */
export interface TypeValue {
  name: string;
  slug: string;
  description: string;
  duration_min: number;
  buffer_min: number;
  location: string;
  timezone: string;
  availability: Record<string, [string, string][]>;
  min_notice_hours: number;
  max_days_ahead: number;
  status: "active" | "inactive";
}

const DAYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

export function BookingTypeEditor({ id, initial, members, hostId, trigger }: { id?: string; initial: TypeValue; members: Opt[]; hostId?: string; trigger: React.ReactNode }) {
  const { t, locale, intl } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<TypeValue>(initial);
  const [host, setHost] = useState(hostId ?? "");
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<TypeValue>) => setV((x) => ({ ...x, ...patch }));
  const dayName = (d: string) => new Intl.DateTimeFormat(intl, { weekday: "long" }).format(new Date(Date.UTC(2026, 0, 4 + Number(d))));
  const err = (k: string) => (errors[k] ? t(errors[k]!) : undefined);

  function setDay(d: string, on: boolean, from?: string, to?: string) {
    const av = { ...v.availability };
    if (!on) delete av[d];
    else av[d] = [[from ?? av[d]?.[0]?.[0] ?? "09:00", to ?? av[d]?.[0]?.[1] ?? "17:00"]];
    set({ availability: av });
  }

  function save() {
    setErrors({});
    start(async () => {
      const res = await saveAppointmentTypeAction({ locale, id, data: v, hostId: host || undefined });
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(t(res.error));
        return;
      }
      toast.success(t(res.message ?? "common.saved"));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} title={id ? t("booking.editType") : t("booking.newType")} className="sm:max-w-2xl" trigger={trigger}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("booking.typeName")} htmlFor="bt-name" error={err("name")}>
            <Input id="bt-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t("forms.slug")} htmlFor="bt-slug" error={err("slug")}>
            <Input id="bt-slug" dir="ltr" value={v.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
          </Field>
          <Field label={t("appointments.duration")} htmlFor="bt-duration">
            <Select id="bt-duration" value={String(v.duration_min)} onChange={(e) => set({ duration_min: Number(e.target.value) })}>
              {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {t("booking.minutes", { count: m })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("booking.buffer")} htmlFor="bt-buffer">
            <Select id="bt-buffer" value={String(v.buffer_min)} onChange={(e) => set({ buffer_min: Number(e.target.value) })}>
              {[0, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {t("booking.minutes", { count: m })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("appointments.host")} htmlFor="bt-host">
            <Select id="bt-host" value={host} onChange={(e) => setHost(e.target.value)}>
              <option value="">{t("deals.ownerMe")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("booking.timezone")} htmlFor="bt-tz">
            <Input id="bt-tz" dir="ltr" value={v.timezone} onChange={(e) => set({ timezone: e.target.value })} />
          </Field>
          <Field label={t("appointments.location")} htmlFor="bt-location" className="sm:col-span-2">
            <Input id="bt-location" value={v.location} onChange={(e) => set({ location: e.target.value })} placeholder={t("booking.locationPlaceholder")} />
          </Field>
          <Field label={t("automations.description")} htmlFor="bt-desc" className="sm:col-span-2">
            <Textarea id="bt-desc" value={v.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label={t("booking.minNotice")} htmlFor="bt-notice">
            <Input id="bt-notice" type="number" min={0} dir="ltr" value={v.min_notice_hours} onChange={(e) => set({ min_notice_hours: Number(e.target.value) })} />
          </Field>
          <Field label={t("booking.maxDays")} htmlFor="bt-max">
            <Input id="bt-max" type="number" min={1} dir="ltr" value={v.max_days_ahead} onChange={(e) => set({ max_days_ahead: Number(e.target.value) })} />
          </Field>
        </div>
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-[13px] font-medium text-muted">{t("booking.availability")}</legend>
          <ul className="space-y-2">
            {DAYS.map((d) => {
              const on = Boolean(v.availability[d]?.length);
              const [from, to] = v.availability[d]?.[0] ?? ["09:00", "17:00"];
              return (
                <li key={d} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex w-28 items-center gap-2">
                    <input type="checkbox" checked={on} onChange={(e) => setDay(d, e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                    {dayName(d)}
                  </label>
                  {on ? (
                    <>
                      <Input aria-label={`${dayName(d)} ${t("booking.from")}`} type="time" dir="ltr" className="w-32" value={from} onChange={(e) => setDay(d, true, e.target.value, to)} />
                      <span>–</span>
                      <Input aria-label={`${dayName(d)} ${t("booking.to")}`} type="time" dir="ltr" className="w-32" value={to} onChange={(e) => setDay(d, true, from, e.target.value)} />
                    </>
                  ) : (
                    <span className="text-subtle">{t("booking.unavailable")}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {err("availability") ? <p className="mt-2 text-[13px] text-danger">{err("availability")}</p> : null}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.status === "active"} onChange={(e) => set({ status: e.target.checked ? "active" : "inactive" })} className="h-4 w-4 accent-[var(--accent)]" />
          {t("forms.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} loading={pending}>
            <Save className="h-4 w-4" /> {t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function BookingTypeCard({ id, value, url, members, hostId, hostName }: { id: string; value: TypeValue; url: string; members: Opt[]; hostId: string; hostName: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3 rounded-xl border border-line p-4" data-booking-type={value.slug}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-auto font-semibold">{value.name}</span>
        <span className="text-[12.5px] text-muted">
          {t("booking.minutes", { count: value.duration_min })} · {hostName}
        </span>
      </div>
      <ShareBox url={url} height={820} />
      <div className="flex gap-2">
        <BookingTypeEditor
          id={id}
          initial={value}
          members={members}
          hostId={hostId}
          trigger={
            <Button variant="secondary" size="sm">
              {t("common.edit")}
            </Button>
          }
        />
        <ConfirmActionButton action={deleteAppointmentTypeAction} fields={{ id }} variant="ghost" size="sm" />
      </div>
    </div>
  );
}

export function NewBookingTypeButton({ members, defaultSlug }: { members: Opt[]; defaultSlug: string }) {
  const { t } = useI18n();
  return (
    <BookingTypeEditor
      initial={{
        name: t("booking.defaultName"),
        slug: defaultSlug,
        description: "",
        duration_min: 30,
        buffer_min: 10,
        location: "",
        timezone: "Asia/Jerusalem",
        availability: { "0": [["09:00", "17:00"]], "1": [["09:00", "17:00"]], "2": [["09:00", "17:00"]], "3": [["09:00", "17:00"]], "4": [["09:00", "17:00"]] },
        min_notice_hours: 2,
        max_days_ahead: 30,
        status: "active",
      }}
      members={members}
      trigger={
        <Button variant="secondary">
          <Plus className="h-4 w-4" /> {t("booking.newType")}
        </Button>
      }
    />
  );
}
