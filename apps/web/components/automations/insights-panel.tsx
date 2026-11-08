"use client";

import { useMemo } from "react";
import { AlertOctagon, AlertTriangle, Brain, CheckCircle2, Clock, Filter, Lightbulb, Plus, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { analyzeAutomation, delayParts, describeFlow, suggestActions, type FlowNode, type Insight, type IntelAction, type IntelAgent, type IntelDraft } from "@scc/shared/automations";
import { useI18n } from "@/lib/i18n/client";
import { triggerLabel } from "@/lib/labels";
import { Badge, Card } from "@/components/ui/primitives";
import { intelT, type IntelT } from "@/components/automations/intel-i18n";
import { ScoreRing } from "@/components/automations/visuals";

export const MAX_ACTIONS = 20;

const SEVERITY_ICON = {
  error: <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />,
  warning: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />,
  tip: <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />,
  ok: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />,
} as const;
const SEVERITY_TEXT = { error: "text-danger", warning: "text-fg", tip: "text-muted", ok: "text-muted" } as const;
const GRADE_TONE = { excellent: "success", good: "accent", needsWork: "warning", risky: "danger" } as const;

function insightText(it: IntelT, i: Insight): string {
  const p: Record<string, string | number> = { ...(i.params ?? {}) };
  if (typeof p.field === "string") p.field = it(`f.${p.field}`);
  return it(`i.${i.code}`, p);
}

function delayText(it: IntelT, minutes: number): string {
  const d = delayParts(minutes);
  if (d.unit === "now") return it("p.immediately");
  const unit = { minutes: "p.min", hours: "p.hours", days: "p.days", weeks: "p.weeks" }[d.unit];
  return it("p.after", { t: it(unit, { value: d.value }) });
}

/**
 * Live "brain" of the builder: explains what the automation will do, scores it,
 * warns about logic problems (loops, missing records, unreachable conditions…) and
 * offers one-click smart additions. Read-only: it never alters the draft by itself.
 */
export function InsightsPanel({ draft, onAddAction, agents }: { draft: IntelDraft; onAddAction: (a: IntelAction) => void; agents?: readonly IntelAgent[] }) {
  const { t, locale } = useI18n();
  const it = useMemo(() => intelT(locale), [locale]);
  const analysis = useMemo(() => analyzeAutomation(draft, { agents }), [draft, agents]);
  const flow = useMemo(() => describeFlow(draft), [draft]);
  const suggestions = useMemo(() => suggestActions(draft), [draft]);
  const full = (draft.actions?.length ?? 0) >= MAX_ACTIONS;

  // worst severity per action → coloured dot on the flow timeline
  const worst = useMemo(() => {
    const rank = { error: 3, warning: 2, tip: 1, ok: 0 } as const;
    const m = new Map<number, Insight["severity"]>();
    for (const i of analysis.insights) {
      if (i.actionIndex == null) continue;
      const cur = m.get(i.actionIndex);
      if (!cur || rank[i.severity] > rank[cur]) m.set(i.actionIndex, i.severity);
    }
    return m;
  }, [analysis.insights]);
  const dot = (sev?: Insight["severity"]) => (sev === "error" ? "bg-danger" : sev === "warning" ? "bg-warning" : "bg-accent");

  const renderNode = (n: FlowNode, idx: number) => {
    if (n.kind === "trigger") {
      const cfg = Object.entries(n.config).filter(([, v]) => v);
      return (
        <li key={`t${idx}`} className="relative ps-7">
          <span className="absolute start-0 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-gold-soft text-gold">
            <Zap className="h-3 w-3" aria-hidden />
          </span>
          <p className="text-[11.5px] font-medium text-subtle">{it("p.flowTrigger")}</p>
          <p className="text-[13.5px] font-semibold">{triggerLabel(t, n.trigger)}</p>
          {cfg.length ? (
            <p className="mt-0.5 flex flex-wrap gap-1">
              {cfg.map(([k, v]) => (
                <code key={k} dir="ltr" className="rounded bg-elevated px-1.5 py-0.5 text-[11px]">
                  {k}={String(v).slice(0, 24)}
                </code>
              ))}
            </p>
          ) : null}
        </li>
      );
    }
    if (n.kind === "condition") {
      const field = t(`automations.fields.${n.field.replace(/\./g, "_")}`);
      return (
        <li key={`c${n.index}`} className="relative ps-7">
          <span className="absolute start-0 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-teal-soft text-teal">
            <Filter className="h-3 w-3" aria-hidden />
          </span>
          {n.index === 0 ? <p className="text-[11.5px] font-medium text-subtle">{it("p.flowIf")}</p> : null}
          <p className="text-[13px]">
            {field} <span className="text-muted">{t(`automations.ops.${n.op}`)}</span>
            {n.value ? <> <bdi className="font-medium">{n.value}</bdi></> : null}
          </p>
        </li>
      );
    }
    const sev = worst.get(n.index);
    return (
      <li key={`a${n.index}`} className="relative ps-7">
        <span className="absolute start-0 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">{n.index + 1}</span>
        {n.index === 0 ? <p className="text-[11.5px] font-medium text-subtle">{it("p.flowThen")}</p> : null}
        <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
          <span className="font-medium">{t(`automations.actions.${n.type}`)}</span>
          {n.delayMinutes > 0 ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <Clock className="h-3 w-3" aria-hidden /> {delayText(it, n.delayMinutes)}
            </span>
          ) : null}
          {sev && sev !== "ok" ? <span className={`h-2 w-2 rounded-full ${dot(sev)}`} aria-hidden /> : null}
        </p>
      </li>
    );
  };

  return (
    <Card className="p-5" data-testid="automation-insights">
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={analysis.score} label={it("p.score")} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <Brain className="h-4 w-4 text-accent" aria-hidden /> {it("p.insights")}
          </h2>
          <p className="text-[12.5px] text-subtle">{it("p.insightsHint")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone={GRADE_TONE[analysis.grade]}>{it(`g.${analysis.grade}`)}</Badge>
            {analysis.counts.error > 0 ? <Badge tone="danger">{it("p.errors")} · {analysis.counts.error}</Badge> : null}
            {analysis.counts.warning > 0 ? <Badge tone="warning">{it("p.warnings")} · {analysis.counts.warning}</Badge> : null}
            {analysis.counts.tip > 0 ? <Badge tone="accent">{it("p.tips")} · {analysis.counts.tip}</Badge> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <ul className="space-y-2" aria-live="polite">
            {analysis.insights.map((i, idx) => (
              <li key={`${i.code}-${idx}`} className={`flex gap-2 text-[13px] leading-relaxed ${SEVERITY_TEXT[i.severity]}`}>
                {SEVERITY_ICON[i.severity]}
                <span>{insightText(it, i)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">{it("p.flow")}</h3>
          <ol className="space-y-3">{flow.map(renderNode)}</ol>
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold">
            <Sparkles className="h-4 w-4 text-gold" aria-hidden /> {it("p.suggestions")}
          </h3>
          <p className="mb-2 text-[12px] text-subtle">{it("p.suggestionsHint")}</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {suggestions.map((s) => (
              <li key={s.code}>
                <button
                  type="button"
                  disabled={full}
                  title={full ? it("p.maxActions") : undefined}
                  onClick={() => {
                    onAddAction(s.action);
                    toast.success(it("p.added"));
                  }}
                  className="flex h-full w-full items-start gap-2 rounded-xl border border-line p-3 text-start transition-colors hover:border-accent hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{it(`s.${s.code}`)}</span>
                    <span className="block text-[12px] text-subtle">{it(`s.${s.code}.hint`)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
