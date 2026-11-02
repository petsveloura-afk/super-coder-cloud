"use client";

import { useState } from "react";
import { Clock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Input } from "@/components/ui/primitives";
import { saveOpsAction } from "@/app/[locale]/(dashboard)/ai-team/actions";
import type { TeamOpsData, TeamSlaData } from "./types";

function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Num({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-muted">
      {label}
      <Input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value)) || min)))} className="w-20" />
    </label>
  );
}

/**
 * Operations (upgrade 3): quiet hours, first-response target (with the live numbers), morning / weekly reports,
 * duplicate removal and the protections. One save; the server cleans every value again.
 */
export function OpsPanel({ ops, sla, canManage, locale, onRefresh }: { ops: TeamOpsData; sla?: TeamSlaData; canManage: boolean; locale: string; onRefresh: () => void }) {
  const { t } = useI18n();
  const [o, setO] = useState<TeamOpsData>(ops);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveOpsAction({ locale, ops: o });
      if (r.error) toast.error(t(r.error));
      else toast.success(t(r.message ?? "common.saved"));
    } catch (e) {
      console.error("[ai-team] ops save failed", e);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
      onRefresh();
    }
  };
  const off = !canManage;
  return (
    <Card className="space-y-4 p-5" data-testid="ops-panel">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{t("aiTeam.ops.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("aiTeam.ops.about")}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-[12.5px] font-semibold">
          <Clock className="h-4 w-4" /> {t("aiTeam.ops.quiet")}
        </h4>
        <Check checked={o.quiet.enabled} disabled={off} onChange={(v) => setO({ ...o, quiet: { ...o.quiet, enabled: v } })} label={t("aiTeam.ops.quietHint")} />
        {o.quiet.enabled ? (
          <div className="flex flex-wrap gap-3">
            <Num value={o.quiet.start} min={0} max={23} label={t("aiTeam.ops.from")} onChange={(n) => setO({ ...o, quiet: { ...o.quiet, start: n } })} />
            <Num value={o.quiet.end} min={0} max={23} label={t("aiTeam.ops.to")} onChange={(n) => setO({ ...o, quiet: { ...o.quiet, end: n } })} />
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <h4 className="text-[12.5px] font-semibold">{t("aiTeam.ops.slaTitle")}</h4>
        <Num value={o.sla.targetMin} min={5} max={1440} label={t("aiTeam.ops.slaTarget")} onChange={(n) => setO({ ...o, sla: { targetMin: n } })} />
        {sla ? (
          <p className="text-[12.5px] text-muted" data-testid="ops-sla">
            {t("aiTeam.ops.slaTotal")}: {sla.total} · {t("aiTeam.ops.slaBreached")}: {sla.breached} · {t("aiTeam.ops.slaWarning")}: {sla.warning} · {t("aiTeam.ops.slaAvg")}: {sla.avgMinutes}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h4 className="text-[12.5px] font-semibold">{t("aiTeam.ops.digest")}</h4>
        <Check checked={o.digest.daily} disabled={off} onChange={(v) => setO({ ...o, digest: { ...o.digest, daily: v } })} label={t("aiTeam.ops.daily")} />
        <Check checked={o.digest.weekly} disabled={off} onChange={(v) => setO({ ...o, digest: { ...o.digest, weekly: v } })} label={t("aiTeam.ops.weekly")} />
        <Check checked={o.dedupe} disabled={off} onChange={(v) => setO({ ...o, dedupe: v })} label={t("aiTeam.ops.dedupe")} />
      </div>

      <div className="space-y-2">
        <h4 className="text-[12.5px] font-semibold">{t("aiTeam.ops.protect")}</h4>
        <Check checked={o.protect.rateLimits} disabled={off} onChange={(v) => setO({ ...o, protect: { ...o.protect, rateLimits: v } })} label={t("aiTeam.ops.rateLimits")} />
        <Check checked={o.protect.anomalyFreeze} disabled={off} onChange={(v) => setO({ ...o, protect: { ...o.protect, anomalyFreeze: v } })} label={t("aiTeam.ops.anomaly")} />
        <Num value={o.protect.recipientCap} min={1} max={50} label={t("aiTeam.ops.cap")} onChange={(n) => setO({ ...o, protect: { ...o.protect, recipientCap: n } })} />
      </div>

      {canManage ? (
        <Button onClick={save} loading={busy} data-testid="ops-save">
          {t("aiTeam.ops.save")}
        </Button>
      ) : null}
    </Card>
  );
}
