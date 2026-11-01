"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleDashed, Mail, RefreshCw, RotateCcw, Send, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import type { MissionControl } from "@/lib/ops/system";
import type { OpsLevel } from "@/lib/ops/system-core";
import { retryAllDeliveriesAction, retryDeliveryAction, resolveErrorAction, saveSurveySettingsAction, testEmailAction } from "@/app/[locale]/(dashboard)/health/actions";

const TONE: Record<OpsLevel, "success" | "warning" | "danger" | "neutral"> = { ok: "success", warn: "warning", error: "danger", off: "neutral" };
function LevelIcon({ level }: { level: OpsLevel }) {
  if (level === "ok") return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (level === "warn") return <TriangleAlert className="h-5 w-5 text-warning" />;
  if (level === "error") return <CircleAlert className="h-5 w-5 text-danger" />;
  return <CircleDashed className="h-5 w-5 text-subtle" />;
}

export function MissionControlView({ data }: { data: MissionControl }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sv, setSv] = useState({ enabled: data.survey.enabled, kind: data.survey.kind as "nps" | "csat" | "ces", delay_minutes: data.survey.delay_minutes, cooldown_days: data.survey.cooldown_days, question: data.survey.question ?? "" });
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { dateStyle: "short", timeStyle: "short", timeZone: DEFAULT_TIME_ZONE }) : "—");
  const act = (fn: () => Promise<{ error?: string; message?: string; messageParams?: Record<string, string | number> }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(t(r.error, r.messageParams));
      else {
        toast.success(t(r.message ?? "common.saved", r.messageParams));
        router.refresh();
      }
    });
  const levelOfChannel = (l: string): OpsLevel => (l === "error" ? "error" : l === "warning" ? "warn" : "ok");
  const href = (p: string) => `/${locale}${p}`;
  return (
    <div className="space-y-5" data-testid="mission-control">
      <Card className={cn("flex flex-wrap items-center gap-3 p-4", data.overall === "error" ? "border-danger/40" : data.overall === "warn" ? "border-warning/40" : "border-success/30")}>
        <LevelIcon level={data.overall} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t(`ops.overall.${data.overall}`)}</p>
          <p className="text-[12.5px] text-muted">{t("ops.checkedAt", { at: fmt(data.checkedAt) })}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => router.refresh()} disabled={pending}>
          <RefreshCw className="h-4 w-4" /> {t("ops.recheck")}
        </Button>
      </Card>

      <section aria-labelledby="ops-services">
        <h2 id="ops-services" className="mb-2 text-[15px] font-semibold">{t("ops.services")}</h2>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((i) => (
            <li key={i.key} className="flex gap-3 rounded-2xl border border-line bg-surface p-4" data-ops={i.key} data-level={i.level}>
              <LevelIcon level={i.level} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{t(`ops.item.${i.key}`)}</p>
                  <Badge tone={TONE[i.level]}>{t(`ops.level.${i.level}`)}</Badge>
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted">{t(i.reason, i.params)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {i.fix && i.level !== "ok" ? (
                    <a href={href(i.fix)} className="text-[12.5px] font-semibold text-accent hover:underline">
                      {t("ops.fix")}
                    </a>
                  ) : null}
                  {i.key === "email" ? (
                    <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline disabled:opacity-50" disabled={pending} onClick={() => act(() => testEmailAction({ locale }))} data-testid="ops-test-email">
                      <Mail className="h-3.5 w-3.5" /> {t("ops.sendTest")}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ops-channels">
        <h2 id="ops-channels" className="mb-2 text-[15px] font-semibold">{t("ops.channels")}</h2>
        {data.channels.length ? (
          <Card className="divide-y divide-line">
            {data.channels.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 p-3.5">
                <LevelIcon level={levelOfChannel(c.level)} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {t(`campaigns.channels.${c.kind}`)} <span className="text-subtle">· {c.name}</span>
                  </p>
                  <p className="text-[12.5px] text-muted">{t(`health.reason.${c.reason}`, { n: String(c.failed24h) })}</p>
                </div>
                {c.level === "error" || c.level === "warning" ? (
                  <a href={href("/integrations")} className="text-[12.5px] font-semibold text-accent hover:underline">
                    {t("ops.fix")}
                  </a>
                ) : null}
              </div>
            ))}
          </Card>
        ) : (
          <Card className="p-5 text-center text-[13px] text-muted">
            {t("ops.noChannels")}{" "}
            <a href={href("/integrations")} className="font-semibold text-accent hover:underline">
              {t("ops.connectNow")}
            </a>
          </Card>
        )}
      </section>

      <section id="deliveries" aria-labelledby="ops-deliveries">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ops-deliveries" className="text-[15px] font-semibold">{t("ops.deliveries")}</h2>
          {data.deliveries.length ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => retryAllDeliveriesAction({ locale }))}>
              <RotateCcw className="h-4 w-4" /> {t("ops.retryAll")}
            </Button>
          ) : null}
        </div>
        {data.deliveries.length ? (
          <Card className="divide-y divide-line" data-testid="ops-deliveries">
            {data.deliveries.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 p-3.5 text-[13px]">
                <Badge tone={d.status === "dead" ? "danger" : "warning"}>{t(`ops.job.${d.status}`)}</Badge>
                <span className="font-medium">{t(`ops.kind.${d.kind}`)}</span>
                {d.to ? <bdi dir="ltr" className="text-subtle">{d.to}</bdi> : null}
                <span className="text-subtle">{fmt(d.created_at)}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-danger" dir="ltr" title={d.last_error ?? ""}>
                  {d.last_error ?? ""}
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => retryDeliveryAction({ locale, id: d.id }))}>
                    <Send className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t("ops.retry")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => retryDeliveryAction({ locale, id: d.id, cancel: true }))} aria-label={t("ops.cancel")}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="p-5 text-center text-[13px] text-success">{t("ops.noFailures")}</Card>
        )}
      </section>

      <section id="surveys" aria-labelledby="ops-surveys">
        <h2 id="ops-surveys" className="mb-2 text-[15px] font-semibold">{t("surveys.title")}</h2>
        <Card className="space-y-3 p-4" data-testid="ops-surveys">
          <p className="text-[13px] text-muted">{t("surveys.body")}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="inline-flex items-center gap-2 text-[13px] sm:col-span-4">
              <input type="checkbox" checked={sv.enabled} onChange={(e) => setSv({ ...sv, enabled: e.target.checked })} /> {t("surveys.enable")}
            </label>
            <label className="space-y-1 text-[12.5px]">
              <span className="block font-medium text-muted">{t("surveys.kind")}</span>
              <Select value={sv.kind} onChange={(e) => setSv({ ...sv, kind: e.target.value as "nps" | "csat" | "ces" })}>
                {(["csat", "nps", "ces"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`surveys.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-[12.5px]">
              <span className="block font-medium text-muted">{t("surveys.delay")}</span>
              <Input type="number" min={0} max={10080} value={sv.delay_minutes} onChange={(e) => setSv({ ...sv, delay_minutes: Math.max(0, Math.min(10080, Number(e.target.value) || 0)) })} dir="ltr" />
            </label>
            <label className="space-y-1 text-[12.5px]">
              <span className="block font-medium text-muted">{t("surveys.cooldown")}</span>
              <Input type="number" min={1} max={365} value={sv.cooldown_days} onChange={(e) => setSv({ ...sv, cooldown_days: Math.max(1, Math.min(365, Number(e.target.value) || 30)) })} dir="ltr" />
            </label>
            <label className="space-y-1 text-[12.5px]">
              <span className="block font-medium text-muted">{t("surveys.question")}</span>
              <Input value={sv.question} maxLength={300} onChange={(e) => setSv({ ...sv, question: e.target.value })} placeholder={t(`surveys.defaultQ.${sv.kind}`)} dir="auto" />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted">{data.survey.answered30d ? t("surveys.stats", { n: data.survey.answered30d, avg: data.survey.avg ?? "—" }) : t("surveys.noAnswers")}</p>
            <Button size="sm" disabled={pending} onClick={() => act(() => saveSurveySettingsAction({ locale, ...sv }))}>
              {t("common.save")}
            </Button>
          </div>
          {data.survey.recent.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {data.survey.recent.map((r, i) => (
                <li key={i} className="flex items-start gap-3 p-2.5 text-[12.5px]">
                  <Badge tone={r.kind === "nps" ? ((r.score ?? 0) >= 9 ? "success" : (r.score ?? 0) <= 6 ? "danger" : "warning") : r.kind === "csat" ? ((r.score ?? 0) >= 4 ? "success" : (r.score ?? 0) <= 2 ? "danger" : "warning") : (r.score ?? 7) <= 3 ? "success" : "warning"}>
                    {r.kind.toUpperCase()} {r.score}
                  </Badge>
                  <span className="min-w-0 flex-1" dir="auto">
                    {r.comment ?? "—"}
                  </span>
                  <span className="text-subtle">{fmt(r.answered_at)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </section>

      {data.jobs ? (
        <section aria-labelledby="ops-jobs">
          <h2 id="ops-jobs" className="mb-2 text-[15px] font-semibold">{t("ops.jobs")}</h2>
          <Card className="divide-y divide-line" data-testid="ops-jobs">
            {data.jobs.map((j) => (
              <div key={j.name} className="flex flex-wrap items-center gap-3 p-3.5 text-[13px]">
                <LevelIcon level={j.health === "ok" ? "ok" : j.health === "never" ? "off" : j.health === "late" ? "warn" : "error"} />
                <span className="min-w-28 font-mono font-medium" dir="ltr">
                  {j.name}
                </span>
                <Badge tone={j.health === "ok" ? "success" : j.health === "never" ? "neutral" : j.health === "late" ? "warning" : "danger"}>{t(`ops.jobHealth.${j.health}`)}</Badge>
                <span className="text-subtle">{t("ops.lastRun", { at: fmt(j.lastAt) })}</span>
                {j.durationMs !== null ? <span className="text-subtle">{(j.durationMs / 1000).toFixed(1)}s</span> : null}
                {j.items !== null ? <span className="text-subtle">{t("ops.items", { n: j.items })}</span> : null}
                {j.lastError ? (
                  <span className="min-w-0 flex-1 truncate text-[12px] text-danger" dir="ltr" title={j.lastError}>
                    {j.lastError}
                  </span>
                ) : null}
              </div>
            ))}
          </Card>
          <p className="mt-1 text-[12px] text-subtle">{t("ops.jobsHint")}</p>
        </section>
      ) : null}

      {data.errors ? (
        <section aria-labelledby="ops-errors">
          <h2 id="ops-errors" className="mb-2 text-[15px] font-semibold">{t("ops.errors")}</h2>
          {data.errors.length ? (
            <Card className="divide-y divide-line" data-testid="ops-errors">
              {data.errors.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 p-3.5 text-[12.5px]">
                  <Badge tone="danger">×{e.count}</Badge>
                  <Badge tone="neutral">{e.source}</Badge>
                  <span className="min-w-0 flex-1 truncate" dir="ltr" title={e.message}>
                    {e.message}
                  </span>
                  {e.route ? <bdi dir="ltr" className="text-subtle">{e.route}</bdi> : null}
                  <span className="text-subtle">{fmt(e.last_seen)}</span>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => resolveErrorAction({ locale, id: e.id }))}>
                    {t("ops.markResolved")}
                  </Button>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="p-5 text-center text-[13px] text-success">{t("ops.noErrors")}</Card>
          )}
        </section>
      ) : null}
    </div>
  );
}
