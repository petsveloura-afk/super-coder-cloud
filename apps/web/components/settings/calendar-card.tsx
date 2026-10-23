"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { updateCalendarAction } from "@/app/[locale]/(dashboard)/settings/calendar-actions";

export interface CalendarConn {
  id: string;
  provider: "google" | "microsoft";
  account_email: string | null;
  push_events: boolean;
  block_busy: boolean;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
}

/** Wave 16 — connect MY Google / Outlook calendar (two-way). */
export function CalendarCard({ connections, configured, locked, status }: { connections: CalendarConn[]; configured: { google: boolean; microsoft: boolean }; locked: boolean; status?: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (input: Parameters<typeof updateCalendarAction>[0]) =>
    start(async () => {
      const r = await updateCalendarAction(input);
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        router.refresh();
      }
    });
  return (
    <div className="space-y-4 p-5" data-testid="calendar-card">
      <p className="text-[13px] text-muted">{t("calendar.hint")}</p>
      {status ? <p className={`text-[13px] ${status === "connected" ? "text-success" : "text-danger"}`}>{t(`calendar.status.${status}`)}</p> : null}
      {locked ? <p className="rounded-xl border border-gold/30 bg-gold-soft p-3 text-[13px]">{t("plans.locked.calendar_sync.body", { plan: t("billing.plans.pro.name") })}</p> : null}
      {connections.map((c) => (
        <div key={c.id} className="space-y-2 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent" />
            <span className="font-medium">{t(`calendar.providers.${c.provider}`)}</span>
            {c.account_email ? <bdi dir="ltr" className="text-[12.5px] text-muted">{c.account_email}</bdi> : null}
            <Badge tone={c.last_error ? "warning" : "success"}>{c.last_error ? t("calendar.error") : t("calendar.ok")}</Badge>
            <Button size="sm" variant="ghost" className="ms-auto" loading={pending} onClick={() => run({ locale, id: c.id, disconnect: true })}>
              <Unplug className="h-4 w-4" /> {t("calendar.disconnect")}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={c.push_events} onChange={(e) => run({ locale, id: c.id, push_events: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" /> {t("calendar.push")}
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={c.block_busy} onChange={(e) => run({ locale, id: c.id, block_busy: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" /> {t("calendar.block")}
          </label>
          <p className="text-[12px] text-subtle">{c.last_sync_at ? t("calendar.lastSync", { date: formatDateTime(locale, c.last_sync_at) }) : t("calendar.neverSynced")}</p>
        </div>
      ))}
      {!locked ? (
        <div className="flex flex-wrap gap-2">
          {(["google", "microsoft"] as const)
            .filter((p) => !connections.some((c) => c.provider === p))
            .map((p) =>
              configured[p] ? (
                <a key={p} href={`/api/calendar/${p}/start?locale=${locale}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium hover:bg-surface-hover" data-testid={`calendar-connect-${p}`}>
                  <CalendarDays className="h-4 w-4" /> {t("calendar.connect", { provider: t(`calendar.providers.${p}`) })}
                </a>
              ) : (
                <span key={p} className="text-[12.5px] text-subtle">
                  {t("calendar.notConfigured", { provider: t(`calendar.providers.${p}`) })}
                </span>
              ),
            )}
        </div>
      ) : null}
    </div>
  );
}
