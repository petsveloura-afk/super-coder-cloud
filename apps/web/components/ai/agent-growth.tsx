"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BrainCircuit, Check, GraduationCap, Lightbulb, RefreshCw, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Textarea } from "@/components/ui/primitives";
import { coachNowAction, decideLearningAction } from "@/app/[locale]/(dashboard)/ai-agents/growth-actions";

export interface LearningItem {
  id: string;
  question: string;
  answer: string;
  created_at: string;
}

/** Wave 59 — "the agent learned from you": approve (optionally edit) → the answer joins the agent's FAQ. */
export function LearningInbox({ items }: { items: LearningItem[] }) {
  const { t, locale } = useI18n();
  const [list, setList] = useState(items);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const decide = (id: string, approve: boolean) =>
    start(async () => {
      const it = list.find((x) => x.id === id);
      const r = await decideLearningAction({ locale, id, approve, answer: edits[id] ?? it?.answer });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      setList((l) => l.filter((x) => x.id !== id));
    });
  if (!list.length) return <p className="px-5 pb-5 text-[13px] text-muted">{t("learn.empty")}</p>;
  return (
    <ul className="stagger divide-y divide-line" data-testid="learning-inbox">
      {list.map((it) => (
        <li key={it.id} className="space-y-2 px-5 py-4">
          <p className="text-[13px]">
            <span className="font-semibold text-accent">{t("learn.question")}: </span>
            <span dir="auto">{it.question}</span>
          </p>
          <label htmlFor={`learn-${it.id}`} className="block text-[12px] font-medium text-muted">
            {t("learn.answer")}
          </label>
          <Textarea id={`learn-${it.id}`} rows={2} dir="auto" value={edits[it.id] ?? it.answer} onChange={(e) => setEdits((m) => ({ ...m, [it.id]: e.target.value }))} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={pending} onClick={() => decide(it.id, true)}>
              <Check className="h-4 w-4" aria-hidden /> {t("learn.approve")}
            </Button>
            <Button size="sm" variant="ghost" loading={pending} onClick={() => decide(it.id, false)}>
              <X className="h-4 w-4" aria-hidden /> {t("learn.dismiss")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface CoachView {
  week: string;
  stats: { conversations: number; leads: number; handoffs: number; lost: number; conversion: number };
  insights: { summary?: string; reasons?: { reason: string; count: number; fix: string }[]; tips?: string[] };
}

/** Wave 59 — the weekly AI coach: the week's numbers, why conversations did not close, how to fix the script. */
export function CoachCard({ report, setupHref, canRun }: { report: CoachView | null; setupHref: string | null; canRun: boolean }) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await coachNowAction({ locale });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      window.location.reload();
    });
  const tiles = report
    ? [
        { k: "coach.stats.conversations", v: String(report.stats.conversations) },
        { k: "coach.stats.leads", v: String(report.stats.leads) },
        { k: "coach.stats.conversion", v: `${Math.round(report.stats.conversion * 100)}%` },
        { k: "coach.stats.lost", v: String(report.stats.lost) },
      ]
    : [];
  return (
    <div className="space-y-4 p-5" data-testid="coach-card">
      {report ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((x, i) => (
              <div key={x.k} className="num-pop rounded-2xl border border-line bg-elevated/50 p-3 text-center" style={{ animationDelay: `${i * 70}ms` }}>
                <p className="text-[22px] font-bold tabular-nums">{x.v}</p>
                <p className="text-[12px] text-muted">{t(x.k)}</p>
              </div>
            ))}
          </div>
          {report.insights.summary ? (
            <p className="flex gap-2 rounded-2xl bg-accent-soft/40 p-3 text-[13.5px] leading-relaxed" dir="auto">
              <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /> {report.insights.summary}
            </p>
          ) : null}
          {report.insights.reasons?.length ? (
            <ul className="stagger space-y-2">
              {report.insights.reasons.map((r, i) => (
                <li key={i} className="rounded-2xl border border-line p-3 text-[13px]">
                  <p className="flex items-center gap-2 font-semibold" dir="auto">
                    <TrendingUp className="h-4 w-4 text-warning" aria-hidden /> {r.reason} <span className="text-[12px] font-normal text-muted">×{r.count}</span>
                  </p>
                  <p className="mt-1 text-muted" dir="auto">
                    <span className="font-medium text-fg">{t("coach.fix")}: </span>
                    {r.fix}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {report.insights.tips?.length ? (
            <ul className="space-y-1">
              {report.insights.tips.map((tip, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-muted" dir="auto">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden /> {tip}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[12px] text-muted">{t("coach.week", { date: new Date(report.week).toLocaleDateString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL") })}</p>
        </>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <GraduationCap className="h-4 w-4 text-accent" aria-hidden /> {t("coach.empty")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {setupHref ? (
          <Link href={setupHref} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-accent/30 bg-accent-soft px-3 text-[13px] font-semibold text-accent hover:brightness-110">
            {t("coach.fixScript")}
          </Link>
        ) : null}
        {canRun ? (
          <Button size="sm" variant="secondary" loading={pending} onClick={run} data-testid="coach-run">
            <RefreshCw className="h-4 w-4" aria-hidden /> {t("coach.runNow")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
