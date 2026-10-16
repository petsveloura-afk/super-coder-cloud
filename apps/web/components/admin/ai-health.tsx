"use client";

import { useState, useTransition } from "react";
import { Activity, CheckCircle2, Clock, KeyRound, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { probeAiAction, resetAiRestsAction, type AiProbeRow } from "@/app/[locale]/(dashboard)/admin/actions";

const NAMES: Record<string, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  mistral: "Mistral",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
};

/**
 * Platform admin: the real status of every AI key (one tiny test request each) —
 * OK / per-minute limit / daily quota used up / bad key / model not available —
 * plus "reset" after adding keys. Explains in plain Hebrew what to do.
 */
export function AiHealth({ configured }: { configured: Record<string, number> }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<AiProbeRow[] | null>(null);
  const [pending, start] = useTransition();
  const total = Object.values(configured).reduce((a, b) => a + b, 0);
  const okCount = rows?.filter((r) => r.ok).length ?? 0;

  return (
    <Card className="mb-4 overflow-hidden" data-testid="ai-health">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold">
            <Activity className="h-4.5 w-4.5 text-accent" /> {t("admin.aiHealth.title")}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("admin.aiHealth.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={pending}
            data-testid="ai-health-run"
            onClick={() =>
              start(async () => {
                const r = await probeAiAction(locale);
                if (r.error) return void toast.error(t(r.error));
                setRows(r.data?.rows ?? []);
              })
            }
          >
            <Activity className="h-4 w-4" /> {t("admin.aiHealth.run")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await resetAiRestsAction(locale);
                if (r.error) toast.error(t(r.error));
                else toast.success(t("admin.aiHealth.resetDone"));
              })
            }
          >
            <RotateCcw className="h-4 w-4" /> {t("admin.aiHealth.reset")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 p-4 text-[12.5px]">
        {Object.entries(NAMES).map(([k, name]) => (
          <span key={k} className={`rounded-lg border px-2.5 py-1 ${configured[k] ? "border-success/30 bg-success-soft text-success" : "border-line text-subtle"}`}>
            {name} · {configured[k] ? t("admin.aiHealth.keys", { n: configured[k]! }) : t("admin.aiHealth.none")}
          </span>
        ))}
      </div>
      {total === 0 ? <p className="px-4 pb-4 text-sm text-danger">{t("admin.aiHealth.noKeys")}</p> : null}

      {rows ? (
        <div className="border-t border-line">
          <p className="px-4 pt-3 text-sm font-medium" data-testid="ai-health-summary">
            {t("admin.aiHealth.summary", { ok: okCount, total: rows.length })}
          </p>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.keyId} className="flex items-start gap-3 px-4 py-3" data-ok={r.ok ? "1" : "0"}>
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-success" /> : r.kind === "rate" || r.kind === "daily" ? <Clock className="mt-0.5 h-4.5 w-4.5 shrink-0 text-gold" /> : r.kind === "auth" ? <KeyRound className="mt-0.5 h-4.5 w-4.5 shrink-0 text-danger" /> : <XCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-danger" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{NAMES[r.provider] ?? r.provider}</span>
                    <code dir="ltr" className="rounded bg-elevated px-1.5 py-0.5 text-[11px]">{r.keyId.split(":")[1]}</code>
                    <span dir="ltr" className="text-[11.5px] text-subtle">{r.model}</span>
                    <Badge tone={r.ok ? "success" : r.kind === "rate" || r.kind === "daily" ? "warning" : "danger"}>{r.ok ? `${t("admin.aiHealth.ok")} · ${(r.ms / 1000).toFixed(1)}s` : t(`admin.aiHealth.kind.${r.kind ?? "other"}`)}</Badge>
                  </div>
                  {!r.ok ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{t(`admin.aiHealth.fix.${r.kind ?? "other"}`)}</p> : null}
                  {!r.ok && r.reason ? (
                    <p dir="ltr" className="mt-1 break-all text-[11px] text-subtle">
                      {r.reason}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
