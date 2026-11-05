"use client";

import { HeartPulse } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Card, Ltr } from "@/components/ui/primitives";
import type { DayHealthView } from "./types";

/** Wave 68 — today's health for the owner: tasks that worked, tasks that failed and why, which AI provider is healthy. Read-only. */
export function DayHealthCard({ day }: { day: DayHealthView }) {
  const { t } = useI18n();
  const tone = (s: string) => (s === "healthy" ? "success" : s === "shaky" ? "warning" : s === "degraded" ? "danger" : "neutral");
  return (
    <Card className="space-y-3 p-5" data-testid="team-day-health">
      <div className="flex flex-wrap items-center gap-3">
        <HeartPulse className="h-6 w-6 text-muted" />
        <h3 className="min-w-0 flex-1 font-bold">{t("aiTeam.dayHealth.title")}</h3>
        <span className="text-[12px] text-muted">{t("aiTeam.dayHealth.window")}</span>
      </div>
      {day.done + day.failed === 0 ? (
        <p className="text-[12.5px] text-muted">{t("aiTeam.dayHealth.quiet")}</p>
      ) : (
        <div className="flex flex-wrap gap-3 text-[13px]">
          <Badge tone="success">{t("aiTeam.dayHealth.done")}: {day.done}</Badge>
          <Badge tone={day.failed ? "danger" : "neutral"}>{t("aiTeam.dayHealth.failed")}: {day.failed}</Badge>
        </div>
      )}
      {day.reasons.length ? (
        <div>
          <h4 className="mb-1 text-[12.5px] font-semibold">{t("aiTeam.dayHealth.reasons")}</h4>
          <ul className="space-y-1 text-[12.5px]">
            {day.reasons.map((r) => (
              <li key={r.code}>
                {t(`aiTeam.health.reason.${r.code}`)} <span className="text-muted">×{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {day.showProviders === false ? null : (
      <div>
        <h4 className="mb-1 text-[12.5px] font-semibold">{t("aiTeam.dayHealth.providers")}</h4>
        {day.providers.length ? (
          <ul className="space-y-1">
            {day.providers.map((p) => (
              <li key={p.provider} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <Ltr className="font-mono">{p.provider}</Ltr>
                <Badge tone={tone(p.status)}>{t(`aiTeam.dayHealth.status.${p.status}`)}</Badge>
                {p.successPct != null ? <span className="text-muted">{p.successPct}% · {p.calls} {t("aiTeam.dayHealth.calls")}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">{t("aiTeam.dayHealth.noProviders")}</p>
        )}
        <p className="mt-1 text-[11.5px] text-subtle">{t("aiTeam.dayHealth.providersNote")}</p>
      </div>
      )}
    </Card>
  );
}
