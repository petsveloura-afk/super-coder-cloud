"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { closeServiceConversationsAction } from "@/app/[locale]/(dashboard)/inbox/robots-actions";

/** "N automatic messages — close them" (two-step, no browser dialog). The server checks every id again. */
export function CloseRobotsButton({ ids }: { ids: string[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();
  if (!ids.length) return null;
  const go = () =>
    start(async () => {
      const r = await closeServiceConversationsAction({ locale, ids });
      setAsk(false);
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved", r.messageParams));
        router.refresh();
      }
    });
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]" data-testid="inbox-robots">
      <Bot className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
      <span className="flex-1 text-muted">{t("inbox.robots.count", { n: ids.length })}</span>
      {ask ? (
        <button type="button" disabled={pending} onClick={go} className="rounded-full border border-danger/40 px-3 py-1 font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50" data-testid="inbox-robots-confirm">
          {t("inbox.robots.confirm", { n: ids.length })}
        </button>
      ) : (
        <button type="button" onClick={() => setAsk(true)} className="rounded-full border border-line px-3 py-1 font-medium text-muted transition hover:bg-surface-hover hover:text-fg" data-testid="inbox-robots-close">
          {t("inbox.robots.close")}
        </button>
      )}
    </div>
  );
}
