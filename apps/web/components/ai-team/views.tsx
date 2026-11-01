"use client";

import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { AgentAvatar } from "./avatar";
import type { StatsView, TeamMemberView } from "./types";

/** An employee card: avatar, role, live status, what they work on now, metrics and the latest learning. */
export function MemberCard({ m, stats, onOpen }: { m: TeamMemberView; stats?: StatsView; onOpen: (m: TeamMemberView) => void }) {
  const { t } = useI18n();
  const state = m.status === "paused" ? "paused" : m.live;
  return (
    <li className="min-w-0">
      <button type="button" onClick={() => onOpen(m)} className="glow-ring group flex h-full w-full flex-col gap-3 rounded-3xl border border-line bg-surface p-4 text-start shadow-sm" data-testid={`member-${m.role_key}`}>
        <div className="flex items-center gap-3">
          <AgentAvatar spec={m.avatar} state={state} size={64} label={m.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{m.name}</p>
            <p className="truncate text-[12.5px] text-muted">{m.title || t(`aiTeam.roles.${m.role_key}`)}</p>
            <Badge className="mt-1" tone={state === "paused" ? "neutral" : state === "working" ? "accent" : state === "waiting" ? "warning" : state === "error" ? "danger" : "success"}>{t(`aiTeam.live.${state}`)}</Badge>
          </div>
        </div>
        <p className="line-clamp-2 min-h-[2.5em] text-[12.5px] text-subtle">{m.working_on ? `${t("aiTeam.card.workingOn")}: ${m.working_on}` : t("aiTeam.card.free")}</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label={t("aiTeam.metrics.done")} value={stats?.done ?? 0} />
          <Metric label={t("aiTeam.metrics.approval")} value={stats?.approvalRate === null || stats?.approvalRate === undefined ? "—" : `${stats.approvalRate}%`} />
          <Metric label={t("aiTeam.metrics.credits")} value={stats?.credits ?? 0} />
        </div>
        {m.last_learned ? <p className="line-clamp-2 rounded-xl bg-accent-soft/50 px-2.5 py-1.5 text-[11.5px] text-muted">💡 {m.last_learned}</p> : null}
      </button>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-elevated px-2 py-1.5">
      <p className="tabular-nums text-[15px] font-bold">{value}</p>
      <p className="truncate text-[10.5px] text-subtle">{label}</p>
    </div>
  );
}

export function TeamGrid({ members, stats, onOpen }: { members: TeamMemberView[]; stats: Record<string, StatsView>; onOpen: (m: TeamMemberView) => void }) {
  return (
    <ul className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="team-grid">
      {members.map((m) => (
        <MemberCard key={m.id} m={m} stats={stats[m.id]} onOpen={onOpen} />
      ))}
    </ul>
  );
}

/** The org chart: manager on top, team leads, then their employees (reports_to). */
export function TeamTree({ members, onOpen }: { members: TeamMemberView[]; onOpen: (m: TeamMemberView) => void }) {
  const { t } = useI18n();
  const byBoss = new Map<string | null, TeamMemberView[]>();
  const ids = new Set(members.map((m) => m.id));
  for (const m of members) {
    const boss = m.reports_to && ids.has(m.reports_to) ? m.reports_to : null;
    byBoss.set(boss, [...(byBoss.get(boss) ?? []), m]);
  }
  const roots = (byBoss.get(null) ?? []).sort((a, b) => (a.role_key === "manager" ? -1 : b.role_key === "manager" ? 1 : a.position - b.position));
  const Node = ({ m, depth }: { m: TeamMemberView; depth: number }) => {
    const kids = byBoss.get(m.id) ?? [];
    return (
      <li className="flex flex-col items-center">
        <button type="button" onClick={() => onOpen(m)} className={cn("glow-ring flex w-36 flex-col items-center gap-1.5 rounded-2xl border bg-surface p-3 text-center shadow-sm", depth === 0 ? "border-accent/50" : "border-line")} data-testid={`tree-${m.role_key}`}>
          <AgentAvatar spec={m.avatar} state={m.status === "paused" ? "paused" : m.live} size={depth === 0 ? 64 : 52} label={m.name} />
          <span className="w-full truncate text-[13px] font-bold">{m.name}</span>
          <span className="w-full truncate text-[11px] text-muted">{m.title || t(`aiTeam.roles.${m.role_key}`)}</span>
        </button>
        {kids.length ? (
          <>
            <span className="h-5 w-px bg-line-strong" aria-hidden />
            <ul className={cn("relative flex flex-wrap justify-center gap-4 pt-5", kids.length > 1 && "before:absolute before:inset-x-[4.5rem] before:top-0 before:h-px before:bg-line-strong")}>
              {kids.map((k) => (
                <div key={k.id} className="relative before:absolute before:start-1/2 before:-top-5 before:h-5 before:w-px before:bg-line-strong">
                  <Node m={k} depth={depth + 1} />
                </div>
              ))}
            </ul>
          </>
        ) : null}
      </li>
    );
  };
  return (
    <div className="overflow-x-auto rounded-3xl border border-line bg-surface/50 p-5" data-testid="team-tree">
      <ul className="flex min-w-max flex-col items-center gap-6">
        {roots.map((m) => (
          <Node key={m.id} m={m} depth={0} />
        ))}
      </ul>
    </div>
  );
}
