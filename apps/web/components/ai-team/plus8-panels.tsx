"use client";

import { useState } from "react";
import { AlertTriangle, GitMerge, Hourglass, Plug, RotateCcw, ServerOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Input, Ltr } from "@/components/ui/primitives";
import { cancelStaleBlockedAction, mergeDuplicatesAction, recordSampleAction, restartTaskAction } from "@/app/[locale]/(dashboard)/ai-team/plus8-actions";
import { analyze, analysisLine } from "@/lib/team/experiments-core";
import { restartReason } from "@/lib/team/restart-core";
import type { TeamPageData } from "./types";

const lang = (l: string): "he" | "en" | "ar" => (l === "en" || l === "ar" ? l : "he");

/**
 * Upgrade 8 / stage A — "Stability": tasks that need attention (with the reason and ONE action + a restart button), bulk "cancel old
 * blocked" and "merge duplicates", the waiting-customers queue with the median next to the average, and the engines that are
 * skipped right now (with how to add a free key). Everything is owner-only; nothing is deleted.
 */
export function StabilityPanel({ data, locale, onRefresh }: { data: TeamPageData; locale: string; onRefresh: () => void }) {
  const { t } = useI18n();
  const l = lang(locale);
  const p = data.plus8;
  const [busy, setBusy] = useState<string | null>(null);
  if (!p) return null;
  const can = data.canManage;

  const restart = async (id: string) => {
    setBusy(`r${id}`);
    try {
      const r = await restartTaskAction({ locale, id });
      if (r.error) return toast.error(r.data?.reason ? restartReason(r.data.reason, l) : t(r.error));
      toast.success(t("aiTeam.plus8.restarted"));
      onRefresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(null);
    }
  };
  const cancelOld = async () => {
    setBusy("cancel");
    try {
      const r = await cancelStaleBlockedAction({ locale });
      if (r.error) return toast.error(t(r.error));
      toast.success(t("aiTeam.plus8.cancelOldDone", { n: r.data?.n ?? 0 }));
      onRefresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(null);
    }
  };
  const merge = async () => {
    setBusy("merge");
    try {
      const r = await mergeDuplicatesAction({ locale });
      if (r.error) return toast.error(t(r.error));
      toast.success(t("aiTeam.plus8.mergeDone", { n: (r.data?.tasks ?? 0) + (r.data?.goals ?? 0) }));
      onRefresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-4 p-5" data-testid="stability-panel">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{t("aiTeam.plus8.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("aiTeam.plus8.about")}</p>
        </div>
      </div>

      {can ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === "cancel"} onClick={cancelOld} disabled={!p.staleBlocked} data-testid="cancel-old-blocked">
            <Trash2 className="h-3.5 w-3.5" /> {t("aiTeam.plus8.cancelOld")} {p.staleBlocked ? `(${p.staleBlocked})` : ""}
          </Button>
          <Button size="sm" variant="secondary" loading={busy === "merge"} onClick={merge} data-testid="merge-duplicates">
            <GitMerge className="h-3.5 w-3.5" /> {t("aiTeam.plus8.merge")}
          </Button>
        </div>
      ) : null}

      {p.response ? (
        <div className="rounded-2xl border border-line p-3 text-[13px]" data-testid="response-queue">
          <div className="flex flex-wrap items-center gap-2">
            <Hourglass className="h-4 w-4 text-muted" />
            <span className="font-semibold">{t("aiTeam.plus8.queue.title")}</span>
            <Badge tone={p.response.alert.level === "alert" ? "danger" : p.response.alert.level === "warn" ? "warning" : "success"}>{p.response.alert.text}</Badge>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">{p.response.line}</p>
          {p.response.queue.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {p.response.queue.map((q) => (
                <li key={q.id}>
                  <Badge tone={q.state === "breached" ? "danger" : q.state === "warning" ? "warning" : "neutral"}>{t("aiTeam.plus8.queue.waiting", { n: q.waitingMin })}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted">{t("aiTeam.plus8.queue.empty")}</p>
          )}
        </div>
      ) : null}

      <div>
        <h4 className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold">
          <Plug className="h-4 w-4 text-muted" /> {t("aiTeam.plus8.attention.title")}
        </h4>
        {p.attention.length ? (
          <ul className="space-y-2">
            {p.attention.map((x) => (
              <li key={x.id} className="rounded-2xl border border-line p-2.5 text-[12.5px]" data-testid="attention-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{x.title}</span>
                  <Badge tone={x.status === "requires_connection" ? "warning" : "danger"}>{x.label || t(`aiTeam.health.reason.${x.reason}`)}</Badge>
                </div>
                {x.action ? <p className="mt-1 text-muted">{x.action}</p> : null}
                {can ? (
                  <div className="mt-1.5">
                    <Button size="sm" variant="ghost" loading={busy === `r${x.id}`} onClick={() => restart(x.id)}>
                      <RotateCcw className="h-3.5 w-3.5" /> {t("aiTeam.plus8.restart")}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">{t("aiTeam.plus8.attention.empty")}</p>
        )}
      </div>

    </Card>
  );
}

/** The AI engines skipped right now and why (reasons only — no keys, ever), with ONE sentence on how to add a free key. Shown in the settings. */
export function SkippedEnginesCard({ data }: { data: TeamPageData }) {
  const { t } = useI18n();
  const p = data.plus8;
  // engine keys are platform work — business owners never see this card
  if (!p || !data.platformAdmin) return null;
  return (
    <Card className="space-y-2 p-5" data-testid="skipped-engines">
      <div>
        <h4 className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold">
          <ServerOff className="h-4 w-4 text-muted" /> {t("aiTeam.plus8.skipped.title")}
        </h4>
        {p.skipped.length ? (
          <ul className="space-y-1.5">
            {p.skipped.map((s) => (
              <li key={`${s.key}-${s.reason}`} className="text-[12.5px]">
                <Ltr className="font-mono">{s.key}</Ltr> · <span className="text-muted">{s.text}</span>
                {s.help ? <p className="text-[12px] text-subtle">{s.help}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">{t("aiTeam.plus8.skipped.none")}</p>
        )}
      </div>
    </Card>
  );
}

/** A/B experiments: enter the sample (counts per version); the verdict comes from the existing decision code (analyze) — never before the planned sample. */
export function SampleEntryCard({ data, locale, onRefresh }: { data: TeamPageData; locale: string; onRefresh: () => void }) {
  const { t } = useI18n();
  const l = lang(locale);
  const running = (data.plus7?.experiments ?? []).filter((e) => e.status === "running");
  const [form, setForm] = useState<Record<string, { aTrials: string; aSuccesses: string; bTrials: string; bSuccesses: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!data.canManage || !running.length) return null;
  const val = (id: string) => form[id] ?? { aTrials: "", aSuccesses: "", bTrials: "", bSuccesses: "" };
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const save = async (id: string) => {
    const f = val(id);
    const n = { aTrials: num(f.aTrials), aSuccesses: num(f.aSuccesses), bTrials: num(f.bTrials), bSuccesses: num(f.bSuccesses) };
    if (![n.aTrials, n.aSuccesses, n.bTrials, n.bSuccesses].every((x) => Number.isInteger(x) && x >= 0)) return toast.error(t("validation.invalid"));
    if (n.aSuccesses > n.aTrials || n.bSuccesses > n.bTrials) return toast.error(t("aiTeam.plus8.sample.errOver"));
    setBusy(id);
    try {
      const r = await recordSampleAction({ locale, id, ...n });
      if (r.error) return toast.error(t(r.error));
      toast.success(t("common.saved"));
      setForm({ ...form, [id]: { aTrials: "", aSuccesses: "", bTrials: "", bSuccesses: "" } });
      onRefresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="space-y-3 p-5" data-testid="sample-entry">
      <div>
        <h3 className="font-bold">{t("aiTeam.plus8.sample.title")}</h3>
        <p className="text-[12.5px] text-muted">{t("aiTeam.plus8.sample.about")}</p>
      </div>
      <ul className="space-y-3">
        {running.map((e) => {
          const f = val(e.id);
          const set = (k: keyof typeof f, v: string) => setForm({ ...form, [e.id]: { ...f, [k]: v.replace(/[^0-9]/g, "") } });
          return (
            <li key={e.id} className="rounded-2xl border border-line p-3 text-[13px]">
              <p className="font-semibold">{e.title}</p>
              <p className="text-[12px] text-muted">{analysisLine(analyze(e), e, l)}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-[12px] font-medium">{e.a.name}</p>
                  <Input inputMode="numeric" value={f.aTrials} onChange={(ev) => set("aTrials", ev.target.value)} placeholder={t("aiTeam.plus8.sample.trials")} aria-label={`${e.a.name} ${t("aiTeam.plus8.sample.trials")}`} />
                  <Input inputMode="numeric" value={f.aSuccesses} onChange={(ev) => set("aSuccesses", ev.target.value)} placeholder={t("aiTeam.plus8.sample.successes")} aria-label={`${e.a.name} ${t("aiTeam.plus8.sample.successes")}`} />
                </div>
                <div className="space-y-1">
                  <p className="text-[12px] font-medium">{e.b.name}</p>
                  <Input inputMode="numeric" value={f.bTrials} onChange={(ev) => set("bTrials", ev.target.value)} placeholder={t("aiTeam.plus8.sample.trials")} aria-label={`${e.b.name} ${t("aiTeam.plus8.sample.trials")}`} />
                  <Input inputMode="numeric" value={f.bSuccesses} onChange={(ev) => set("bSuccesses", ev.target.value)} placeholder={t("aiTeam.plus8.sample.successes")} aria-label={`${e.b.name} ${t("aiTeam.plus8.sample.successes")}`} />
                </div>
              </div>
              <div className="mt-2">
                <Button size="sm" loading={busy === e.id} onClick={() => save(e.id)}>
                  {t("aiTeam.plus8.sample.save")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
