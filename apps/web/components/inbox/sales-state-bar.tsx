"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { FUNNEL_PATH, SALES_STATES, funnelRank, type SalesState } from "@/lib/ai/sales-state-core";
import { setSalesStateAction } from "@/app/[locale]/(dashboard)/inbox/sales-state-actions";

/**
 * Wave 55 — where this conversation is in the sales funnel (tracked by the AI agent after every
 * reply), with a one-click manual override for the team.
 */
export function SalesStateBar({ conversationId, state, canEdit }: { conversationId: string; state: SalesState | null; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState<SalesState | null>(state);
  const [pending, start] = useTransition();
  const current = value ?? "NEW_LEAD";
  const rank = funnelRank(current);
  const change = (next: SalesState) =>
    start(async () => {
      const prev = value;
      setValue(next);
      const r = await setSalesStateAction({ locale, conversationId, state: next });
      if (r.error) {
        setValue(prev);
        toast.error(t(r.error));
        return;
      }
      toast.success(t(r.message ?? "sales.saved"));
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2" data-testid="sales-state" data-state={current}>
      <span className="text-[12px] font-medium text-muted">{t("sales.title")}</span>
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label={t("sales.title")}>
        {FUNNEL_PATH.map((s, i) => {
          const done = funnelRank(s) < rank && current !== "HUMAN_HANDOFF";
          const here = s === current;
          return (
            <li key={s} className="flex shrink-0 items-center gap-1">
              {i > 0 ? <span className={cn("h-px w-3", done || here ? "bg-accent" : "bg-line")} aria-hidden /> : null}
              <span
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]",
                  here ? "bg-accent-solid font-semibold text-accent-fg" : done ? "bg-accent-soft text-accent" : "bg-elevated text-muted",
                )}
                aria-current={here ? "step" : undefined}
              >
                {done ? <Check className="h-3 w-3" aria-hidden /> : null}
                {t(`sales.state.${s}`)}
              </span>
            </li>
          );
        })}
        {current === "OBJECTION_HANDLING" || current === "HUMAN_HANDOFF" ? (
          <li className="ms-1 shrink-0">
            <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold", current === "HUMAN_HANDOFF" ? "bg-warning-soft text-warning" : "bg-gold-soft text-gold")} aria-current="step">
              {t(`sales.state.${current}`)}
            </span>
          </li>
        ) : null}
      </ol>
      {canEdit ? (
        <label className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          <span className="sr-only">{t("sales.change")}</span>
          <select
            value={current}
            disabled={pending}
            onChange={(e) => change(e.target.value as SalesState)}
            className="h-8 rounded-lg border border-line bg-elevated px-2 text-[12px] text-fg"
            data-testid="sales-state-select"
            aria-label={t("sales.change")}
          >
            {SALES_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`sales.state.${s}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
