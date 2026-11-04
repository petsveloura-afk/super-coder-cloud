"use client";

import { Activity, CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Card, Ltr } from "@/components/ui/primitives";
import { humanModelErrorKey } from "@/lib/team/model-health-core";
import type { TeamHealthData } from "./types";

/**
 * Team health (upgrade 2): one verdict, the AI models that are being skipped for a while (circuit breaker) and the
 * latest failures with a clear reason. Read-only — nothing here changes the team's behaviour.
 */
export function HealthPanel({ health }: { health: TeamHealthData }) {
  const { t } = useI18n();
  const tone = health.level === "ok" ? "success" : health.level === "degraded" ? "warning" : "danger";
  const Icon = health.level === "ok" ? CircleCheck : health.level === "degraded" ? CircleAlert : CircleX;
  return (
    <Card className="space-y-3 p-5" data-testid="team-health">
      <div className="flex flex-wrap items-center gap-3">
        <Activity className="h-6 w-6 text-muted" />
        <h3 className="min-w-0 flex-1 font-bold">{t("aiTeam.health.title")}</h3>
        <Badge tone={tone}>
          <Icon className="h-3.5 w-3.5" /> {t(`aiTeam.health.level.${health.level}`)}
        </Badge>
      </div>
      {health.issues.length ? (
        <ul className="list-disc space-y-1 ps-5 text-[12.5px] text-muted">
          {health.issues.map((i) => (
            <li key={i}>{t(`aiTeam.health.issue.${i}`)}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <h4 className="mb-1 text-[12.5px] font-semibold">{t("aiTeam.health.models")}</h4>
        {health.models.length ? (
          <ul className="space-y-1">
            {health.models.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <Ltr className="font-mono">{m.key}</Ltr>
                <Badge tone={m.circuit === "closed" ? "success" : m.circuit === "open" ? "danger" : "warning"}>{t(`aiTeam.health.circuit.${m.circuit}`)}</Badge>
                {m.circuit === "open" ? <span className="text-muted">{Math.max(1, Math.round(m.openForMs / 60_000))} {t("aiTeam.health.minutes")}</span> : null}
                {m.lastError && m.circuit !== "closed" ? <span className="truncate text-muted">{t(`aiTeam.health.err.${humanModelErrorKey(m.lastError)}`)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">{t("aiTeam.health.noModels")}</p>
        )}
      </div>
      <div>
        <h4 className="mb-1 text-[12.5px] font-semibold">{t("aiTeam.health.failures")}</h4>
        {health.failures.length ? (
          <ul className="space-y-1">
            {health.failures.map((f) => (
              <li key={f.id} className="text-[12.5px]">
                <span className="font-medium">{f.title}</span> · <span className="text-muted">{t(`aiTeam.health.reason.${f.reason}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">{t("aiTeam.health.noFailures")}</p>
        )}
      </div>
    </Card>
  );
}
