"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon, Brain, CheckCheck, Box, History, LayoutGrid, Network, Plus, Settings2, Sparkles, Target, Users, BookOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Badge, Button } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ROLES, ROLE_KEYS, type RoleKey } from "@/lib/team/roles";
import { Presentation3D } from "./presentation-3d";
import { TeamGrid, TeamTree } from "./views";
import { MemberEditor, type EditorDraft } from "./member-editor";
import { FactsPanel } from "./facts-panel";
import { ActivityPanel, ApprovalsPanel, GoalsPanel, HireGallery, MeetingPanel, MemoryPanel, PlaybooksPanel, SettingsPanel } from "./panels";
import type { TeamMemberView, TeamPageData } from "./types";

/**
 * "My team" — the digital team screen: the employees (3D presentation / grid / org chart), goals and the task
 * board with live progress, one approvals queue, memory, playbooks, the weekly meeting + performance, the live
 * activity timeline and the settings (with the emergency stop). Tabs remember the last choice per viewer.
 */
const TABS = ["team", "goals", "approvals", "memory", "playbooks", "meeting", "activity", "settings"] as const;
type Tab = (typeof TABS)[number];
type View = "presentation" | "grid" | "tree";

const ICONS: Record<Tab, typeof Users> = { team: Users, goals: Target, approvals: CheckCheck, memory: Brain, playbooks: BookOpen, meeting: Sparkles, activity: History, settings: Settings2 };

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export function TeamScreen({ data }: { data: TeamPageData }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [tab, setTab] = useState<Tab>("team");
  const [view, setView] = useState<View>("presentation");
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [hireOpen, setHireOpen] = useState(false);

  // remembered choices (per viewer, harmless when storage is unavailable)
  useEffect(() => {
    const id = setTimeout(() => {
      setTab(readPref("scc_team_tab", TABS, "team"));
      setView(readPref("scc_team_view", ["presentation", "grid", "tree"] as const, "presentation"));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);
  const pending = data.approvals.filter((a) => a.status === "pending").length;
  const waiting = data.tasks.filter((x) => x.status === "awaiting_input").length;
  const working = data.members.filter((m) => m.live === "working").length;

  const open = (m: TeamMemberView) =>
    setEditor({ id: m.id, role_key: m.role_key, name: m.name, title: m.title ?? "", avatar: m.avatar, tone: m.tone ?? "", instructions: m.instructions, tools: m.tools, autonomy: m.autonomy, auto_actions: m.auto_actions, reports_to: m.reports_to, status: m.status, limits: m.limits });

  const hire = (role: string) => {
    const def = ROLES[role as RoleKey] ?? ROLES.custom;
    const boss = data.members.find((m) => m.role_key === def.reportsTo) ?? data.members.find((m) => m.role_key === "manager") ?? null;
    setHireOpen(false);
    setEditor({ role_key: role, name: "", title: "", avatar: { hue: def.avatar.hue, accessory: def.avatar.accessory }, tone: "", instructions: "", tools: def.tools, autonomy: def.autonomy, auto_actions: [], reports_to: boss?.id ?? null, status: "active", limits: {} });
  };

  const sorted = useMemo(() => [...data.members].sort((a, b) => a.position - b.position), [data.members]);

  return (
    <div className="space-y-4">
      {data.settings.emergency_stop ? (
        <div className="flex items-center gap-3 rounded-2xl border border-danger/50 bg-danger/10 p-3 text-[13.5px] font-medium text-danger" role="alert">
          <AlertOctagon className="h-5 w-5" /> {t("aiTeam.stop.banner")}
        </div>
      ) : !data.settings.enabled ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-[13.5px]" role="status">
          {t("aiTeam.offBanner")}
          {data.canManage ? (
            <Button size="sm" onClick={() => { setTab("settings"); writePref("scc_team_tab", "settings"); }}>
              {t("aiTeam.turnOn")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Badge tone="accent">{t("aiTeam.summary.members", { n: data.members.length })}</Badge>
        <Badge tone={working ? "accent" : "neutral"}>{t("aiTeam.summary.working", { n: working })}</Badge>
        <Badge tone={pending ? "warning" : "neutral"}>{t("aiTeam.summary.approvals", { n: pending })}</Badge>
        {waiting ? <Badge tone="warning">{t("aiTeam.summary.questions", { n: waiting })}</Badge> : null}
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label={t("aiTeam.title")}>
        {TABS.map((x) => {
          const Icon = ICONS[x];
          const count = x === "approvals" ? pending : x === "goals" ? waiting : 0;
          return (
            <button
              key={x}
              role="tab"
              aria-selected={tab === x}
              onClick={() => {
                setTab(x);
                writePref("scc_team_tab", x);
              }}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition", tab === x ? "border-transparent bg-accent-solid text-accent-fg shadow-sm" : "border-line text-muted hover:bg-surface-hover")}
              data-testid={`tab-${x}`}
            >
              <Icon className="h-4 w-4" /> {t(`aiTeam.tabs.${x}`)}
              {count ? <span className="rounded-full bg-warning px-1.5 text-[11px] font-bold text-white">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === "team" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-line p-1" role="radiogroup" aria-label={t("aiTeam.views.label")}>
              {(
                [
                  ["presentation", Box],
                  ["grid", LayoutGrid],
                  ["tree", Network],
                ] as const
              ).map(([v, Icon]) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => {
                    setView(v);
                    writePref("scc_team_view", v);
                  }}
                  className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium", view === v ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}
                  data-testid={`view-${v}`}
                >
                  <Icon className="h-4 w-4" /> {t(`aiTeam.views.${v}`)}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            {data.canManage ? (
              <Button onClick={() => setHireOpen(true)} data-testid="hire-open">
                <Plus className="h-4 w-4" /> {t("aiTeam.hire.title")}
              </Button>
            ) : null}
          </div>
          {!sorted.length ? (
            <div className="rounded-3xl border border-dashed border-line-strong p-10 text-center">
              <p className="font-semibold">{t("aiTeam.empty.title")}</p>
              <p className="mt-1 text-[13px] text-muted">{t("aiTeam.empty.body")}</p>
            </div>
          ) : view === "presentation" ? (
            <Presentation3D members={sorted} onEdit={open} onAdd={() => setHireOpen(true)} canManage={data.canManage} />
          ) : view === "grid" ? (
            <TeamGrid members={sorted} stats={data.stats} onOpen={open} />
          ) : (
            <TeamTree members={sorted} onOpen={open} />
          )}
        </div>
      ) : null}
      {tab === "goals" ? <GoalsPanel data={data} onRefresh={refresh} /> : null}
      {tab === "approvals" ? <ApprovalsPanel data={data} onRefresh={refresh} /> : null}
      {tab === "memory" && data.facts ? (
        <div className="mb-4">
          <FactsPanel facts={data.facts} canManage={data.canManage} locale={locale} now={data.now} onRefresh={refresh} />
        </div>
      ) : null}
      {tab === "memory" ? <MemoryPanel data={data} onRefresh={refresh} /> : null}
      {tab === "playbooks" ? <PlaybooksPanel data={data} roles={ROLE_KEYS} onRefresh={refresh} /> : null}
      {tab === "meeting" ? <MeetingPanel data={data} /> : null}
      {tab === "activity" ? <ActivityPanel data={data} onRefresh={refresh} /> : null}
      {tab === "settings" ? <SettingsPanel data={data} onRefresh={refresh} /> : null}

      <Dialog open={hireOpen} onOpenChange={setHireOpen} title={t("aiTeam.hire.title")} description={t("aiTeam.hire.body")} className="sm:max-w-4xl">
        <HireGallery roles={ROLE_KEYS} onPick={hire} />
      </Dialog>

      {editor ? (
        <MemberEditor
          key={editor.id ?? `new-${editor.role_key}`}
          open
          onOpenChange={(v) => !v && setEditor(null)}
          draft={editor}
          members={data.members}
          tools={data.toolCatalog}
          memory={data.memory}
          tasks={data.tasks}
          stats={editor.id ? data.stats[editor.id] : undefined}
          canManage={data.canManage}
          roles={ROLE_KEYS}
        />
      ) : null}
    </div>
  );
}
