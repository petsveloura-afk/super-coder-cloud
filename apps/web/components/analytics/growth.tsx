"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LEAD_SOURCES } from "@scc/shared/validators";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui/primitives";
import { aiGrowthInsightAction, deleteSpendAction, saveSpendAction } from "@/app/[locale]/(dashboard)/analytics/growth-actions";

export interface SpendRow {
  id: string;
  month: string;
  source: string;
  amount: number;
  note: string | null;
}

/** Wave 18 — monthly marketing spend per source (feeds ROI / CAC / ROAS). */
export function SpendCard({ rows, currency, canEdit }: { rows: SpendRow[]; currency: string; canEdit: boolean }) {
  const { t, locale, intl } = useI18n();
  const router = useRouter();
  const now = new Date();
  const [v, setV] = useState({ month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, source: "facebook", amount: "", note: "" });
  const [pending, start] = useTransition();
  const money = new Intl.NumberFormat(intl, { style: "currency", currency, maximumFractionDigits: 0 });
  return (
    <Card data-testid="spend-card">
      <CardHeader title={t("growth.spendTitle")} description={t("growth.spendHint")} />
      <div className="space-y-4 p-5 pt-0">
        {canEdit ? (
          <div className="grid gap-3 sm:grid-cols-[140px_1fr_140px_1fr_auto] sm:items-end">
            <Field label={t("growth.month")} htmlFor="sp-month">
              <Input id="sp-month" type="month" dir="ltr" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })} />
            </Field>
            <Field label={t("crm.source")} htmlFor="sp-source">
              <Select id="sp-source" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`crm.sources.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("growth.amount")} htmlFor="sp-amount">
              <Input id="sp-amount" type="number" min={0} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
            </Field>
            <Field label={t("growth.note")} htmlFor="sp-note">
              <Input id="sp-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value.slice(0, 300) })} />
            </Field>
            <Button
              loading={pending}
              disabled={v.amount === ""}
              onClick={() =>
                start(async () => {
                  const r = await saveSpendAction({ locale, data: v });
                  if (r.error) toast.error(t(r.error));
                  else {
                    toast.success(t(r.message ?? "common.saved"));
                    setV({ ...v, amount: "", note: "" });
                    router.refresh();
                  }
                })
              }
            >
              {t("common.save")}
            </Button>
          </div>
        ) : null}
        {rows.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line text-[13px]">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-20 tabular-nums" dir="ltr">
                  {r.month.slice(0, 7)}
                </span>
                <span className="flex-1">{t(`crm.sources.${r.source}`)}</span>
                {r.note ? <span className="hidden text-subtle sm:inline">{r.note}</span> : null}
                <bdi dir="ltr" className="font-semibold">
                  {money.format(Number(r.amount))}
                </bdi>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("common.delete")}
                    onClick={() =>
                      start(async () => {
                        const res = await deleteSpendAction({ locale, id: r.id });
                        if (res.error) toast.error(t(res.error));
                        else router.refresh();
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-subtle">{t("growth.noSpend")}</p>
        )}
      </div>
    </Card>
  );
}

/** Wave 18 — "explain my numbers" (AI). */
export function GrowthInsight({ days, allowed }: { days: number; allowed: boolean }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="space-y-3 p-5" data-testid="growth-insight">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-accent" /> {t("growth.aiTitle")}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          disabled={!allowed}
          onClick={() =>
            start(async () => {
              const r = await aiGrowthInsightAction({ locale, days });
              if (r.error || !r.data) toast.error(t(r.error ?? "errors.generic"));
              else setText(r.data.text);
            })
          }
        >
          {t("growth.aiRun")}
        </Button>
      </div>
      {text ? <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{text}</div> : <p className="text-[13px] text-muted">{allowed ? t("growth.aiHint") : t("plans.locked.advanced_analytics.title")}</p>}
    </Card>
  );
}
