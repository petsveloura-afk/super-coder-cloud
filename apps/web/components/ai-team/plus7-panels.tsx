"use client";

import { useState } from "react";
import { Beaker, FileText, Gauge, MessageSquareQuote, Target } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { decisionFeedbackAction, experimentStatusAction, goalStatusAction, saveGoalAction } from "@/app/[locale]/(dashboard)/ai-team/plus7-actions";
import { GOAL_METRIC_KEYS, goalCard, type Lang } from "@/lib/team/goals-core";
import { analyze, analysisLine } from "@/lib/team/experiments-core";
import { explainDecision } from "@/lib/team/transparency-core";
import { optimistic } from "@/lib/team/speed-core";
import type { TeamPlus7Data } from "./types";

const lang = (l: string): Lang => (l === "en" || l === "ar" ? l : "he");
const tone = (r: string) => (r === "achieved" || r === "on_track" ? "success" : r === "at_risk" ? "warning" : r === "off_track" || r === "expired" ? "danger" : "neutral");

/** Goals (stage C): progress, the honest forecast range, risk badge. Optimistic: status changes show at once and roll back on error. */
export function GoalsCard({ data, canManage, locale, onRefresh }: { data: TeamPlus7Data; canManage: boolean; locale: string; onRefresh: () => void }) {
  const { t } = useI18n();
  const l = lang(locale);
  const [items, setItems] = useState(data.goals ?? []);
  const [seen, setSeen] = useState(data.goals);
  if (seen !== data.goals) {
    setSeen(data.goals);
    setItems(data.goals ?? []);
  }
  const [form, setForm] = useState({ title: "", metric: "leads_new", target: "", due: "" });
  const [busy, setBusy] = useState(false);

  const setStatus = async (id: string, status: "active" | "paused") => {
    const r = await optimistic(() => items, setItems, (s) => s.map((x) => (x.goal.id === id ? { ...x, goal: { ...x.goal, status } } : x)), () => goalStatusAction({ locale, id, status }));
    if (!r.ok) return toast.error(t(r.error.includes(".") ? r.error : "common.error"));
    onRefresh();
  };
  const add = async () => {
    const target = Number(form.target);
    if (form.title.trim().length < 3 || !Number.isFinite(target) || !/^\d{4}-\d{2}-\d{2}$/.test(form.due)) return toast.error(t("validation.invalid"));
    setBusy(true);
    try {
      const r = await saveGoalAction({ locale, title: form.title, metric: form.metric, target, dueDate: form.due });
      if (r.error) return toast.error(t(r.error));
      toast.success(r.data?.line ?? t("common.saved"));
      setForm({ title: "", metric: form.metric, target: "", due: "" });
      onRefresh();
    } catch (e) {
      console.error("[ai-team] goal save failed", e);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-4 p-5" data-testid="goals-card">
      <div className="flex items-center gap-3">
        <Target className="h-6 w-6 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{t("aiTeam.plus7.goals.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("aiTeam.plus7.goals.about")}</p>
        </div>
      </div>
      {!items.length ? <p className="text-[13px] text-muted">{t("aiTeam.plus7.goals.empty")}</p> : null}
      <ul className="space-y-3">
        {items.map(({ goal, forecast }) => {
          const c = goalCard(goal, forecast, l);
          return (
            <li key={goal.id} className="rounded-2xl border border-line p-3" data-testid="goal-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{goal.title}</span>
                <Badge tone={tone(c.risk)}>{c.riskText}</Badge>
                {goal.status === "proposed" ? <Badge tone="accent">{t("aiTeam.plus7.goals.proposed")}</Badge> : null}
                {goal.status === "paused" ? <Badge tone="neutral">{t("aiTeam.plus7.goals.paused")}</Badge> : null}
                <span className="flex-1" />
                <span className="text-[12px] text-subtle">{t("aiTeam.plus7.goals.daysLeft", { n: c.daysLeft })}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuenow={c.progressPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-accent-solid transition-all" style={{ width: `${c.progressPct}%` }} />
              </div>
              <p className="mt-2 text-[12.5px] text-muted">
                {t(`aiTeam.plus7.metrics.${goal.metric}`)}: {Math.round(forecast.current * 10) / 10} → {goal.target} · {c.line}
              </p>
              {canManage && (goal.status === "proposed" || goal.status === "paused" || goal.status === "active") ? (
                <div className="mt-2">
                  <Button variant="ghost" onClick={() => setStatus(goal.id, goal.status === "active" ? "paused" : "active")}>
                    {goal.status === "active" ? t("aiTeam.plus7.goals.pause") : t("aiTeam.plus7.goals.activate")}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canManage ? (
        <div className="grid gap-2 sm:grid-cols-5" data-testid="goal-form">
          <Input className="sm:col-span-2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("aiTeam.plus7.goals.name")} />
          <Select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} aria-label={t("aiTeam.plus7.goals.metric")}>
            {GOAL_METRIC_KEYS.map((m) => (
              <option key={m} value={m}>
                {t(`aiTeam.plus7.metrics.${m}`)}
              </option>
            ))}
          </Select>
          <Input type="number" inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder={t("aiTeam.plus7.goals.target")} />
          <Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} aria-label={t("aiTeam.plus7.goals.due")} />
          <Button className="sm:col-span-5" onClick={add} disabled={busy}>
            {t("aiTeam.plus7.goals.save")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Experiments (stage F): the honest verdict — "not enough data" is shown as a normal state. */
export function ExperimentsCard({ data, canManage, locale, onRefresh }: { data: TeamPlus7Data; canManage: boolean; locale: string; onRefresh: () => void }) {
  const { t } = useI18n();
  const l = lang(locale);
  const rows = data.experiments ?? [];
  const act = async (id: string, status: "running" | "stopped") => {
    const r = await experimentStatusAction({ locale, id, status });
    if (r.error) return toast.error(t(r.error));
    onRefresh();
  };
  return (
    <Card className="space-y-3 p-5" data-testid="experiments-card">
      <div className="flex items-center gap-3">
        <Beaker className="h-6 w-6 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{t("aiTeam.plus7.exp.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("aiTeam.plus7.exp.about")}</p>
        </div>
      </div>
      {!rows.length ? <p className="text-[13px] text-muted">{t("aiTeam.plus7.exp.empty")}</p> : null}
      <ul className="space-y-2">
        {rows.map((e) => (
          <li key={e.id} className="rounded-2xl border border-line p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{e.title}</span>
              <Badge tone="neutral">{e.metric}</Badge>
              <Badge tone={e.status === "running" ? "success" : "accent"}>{t(`aiTeam.plus7.exp.status.${e.status}`)}</Badge>
            </div>
            <p className="mt-1 text-muted">{e.hypothesis}</p>
            {e.status === "running" || e.status === "concluded" ? <p className="mt-1 text-[12.5px]">{analysisLine(analyze(e), e, l)}</p> : null}
            {canManage && e.status !== "concluded" ? (
              <div className="mt-2">
                <Button variant="ghost" onClick={() => act(e.id, e.status === "running" ? "stopped" : "running")}>
                  {e.status === "running" ? t("aiTeam.plus7.exp.stop") : t("aiTeam.plus7.exp.start")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "Why did I do this" (stage J): built from the decision record only, with the owner's verdict and correction. */
export function WhyPanel({ data, canManage, locale, onRefresh }: { data: TeamPlus7Data; canManage: boolean; locale: string; onRefresh: () => void }) {
  const { t } = useI18n();
  const l = lang(locale);
  const rows = data.decisions ?? [];
  const [fix, setFix] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const send = async (id: string, result: "good" | "bad") => {
    setDone({ ...done, [id]: true });
    try {
      const r = await decisionFeedbackAction({ locale, id, result, correction: result === "bad" ? fix[id] : undefined });
      if (r.error) {
        setDone({ ...done, [id]: false });
        return toast.error(t(r.error));
      }
      toast.success(r.data?.lessonProposed ? t("aiTeam.plus7.why.thanks") : t("common.saved"));
      onRefresh();
    } catch (e) {
      console.error("[ai-team] decision feedback failed", e);
      setDone({ ...done, [id]: false });
      toast.error(t("common.error"));
    }
  };
  return (
    <Card className="space-y-3 p-5" data-testid="why-panel">
      <div className="flex items-center gap-3">
        <MessageSquareQuote className="h-6 w-6 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{t("aiTeam.plus7.why.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("aiTeam.plus7.why.about")}</p>
        </div>
      </div>
      {!rows.length ? <p className="text-[13px] text-muted">{t("aiTeam.plus7.why.empty")}</p> : null}
      <ul className="space-y-2">
        {rows.map((r) => {
          const ex = explainDecision({ ...r.record, route: r.route, route_reasons: r.route_reasons, confidence: r.confidence, raw_confidence: r.record.raw_confidence }, l);
          return (
            <li key={r.id} className="rounded-2xl border border-line p-3 text-[13px]" data-testid="why-row">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.record.decided || r.record.understood}</span>
                  <Badge tone={r.route === "deep" ? "warning" : "neutral"}>{t(r.route === "deep" ? "aiTeam.plus7.why.deep" : "aiTeam.plus7.why.fast")}</Badge>
                  <Badge tone="accent">{ex.confidencePct}%</Badge>
                  {ex.rawConfidencePct !== null ? <span className="text-[11.5px] text-subtle">{t("aiTeam.plus7.why.calibrated", { n: ex.rawConfidencePct })}</span> : null}
                </summary>
                {ex.routeWhy.length ? (
                  <p className="mt-2 text-[12px] text-subtle">
                    {t("aiTeam.plus7.why.routeWhy")}: {ex.routeWhy.join(" · ")}
                  </p>
                ) : null}
                <dl className="mt-2 space-y-2">
                  {ex.sections.map((s) => (
                    <div key={s.key}>
                      <dt className="text-[12px] font-semibold text-muted">{s.label}</dt>
                      {s.lines.map((line, i) => (
                        <dd key={i}>{line}</dd>
                      ))}
                    </div>
                  ))}
                </dl>
                {canManage && !done[r.id] ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <Input value={fix[r.id] ?? ""} onChange={(e) => setFix({ ...fix, [r.id]: e.target.value })} placeholder={t("aiTeam.plus7.why.correction")} />
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => send(r.id, "good")}>
                        {t("aiTeam.plus7.why.good")}
                      </Button>
                      <Button variant="ghost" onClick={() => send(r.id, "bad")}>
                        {t("aiTeam.plus7.why.bad")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </details>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The morning brief, the stand-up and the latest weekly report (stages G + H). */
export function ReportsCard({ data }: { data: TeamPlus7Data }) {
  const { t } = useI18n();
  if (!data.report && !data.brief && !data.standup?.length) return null;
  return (
    <Card className="space-y-3 p-5" data-testid="reports-card">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{t("aiTeam.plus7.reports.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("aiTeam.plus7.reports.about")}</p>
        </div>
      </div>
      {data.brief ? <pre className="whitespace-pre-wrap rounded-2xl bg-surface-hover p-3 text-[13px] font-sans">{data.brief.text}</pre> : null}
      {data.standup?.length ? (
        <div>
          <h4 className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold">
            <Gauge className="h-4 w-4 text-muted" /> {t("aiTeam.plus7.reports.standup")}
          </h4>
          <ul className="space-y-1 text-[13px]">
            {data.standup.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.report ? (
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold">
            {data.report.title} · {data.report.period_start}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-[13px] font-sans">{data.report.text}</pre>
        </details>
      ) : null}
    </Card>
  );
}
