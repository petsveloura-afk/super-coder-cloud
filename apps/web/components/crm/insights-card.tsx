"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Brain, Flame, Gauge, MessageCircleHeart, RefreshCw, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button } from "@/components/ui/primitives";
import { analyzeContactAction, refreshScoreAction } from "@/app/[locale]/(dashboard)/crm/insight-actions";
import { scoreBand } from "@/lib/crm/insights-core";

export interface InsightsData {
  lead_score: number | null;
  breakdown: Record<string, number>;
  sentiment: string | null;
  stage: string | null;
  ai: {
    intent?: string;
    next_action?: string;
    suggested_offer?: string;
    summary?: string;
    objections?: string;
    best_channel?: string;
    urgency?: string | null;
  };
  scored_at: string | null;
  analyzed_at: string | null;
}

const BAND_TONE = { hot: "danger", warm: "warning", cold: "teal", none: "neutral" } as const;

/** Wave 15 — lead score (explained), sentiment, buying stage and the AI's next best action. */
export function InsightsCard({ contactId, data, canAnalyze, aiLocked }: { contactId: string; data: InsightsData | null; canAnalyze: boolean; aiLocked: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"score" | "ai" | null>(null);
  const score = data?.lead_score ?? null;
  const band = scoreBand(score);
  const run = (kind: "score" | "ai") =>
    start(async () => {
      setBusy(kind);
      try {
        const r = kind === "score" ? await refreshScoreAction({ locale, contactId }) : await analyzeContactAction({ locale, contactId });
        if (r.error) toast.error(t(r.error));
        else {
          toast.success(t(r.message ?? "common.saved"));
          router.refresh();
        }
      } finally {
        setBusy(null);
      }
    });
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const ai = data?.ai ?? {};
  const rows: { icon: typeof Target; label: string; value?: string }[] = [
    { icon: Target, label: t("insights.nextAction"), value: ai.next_action },
    { icon: Sparkles, label: t("insights.offer"), value: ai.suggested_offer },
    { icon: Brain, label: t("insights.intent"), value: ai.intent },
    { icon: MessageCircleHeart, label: t("insights.objections"), value: ai.objections },
  ];
  return (
    <div className="space-y-4 p-5" data-testid="insights-card">
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(var(--brand) ${pct * 3.6}deg, var(--line) 0deg)` }}
          role="img"
          aria-label={t("insights.scoreAria", { score: score ?? "—" })}
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-surface text-xl font-bold" data-testid="lead-score">
            {score ?? "—"}
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={BAND_TONE[band]}>
              {band === "hot" ? <Flame className="h-3.5 w-3.5" /> : <Gauge className="h-3.5 w-3.5" />} {t(`insights.band.${band}`)}
            </Badge>
            {data?.sentiment ? <Badge tone={data.sentiment === "positive" ? "success" : data.sentiment === "negative" ? "danger" : "neutral"}>{t(`insights.sentiment.${data.sentiment}`)}</Badge> : null}
            {data?.stage ? <Badge tone="accent">{t(`insights.stage.${data.stage}`)}</Badge> : null}
            {ai.urgency ? <Badge tone={ai.urgency === "high" ? "danger" : ai.urgency === "medium" ? "warning" : "neutral"}>{t(`insights.urgency.${ai.urgency}`)}</Badge> : null}
          </div>
          {ai.summary ? <p className="text-[13px] leading-relaxed text-muted">{ai.summary}</p> : <p className="text-[13px] text-subtle">{t("insights.empty")}</p>}
        </div>
      </div>

      {data?.breakdown && Object.keys(data.breakdown).length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("insights.breakdown")}>
          {Object.entries(data.breakdown)
            .filter(([, v]) => typeof v === "number" && v !== 0)
            .map(([k, v]) => (
              <li key={k} className={`rounded-full border px-2 py-0.5 text-[11.5px] ${v > 0 ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger"}`}>
                {t(`insights.factors.${k}`)} <bdi dir="ltr">{v > 0 ? `+${v}` : v}</bdi>
              </li>
            ))}
        </ul>
      ) : null}

      {rows.some((r) => r.value) ? (
        <dl className="space-y-2.5">
          {rows
            .filter((r) => r.value)
            .map((r) => (
              <div key={r.label} className="flex gap-2.5 rounded-xl bg-elevated px-3 py-2.5">
                <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <dt className="text-[12px] font-medium text-muted">{r.label}</dt>
                  <dd className="text-sm leading-relaxed">{r.value}</dd>
                </div>
              </div>
            ))}
          {ai.best_channel ? <p className="text-[12.5px] text-muted">{t("insights.bestChannel", { channel: t(`insights.channels.${ai.best_channel}`) })}</p> : null}
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => run("score")} loading={pending && busy === "score"} data-testid="refresh-score">
          <RefreshCw className="h-4 w-4" /> {t("insights.refresh")}
        </Button>
        {canAnalyze ? (
          <Button size="sm" onClick={() => run("ai")} loading={pending && busy === "ai"} disabled={aiLocked} data-testid="analyze-contact" title={aiLocked ? t("plans.locked.ai_insights.title") : undefined}>
            <Brain className="h-4 w-4" /> {t("insights.analyze")}
          </Button>
        ) : null}
      </div>
      {aiLocked && canAnalyze ? <p className="text-[12px] text-subtle">{t("plans.locked.ai_insights.body", { plan: t("billing.plans.pro.name") })}</p> : null}
    </div>
  );
}
