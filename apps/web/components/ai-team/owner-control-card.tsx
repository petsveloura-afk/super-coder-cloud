"use client";

import { useMemo, useState } from "react";
import { ScrollText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { autonomyView, filterLog, groupByDay, tallyByMember, type LogFilter, type OwnerLogEntry } from "@/lib/team/owner-control-core";
import { tightenAutonomyAction } from "@/app/[locale]/(dashboard)/ai-team/control-actions";
import type { TeamMemberView } from "./types";

const lang = (l: string) => (l === "en" ? "en" : l === "ar" ? "ar" : "he");

/** Wave 70 — who works alone, who asks first. Plain words; the only button moves people towards MORE caution. */
export function OwnerControlCard({ members, canManage, onRefresh }: { members: TeamMemberView[]; canManage: boolean; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = useMemo(() => autonomyView(members.map((m) => ({ id: m.id, name: m.name, tools: m.tools, autonomy: m.autonomy, auto_actions: m.auto_actions, status: m.status }))), [members]);
  const tone = (l: string) => (l === "independent" ? "warning" : l === "careful" ? "success" : "neutral");
  const tighten = async (memberId: string | null) => {
    setBusy(true);
    try {
      const r = await tightenAutonomyAction({ locale: lang(locale), memberId });
      if (r.error) toast.error(t(r.error));
      else toast.success(t(r.message ?? "common.saved"));
    } catch (e) {
      console.error("[ai-team] tighten failed", e);
      toast.error(t("common.error"));
    }
    setBusy(false);
    setConfirming(false);
    onRefresh();
  };
  if (!view.rows.length) return null;
  return (
    <Card className="space-y-3 p-5" data-testid="team-owner-control">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-muted" />
        <h3 className="min-w-0 flex-1 font-bold">{t("aiTeam.control.title")}</h3>
      </div>
      <p className="text-[12.5px] text-muted">{t("aiTeam.control.intro")}</p>
      <Badge tone={view.riskyCount ? "warning" : "success"}>{view.riskyCount ? t("aiTeam.control.risky", { n: view.riskyCount }) : t("aiTeam.control.allAsk")}</Badge>
      <ul className="space-y-2">
        {view.rows.map((r) => (
          <li key={r.id} className="rounded-2xl border border-line p-2.5 text-[12.5px]" data-testid="owner-control-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.name}</span>
              <Badge tone={tone(r.level)}>{t(`aiTeam.control.level.${r.level}`)}</Badge>
              {r.paused ? <Badge tone="neutral">{t("aiTeam.control.paused")}</Badge> : null}
              {canManage && r.auto ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => tighten(r.id)}>
                  {t("aiTeam.control.askFirst")}
                </Button>
              ) : null}
            </div>
            <p className="mt-1 text-muted">
              {t("aiTeam.control.counts", { alone: r.alone.internal + r.alone.customer + r.alone.money + r.alone.irreversible, asks: r.asks, looks: r.looks })}
            </p>
            {r.alone.customer + r.alone.money + r.alone.irreversible > 0 ? (
              <p className="mt-0.5 text-warning">
                {t("aiTeam.control.aloneRisky", { customer: r.alone.customer, money: r.alone.money, irreversible: r.alone.irreversible })}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage && view.loosenCount > 0 ? (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span>{t("aiTeam.control.confirm", { n: view.loosenCount })}</span>
            <Button size="sm" disabled={busy} onClick={() => tighten(null)} data-testid="owner-control-confirm">
              {t("aiTeam.control.yes")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)} data-testid="owner-control-tighten">
            {t("aiTeam.control.allAskFirst")}
          </Button>
        )
      ) : null}
      <p className="text-[11.5px] text-subtle">{t("aiTeam.control.note")}</p>
    </Card>
  );
}

const ago = (iso: string, locale: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(lang(locale), { numeric: "auto" });
  return Math.abs(min) < 60 ? rtf.format(-min, "minute") : Math.abs(min) < 1440 ? rtf.format(-Math.round(min / 60), "hour") : rtf.format(-Math.round(min / 1440), "day");
};

/** Wave 70 — the team log in the owner's words: done, waiting for you, stopped and why, what you changed. */
export function OwnerLogCard({ entries, members }: { entries: OwnerLogEntry[]; members: TeamMemberView[] }) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<LogFilter>("all");
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? t("aiTeam.activity.system");
  const shown = useMemo(() => filterLog(entries, filter), [entries, filter]);
  const days = useMemo(() => groupByDay(shown), [shown]);
  const tally = useMemo(() => tallyByMember(entries).slice(0, 5), [entries]);
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang(locale), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const line = (e: OwnerLogEntry) => {
    if (e.kind === "blocked") return t(`aiTeam.ownerLog.why.${e.why ?? "other"}`);
    if (e.kind === "changed") return t(`aiTeam.ownerLog.change.${e.change ?? "settings"}`, { name: e.changedMemberId ? nameOf(e.changedMemberId) : "" });
    if (e.kind === "waited" && !e.text) return t("aiTeam.ownerLog.waitedGeneric");
    return e.text;
  };
  return (
    <Card className="space-y-3 p-5" data-testid="team-owner-log">
      <div className="flex flex-wrap items-center gap-3">
        <ScrollText className="h-6 w-6 text-muted" />
        <h3 className="min-w-0 flex-1 font-bold">{t("aiTeam.ownerLog.title")}</h3>
        <span className="text-[12px] text-muted">{t("aiTeam.ownerLog.window")}</span>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {(["all", "waited", "problems"] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-[12px] ${filter === f ? "border-transparent bg-accent-solid text-accent-fg" : "border-line text-muted"}`} data-testid={`owner-log-filter-${f}`}>
            {t(`aiTeam.ownerLog.filter.${f}`)}
          </button>
        ))}
      </div>
      {tally.length ? (
        <ul className="flex flex-wrap gap-2 text-[12px]">
          {tally.map((x) => (
            <li key={x.memberId} className="rounded-full border border-line px-2.5 py-1">
              <span className="font-semibold">{nameOf(x.memberId)}</span> <span className="text-muted">{t("aiTeam.ownerLog.tally", { did: x.did, waited: x.waited, stopped: x.stopped })}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {days.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t("aiTeam.ownerLog.empty")}</p>
      ) : (
        days.map((g) => (
          <div key={g.day}>
            <h4 className="mb-1 text-[12.5px] font-semibold">{dayLabel(g.day)}</h4>
            <ul className="space-y-1.5">
              {g.entries.map((e) => (
                <li key={e.id} className="rounded-2xl border border-line bg-surface p-2 text-[12.5px]" data-testid="owner-log-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.kind === "changed" ? t("aiTeam.ownerLog.you") : nameOf(e.memberId)}</span>
                    <Badge tone={e.kind === "problem" || e.kind === "blocked" ? "danger" : e.kind === "waited" ? "warning" : "neutral"}>{t(`aiTeam.ownerLog.kind.${e.kind}`)}</Badge>
                    <span className="text-[11px] text-subtle">{ago(e.at, locale)}</span>
                  </div>
                  <p className="mt-1">{line(e)}</p>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}
