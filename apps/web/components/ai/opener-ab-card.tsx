"use client";

import { useState, useTransition } from "react";
import { FlaskConical, Save, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { saveOpenersAction } from "@/app/[locale]/(dashboard)/ai-agents/growth-actions";

/**
 * Wave 59 — A/B test of the agent's opening line: two openers, every new conversation gets one, and the one
 * that brings more leads wins automatically (after enough conversations).
 */
export function OpenerAbCard({ agentId, openers, stats }: { agentId: string; openers: string[]; stats: { n: [number, number]; rates: [number, number]; winner: 0 | 1 | null; needed: number } | null }) {
  const { t, locale } = useI18n();
  const [a, setA] = useState(openers[0] ?? "");
  const [b, setB] = useState(openers[1] ?? "");
  const [pending, start] = useTransition();
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const save = () =>
    start(async () => {
      const r = await saveOpenersAction({ locale, agentId, openers: [a, b] });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
    });
  return (
    <div className="space-y-3 p-5" data-testid="opener-ab">
      {(["a", "b"] as const).map((k, i) => {
        const val = i === 0 ? a : b;
        const won = stats?.winner === i;
        return (
          <div key={k} className={cn("rounded-2xl border p-3 transition", won ? "border-success/40 bg-success-soft/30" : "border-line")}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <label htmlFor={`opener-${agentId}-${k}`} className="text-[13px] font-semibold">
                {t(i === 0 ? "abOpener.a" : "abOpener.b")}
              </label>
              {stats && stats.n[i]! > 0 ? (
                <span className="text-[12px] text-muted">
                  {t("abOpener.stat", { n: String(stats.n[i]), rate: pct(stats.rates[i]!) })}
                </span>
              ) : null}
              {won ? (
                <Badge tone="success">
                  <Trophy className="me-1 inline h-3.5 w-3.5" aria-hidden /> {t("abOpener.winner")}
                </Badge>
              ) : null}
            </div>
            <Textarea id={`opener-${agentId}-${k}`} rows={2} dir="auto" value={val} maxLength={300} placeholder={t(i === 0 ? "abOpener.placeholderA" : "abOpener.placeholderB")} onChange={(e) => (i === 0 ? setA(e.target.value) : setB(e.target.value))} />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} loading={pending} data-testid="opener-save">
          <Save className="h-4 w-4" aria-hidden /> {t("abOpener.save")}
        </Button>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          {stats && stats.winner === null && a.trim() && b.trim() ? t("abOpener.testing", { n: String(stats.needed) }) : t("abOpener.hint")}
        </span>
      </div>
    </div>
  );
}
