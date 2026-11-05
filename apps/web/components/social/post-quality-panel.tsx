"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { COPY_FRAMEWORKS, polishPostCopy, postQuality, type CopyFramework } from "@/lib/social/post-quality";
import { rewritePostAction } from "@/app/[locale]/(dashboard)/social/copy-actions";

/**
 * Copy coach in the post editor: a live quality score with concrete tips (hook, length, lines, call to action,
 * hashtags…), a free "tidy up" that never changes the words, and a professional AI rewrite with a framework
 * (hook / AIDA / PAS / story / short / list). The previous text can always be brought back.
 */
export function PostQualityPanel({ body, setBody, ig }: { body: string; setBody: (v: string) => void; ig: boolean }) {
  const { t, locale } = useI18n();
  const platform = ig ? "instagram" : "facebook";
  const q = useMemo(() => postQuality(body, platform), [body, platform]);
  const [busy, setBusy] = useState<CopyFramework | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const ring = q.grade === "great" ? "text-emerald-500" : q.grade === "good" ? "text-amber-500" : "text-red-500";

  const rewrite = async (f: CopyFramework) => {
    setBusy(f);
    const r = await rewritePostAction({ locale, text: body, framework: f, platform });
    setBusy(null);
    if (r.error || !r.data) return void toast.error(t(r.error ?? "ai.failed"));
    setUndo(body);
    setBody(r.data.text);
    toast.success(t("social.quality.rewritten"));
  };
  const tidy = () => {
    const n = polishPostCopy(body);
    if (n === body.trim()) return void toast.success(t("social.quality.alreadyTidy"));
    setUndo(body);
    setBody(n);
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-elevated p-3" data-testid="post-quality">
      <div className="flex items-center gap-3">
        <div className={cn("relative grid h-14 w-14 shrink-0 place-items-center", ring)} aria-label={t("social.quality.score", { n: q.score })}>
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(q.score / 100) * 97.4} 97.4`} className="transition-[stroke-dasharray] duration-500" />
          </svg>
          <b className="text-[15px] text-fg" data-testid="post-quality-score">
            {q.score}
          </b>
        </div>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">{t(`social.quality.grade.${q.grade}`)}</p>
          <p className="text-[12px] text-muted">{t("social.quality.hint")}</p>
        </div>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {q.checks.map((c) => (
          <li key={c.key} className={cn("flex items-start gap-1.5 text-[12px]", c.ok ? "text-muted" : "text-fg")}>
            {c.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <span>{c.ok ? t(`social.quality.ok.${c.key}`) : t(`social.quality.tip.${c.key}`)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-[12px] font-semibold text-muted">{t("social.quality.rewrite")}</span>
        {COPY_FRAMEWORKS.map((f) => (
          <button key={f} type="button" disabled={Boolean(busy) || body.trim().length < 10} onClick={() => void rewrite(f)} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] transition hover:bg-surface-hover disabled:opacity-50" title={t(`social.quality.fwHint.${f}`)}>
            {busy === f ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {t(`social.quality.fw.${f}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={tidy} disabled={body.trim().length < 5}>
          {t("social.quality.tidy")}
        </Button>
        {undo !== null ? (
          <Button size="sm" variant="ghost" onClick={() => (setBody(undo), setUndo(null))}>
            {t("social.quality.undo")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
