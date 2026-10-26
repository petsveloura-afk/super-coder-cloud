"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Brain, CheckCircle2, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { saveAgentAction } from "@/app/[locale]/(dashboard)/agents/actions";
import { agentHealth, recommendations, teamScore, type HealthLevel, type Recommendation } from "@/lib/agents/intelligence";
import type { AgentView } from "./agents-hub";

/**
 * Wave 27 — the team's brain: one score for the whole AI team, a health chip per agent and
 * the next best actions, each applicable in a click (the same save the cards use).
 */
const TONE: Record<HealthLevel, "success" | "neutral" | "warning" | "danger"> = { great: "success", ok: "neutral", attention: "warning", off: "neutral" };
const SEV: Record<Recommendation["severity"], string> = { high: "bg-danger-soft text-danger", medium: "bg-warning-soft text-warning", low: "bg-accent-soft text-accent" };

export function AgentsBrain({ agents, canManage }: { agents: AgentView[]; canManage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const snaps = agents.map((a) => ({ key: a.key, enabled: a.enabled, config: a.config, lastRunAt: a.lastRunAt, runs: a.runs }));
  const score = teamScore(snaps);
  const recs = recommendations(snaps);

  const apply = (r: Recommendation) => {
    const a = agents.find((x) => x.key === r.agent);
    if (!a || !r.apply) return;
    setBusy(r.id);
    start(async () => {
      const res = await saveAgentAction({ locale, agent: a.key, enabled: r.apply?.enabled ?? a.enabled, config: { ...a.config, ...(r.apply?.config ?? {}) } });
      setBusy(null);
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t(res.message ?? "common.saved"));
        router.refresh();
      }
    });
  };

  return (
    <Card className="mb-4 space-y-4 p-4 sm:p-5" data-testid="agents-brain">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Brain className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold">{t("agents.brain.title")}</h2>
          <p className="text-[12.5px] text-muted">{t("agents.brain.subtitle")}</p>
        </div>
        <div className="w-full sm:w-56">
          <div className="mb-1 flex items-baseline justify-between text-[12px] text-muted">
            <span>{t("agents.brain.score")}</span>
            <span className="text-base font-bold text-fg tabular-nums" data-testid="team-score">
              {score}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-elevated" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label={t("agents.brain.score")}>
            <div className={cn("h-full rounded-full transition-[width] duration-700", score >= 75 ? "bg-success" : score >= 40 ? "bg-accent" : "bg-warning")} style={{ width: `${score}%` }} />
          </div>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {agents.map((a) => {
          const h = agentHealth({ key: a.key, enabled: a.enabled, config: a.config, lastRunAt: a.lastRunAt, runs: a.runs });
          return (
            <li key={a.key} className="min-w-0 rounded-xl border border-line/70 p-2.5" data-health={`${a.key}:${h.level}`}>
              <p className="truncate text-[12.5px] font-semibold">{t(`agents.${a.key}.title`)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={TONE[h.level]}>{t(`agents.brain.level.${h.level}`)}</Badge>
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-subtle">{t(`agents.brain.reason.${h.reason}`)}</p>
            </li>
          );
        })}
      </ul>

      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
          <Lightbulb className="h-4 w-4 text-accent" /> {t("agents.brain.next")}
        </h3>
        {recs.length ? (
          <ol className="space-y-2" data-testid="agents-recs">
            {recs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line/70 p-2.5" data-rec={r.id}>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", SEV[r.severity])}>{t(`agents.brain.sev.${r.severity}`)}</span>
                <p className="min-w-0 flex-1 text-[13px] leading-snug">{t(r.textKey)}</p>
                {canManage && r.apply ? (
                  <Button size="sm" variant="secondary" loading={pending && busy === r.id} onClick={() => apply(r)}>
                    {t("agents.brain.apply")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <CheckCircle2 className="h-4 w-4 text-success" /> {t("agents.brain.allGood")}
          </p>
        )}
      </div>
    </Card>
  );
}
