"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Sparkles, Square, Trophy, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input, Textarea } from "@/components/ui/primitives";
import { aiAbVariantAction, improveCopyAction, saveAbTestAction, stopAbTestAction } from "@/app/[locale]/(dashboard)/websites/growth-actions";
import { abWinner, confidence, rate, zScore, type AbStats, type SiteAb } from "@/lib/site/ab-core";

/** Wave 17 — "✨ improve" under a text field of the site editor (AI copywriting, review before saving). */
export function ImproveCopyButton({ value, field, onChange }: { value: string; field: string; onChange: (v: string) => void }) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [prev, setPrev] = useState<string | null>(null);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await improveCopyAction({ locale, text: value, field });
            if (res.error || !res.data) {
              toast.error(t(res.error ?? "errors.generic"));
              return;
            }
            setPrev(value);
            onChange(res.data.text);
          })
        }
      >
        <Wand2 className="h-3.5 w-3.5" /> {pending ? t("websites.copy.working") : t("websites.copy.improve")}
      </button>
      {prev !== null ? (
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-hover"
          onClick={() => {
            onChange(prev);
            setPrev(null);
          }}
        >
          {t("websites.copy.undo")}
        </button>
      ) : null}
    </div>
  );
}

/** Wave 17 — A/B test of the hero: variant B, live results and the automatic winner. */
export function AbTestCard({ siteId, ab, stats, hero, allowed, aiAllowed }: { siteId: string; ab: SiteAb | null; stats: AbStats | null; hero: { title: string; subtitle: string; cta_label: string } | null; allowed: boolean; aiAllowed: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState({ title: ab?.title ?? "", subtitle: ab?.subtitle ?? "", cta_label: ab?.cta_label ?? "", min_views: String(ab?.min_views ?? 100) });
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const running = Boolean(ab?.active && !ab?.winner);
  const s = stats ?? { a_views: 0, b_views: 0, a_conv: 0, b_conv: 0 };
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const w = abWinner(s, Number(v.min_views) || 100);
  const conf = Math.min(99.9, confidence(zScore(s)));

  const save = (startTest: boolean) =>
    start(async () => {
      const res = await saveAbTestAction({ locale, siteId, data: v, start: startTest });
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t(res.message ?? "common.saved"));
        router.refresh();
      }
    });
  const stop = (keep?: "a" | "b") =>
    start(async () => {
      const res = await stopAbTestAction({ locale, siteId, keep });
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t(res.message ?? "common.saved"));
        router.refresh();
      }
    });

  return (
    <Card className="space-y-4 p-5" data-testid="ab-test-card">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <FlaskConical className="h-4 w-4 text-accent" /> {t("abtest.title")}
          {running ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">{t("abtest.running")}</span> : null}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted">{t("abtest.hint")}</p>
      </div>
      {!allowed ? (
        <p className="rounded-xl border border-line bg-elevated p-3 text-[13px]">{t("plans.locked.ab_testing.title")}</p>
      ) : !hero ? (
        <p className="text-[13px] text-muted">{t("abtest.needHero")}</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-line p-3 text-[13px]">
              <p className="mb-1 font-medium">{t("abtest.variantA")}</p>
              <p className="font-semibold">{hero.title}</p>
              {hero.subtitle ? <p className="text-muted">{hero.subtitle}</p> : null}
              {hero.cta_label ? <p className="mt-1 text-accent">[{hero.cta_label}]</p> : null}
            </div>
            <div className="space-y-2 rounded-xl border border-accent/40 p-3">
              <p className="text-[13px] font-medium">{t("abtest.variantB")}</p>
              <Input aria-label={t("websites.fields.title")} placeholder={hero.title} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value.slice(0, 160) })} disabled={running} />
              <Textarea aria-label={t("websites.fields.subtitle")} rows={2} placeholder={hero.subtitle} value={v.subtitle} onChange={(e) => setV({ ...v, subtitle: e.target.value.slice(0, 500) })} disabled={running} />
              <Input aria-label={t("websites.fields.cta_label")} placeholder={hero.cta_label} value={v.cta_label} onChange={(e) => setV({ ...v, cta_label: e.target.value.slice(0, 60) })} disabled={running} />
              {aiAllowed && !running ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={aiPending}
                  onClick={() =>
                    startAi(async () => {
                      const res = await aiAbVariantAction({ locale, siteId });
                      if (res.error || !res.data) toast.error(t(res.error ?? "errors.generic"));
                      else setV({ ...v, ...res.data });
                    })
                  }
                >
                  <Sparkles className="h-4 w-4" /> {t("abtest.aiVariant")}
                </Button>
              ) : null}
            </div>
          </div>
          <Field label={t("abtest.minViews")} htmlFor="ab-min" hint={t("abtest.minViewsHint")} className="max-w-xs">
            <Input id="ab-min" type="number" min={30} value={v.min_views} onChange={(e) => setV({ ...v, min_views: e.target.value })} disabled={running} />
          </Field>

          {ab?.started_at ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-subtle">
                  <tr>
                    <th className="py-1 text-start font-medium">{t("abtest.variant")}</th>
                    <th className="py-1 text-start font-medium">{t("abtest.visitors")}</th>
                    <th className="py-1 text-start font-medium">{t("abtest.conversions")}</th>
                    <th className="py-1 text-start font-medium">{t("abtest.rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(["a", "b"] as const).map((k) => (
                    <tr key={k} className="border-t border-line">
                      <td className="py-1.5 font-semibold">
                        {k.toUpperCase()} {(ab.winner ?? w) === k ? <Trophy className="inline h-3.5 w-3.5 text-gold" aria-label={t("abtest.winner")} /> : null}
                      </td>
                      <td className="py-1.5">{s[`${k}_views`]}</td>
                      <td className="py-1.5">{s[`${k}_conv`]}</td>
                      <td className="py-1.5">{pct(rate(s[`${k}_conv`], s[`${k}_views`]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-subtle">
                {ab.winner ? t("abtest.decided", { winner: ab.winner.toUpperCase() }) : w ? t("abtest.leading", { winner: w.toUpperCase(), conf }) : t("abtest.collecting")}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!running ? (
              <>
                <Button onClick={() => save(true)} loading={pending}>
                  <FlaskConical className="h-4 w-4" /> {t("abtest.start")}
                </Button>
                <Button variant="secondary" onClick={() => save(false)} loading={pending}>
                  {t("common.save")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => stop("a")} loading={pending}>
                  <Square className="h-4 w-4" /> {t("abtest.keepA")}
                </Button>
                <Button variant="secondary" onClick={() => stop("b")} loading={pending}>
                  <Trophy className="h-4 w-4" /> {t("abtest.keepB")}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
