"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { answerSurveyAction } from "@/app/[locale]/(public)/actions";

export function SurveyForm({ token, values, ends }: { token: string; values: number[]; ends: [string, string] }) {
  const { t } = useI18n();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) {
    return (
      <div className="mt-6 text-center" role="status">
        <p className="text-3xl">💙</p>
        <p className="mt-2 font-semibold">{t("surveys.thanks")}</p>
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-4" data-testid="survey-form">
      <div role="radiogroup" aria-label={t("surveys.pageTitle")} className="flex flex-wrap justify-center gap-1.5" dir="ltr">
        {values.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={score === v} onClick={() => setScore(v)} className={cn("h-11 min-w-11 rounded-xl border text-[15px] font-semibold transition", score === v ? "border-accent bg-accent-solid text-accent-fg shadow" : "border-line hover:bg-surface-hover")}>
            {v}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-subtle" dir="ltr">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
      <Textarea rows={3} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} placeholder={t("surveys.commentPh")} aria-label={t("surveys.commentPh")} dir="auto" />
      {err ? <p className="text-[13px] text-danger" role="alert">{t(err)}</p> : null}
      <Button
        className="w-full justify-center"
        disabled={score === null}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await answerSurveyAction({ token, score: score!, comment });
            if (r.error) setErr(r.error);
            else setDone(true);
          })
        }
      >
        {t("surveys.send")}
      </Button>
    </div>
  );
}
