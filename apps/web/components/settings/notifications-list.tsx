"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { CleanupBar, SelectTick, useSelection } from "@/components/ui/cleanup";
import { deleteNotificationsAction, readNotificationsAction } from "@/app/[locale]/(dashboard)/settings/actions";

export interface NotificationRow {
  id: string;
  title_key: string;
  params: Record<string, string>;
  created_at: string;
  read_at: string | null;
  link?: string | null;
}

/**
 * The user's notifications with clean-up (additive): tick some or "select all" → delete them; "delete all"; "mark all read".
 * Only the signed-in user's own notifications are touched.
 */
export function NotificationsList({ rows, locale, when }: { rows: NotificationRow[]; locale: string; when: Record<string, string> }) {
  const { t } = useI18n();
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const shown = rows.filter((n) => !gone.has(n.id));
  const selection = useSelection(shown.map((n) => n.id));
  const unread = shown.filter((n) => !n.read_at).length;

  const remove = (ids: string[] | "all") => {
    const before = gone;
    setGone(new Set([...gone, ...(ids === "all" ? shown.map((n) => n.id) : ids)]));
    start(async () => {
      const r = await deleteNotificationsAction(ids === "all" ? { locale, all: true } : { locale, ids });
      if (r.error) {
        setGone(before);
        toast.error(t(r.error));
      } else {
        toast.success(t("cleanup.deleted"));
        router.refresh();
      }
    });
  };

  return (
    <div className="px-5 pt-3" data-testid="notifications-list">
      <CleanupBar
        count={shown.length}
        selection={selection}
        deleteMode
        busy={pending}
        onHideSelected={(ids) => remove(ids)}
        onClearAll={() => remove("all")}
        extra={
          unread ? (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] font-medium text-muted transition hover:bg-surface-hover hover:text-fg"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await readNotificationsAction({ locale, all: true });
                  if (r.error) toast.error(t(r.error));
                  router.refresh();
                })
              }
              data-testid="notifications-read-all"
            >
              <CheckCheck className="h-3.5 w-3.5" /> {t("cleanup.markAllRead")}
            </button>
          ) : null
        }
      />
      {!shown.length ? <p className="py-4 text-center text-[13px] text-subtle">{t("common.noNotifications")}</p> : null}
      <ul className="divide-y divide-line">
        {shown.map((n) => (
          <li key={n.id} className="flex items-center gap-3 py-3 text-sm">
            {selection.on ? <SelectTick checked={selection.isSelected(n.id)} onChange={() => selection.toggle(n.id)} label={t(n.title_key, n.params)} /> : null}
            {!n.read_at ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : <span className="h-2 w-2 shrink-0" />}
            {n.link && /^\/[a-z]/.test(n.link) ? (
              <Link href={`/${locale}${n.link}`} className="flex-1 hover:text-accent hover:underline">
                {t(n.title_key, n.params)}
              </Link>
            ) : (
              <span className="flex-1">{t(n.title_key, n.params)}</span>
            )}
            <span className="text-[12px] text-subtle">{when[n.id]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
