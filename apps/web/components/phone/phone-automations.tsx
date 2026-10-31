"use client";

import { useState, useTransition } from "react";
import { BellRing, CalendarClock, Mic, PhoneMissed, Repeat2, Save } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { savePhoneSettingsAction } from "@/app/[locale]/(dashboard)/phone/actions";

export interface PhoneAutomationsValue {
  missed_text: boolean;
  missed_message: string | null;
  record_calls: boolean;
  reminder_calls: boolean;
  callback_calls: boolean;
}

/**
 * Wave 59 — phone automations in one card: text back after a missed call (on by default), call recordings,
 * reminder calls the day before appointments, follow-up calls to quiet leads (consent only).
 */
export function PhoneAutomations({ value, canManage, ready }: { value: PhoneAutomationsValue; canManage: boolean; ready: boolean }) {
  const { t, locale } = useI18n();
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  const rows: { key: keyof Omit<PhoneAutomationsValue, "missed_message">; icon: typeof Mic }[] = [
    { key: "missed_text", icon: PhoneMissed },
    { key: "reminder_calls", icon: CalendarClock },
    { key: "callback_calls", icon: Repeat2 },
    { key: "record_calls", icon: Mic },
  ];
  const save = () =>
    start(async () => {
      const r = await savePhoneSettingsAction({ locale, missedText: v.missed_text, missedMessage: v.missed_message ?? "", recordCalls: v.record_calls, reminderCalls: v.reminder_calls, callbackCalls: v.callback_calls });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
    });
  if (!ready) return <p className="px-5 pb-5 text-[13px] text-muted">{t("phone.auto.notReady")}</p>;
  return (
    <div className="space-y-3 p-5" data-testid="phone-automations">
      <ul className="stagger space-y-2">
        {rows.map(({ key, icon: Icon }) => (
          <li key={key} className={cn("rounded-2xl border p-3 transition", v[key] ? "border-accent/40 bg-accent-soft/30" : "border-line")}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={v[key]} disabled={!canManage} onChange={(e) => setV((x) => ({ ...x, [key]: e.target.checked }))} className="mt-1 h-5 w-5 accent-[var(--accent-solid)]" data-testid={`phone-auto-${key}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-accent" aria-hidden /> {t(`phone.auto.${key}.title`)}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{t(`phone.auto.${key}.body`)}</span>
              </span>
            </label>
            {key === "missed_text" && v.missed_text ? (
              <div className="mt-2 ps-8">
                <label htmlFor="missed-message" className="mb-1 block text-[12px] font-medium text-muted">
                  {t("phone.auto.missedMessage")}
                </label>
                <Textarea id="missed-message" rows={2} dir="auto" maxLength={500} disabled={!canManage} placeholder={t("phone.auto.missedPlaceholder")} value={v.missed_message ?? ""} onChange={(e) => setV((x) => ({ ...x, missed_message: e.target.value }))} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="flex gap-2 text-[12px] leading-relaxed text-muted">
        <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {t("phone.auto.legal")}
      </p>
      {canManage ? (
        <Button size="sm" onClick={save} loading={pending} data-testid="phone-auto-save">
          <Save className="h-4 w-4" aria-hidden /> {t("phone.auto.save")}
        </Button>
      ) : null}
    </div>
  );
}
