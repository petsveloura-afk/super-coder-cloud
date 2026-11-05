"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, Check, CheckCheck, CircleHelp, Lightbulb, ListChecks, Play, Plus, Search, Send, ShieldAlert, Sparkles, Target, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { AgentAvatar } from "./avatar";
import { HealthPanel } from "./health-panel";
import { OpsPanel } from "./ops-panel";
import type { ActivityView, ApprovalView, MemoryView, StatsView, TeamMemberView, TeamPageData, TeamTaskView } from "./types";
import { PLAYBOOKS } from "@/lib/team/playbooks";
import {
  answerQuestionAction,
  approveManyAction,
  cancelTaskAction,
  confirmGoalAction,
  createTaskAction,
  decideApprovalAction,
  emergencyStopAction,
  memoryAction,
  planGoalAction,
  runTaskNowAction,
  saveRoutingAction,
  saveTeamSettingsAction,
  savePlaybookExtraAction,
  setTeamEnabledAction,
  setTeamFlagAction,
} from "@/app/[locale]/(dashboard)/ai-team/actions";

const memberOf = (members: TeamMemberView[], id: string | null) => members.find((m) => m.id === id) ?? null;
const ago = (iso: string, locale: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale === "en" ? "en" : locale === "ar" ? "ar" : "he", { numeric: "auto" });
  return Math.abs(min) < 60 ? rtf.format(-min, "minute") : Math.abs(min) < 1440 ? rtf.format(-Math.round(min / 60), "hour") : rtf.format(-Math.round(min / 1440), "day");
};

/* ================================================================== hire gallery */
export function HireGallery({ roles, onPick }: { roles: readonly string[]; onPick: (role: string) => void }) {
  const { t } = useI18n();
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="hire-gallery">
      {roles.map((r) => {
        const pb = PLAYBOOKS[r as keyof typeof PLAYBOOKS];
        return (
          <li key={r}>
            <button type="button" onClick={() => onPick(r)} className="glow-ring flex h-full w-full flex-col items-center gap-2 rounded-3xl border border-line bg-surface p-4 text-center" data-testid={`hire-${r}`}>
              <AgentAvatar spec={{ hue: [222, 262, 168, 142, 330, 28, 200, 190, 45, 280, 95, 50, 210][roles.indexOf(r) % 13], accessory: ({ manager: "tie", team_lead: "clipboard", customer_service: "headset", sales: "star", marketing: "megaphone", content_writer: "pen", web_builder: "brush", analyst: "chart", project_coordinator: "clipboard", quality_control: "shield", collections: "coin", reputation: "star", custom: "spark" } as Record<string, string>)[r] }} size={64} />
              <span className="font-bold">{t(`aiTeam.roles.${r}`)}</span>
              <span className="line-clamp-3 text-[11.5px] text-muted">{pb ? t(`aiTeam.roleAbout.${r}`) : ""}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ================================================================== goals + board */
export function GoalsPanel({ data, onRefresh }: { data: TeamPageData; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [taskFor, setTaskFor] = useState<{ memberId: string; title: string; brief?: string }>({ memberId: data.members[0]?.id ?? "", title: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const goals = data.tasks.filter((x) => x.plan && (x.plan as { goal?: boolean }).goal);
  const drafts = goals.filter((g) => g.status === "draft");
  const active = goals.filter((g) => ["in_progress", "blocked"].includes(g.status));
  const progressGoals = [...active, ...goals.filter((g) => ["done", "failed"].includes(g.status)).slice(0, 4)];
  const questions = data.tasks.filter((x) => x.status === "awaiting_input");
  const proposals = data.tasks.filter((x) => x.status === "draft" && x.origin === "initiative");
  const live = active.length > 0 || data.tasks.some((x) => x.status === "in_progress");

  // live progress: refresh while the team works
  useEffect(() => {
    if (!live) return;
    const id = setInterval(onRefresh, 6000);
    return () => clearInterval(id);
  }, [live, onRefresh]);

  const run = async (k: string, fn: () => Promise<{ error?: string; message?: string; messageParams?: Record<string, string | number> }>) => {
    setBusy(k);
    const r = await fn();
    setBusy(null);
    if (r.error) toast.error(t(r.error, r.messageParams));
    else toast.success(t(r.message ?? "common.saved", r.messageParams));
    onRefresh();
  };

  return (
    <div className="space-y-4" data-testid="goals-panel">
      <Card className="shine-border overflow-hidden">
        <div className="hero-mesh flex items-center gap-3 border-b border-line px-5 py-3">
          <Target className="h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold">{t("aiTeam.goal.title")}</h2>
            <p className="text-[12.5px] text-muted">{t("aiTeam.goal.hint")}</p>
          </div>
        </div>
        <div className="space-y-2 p-4">
          <Textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("aiTeam.goal.placeholder")} data-testid="goal-input" />
          <div className="flex flex-wrap items-center gap-1.5" data-testid="goal-suggestions">
            <span className="text-[11.5px] text-subtle">{t("aiTeam.goal.suggestHint")}</span>
            {["s1", "s2", "s3", "s4", "s5", "s6"].map((k) => (
              <button key={k} type="button" onClick={() => setGoal(t(`aiTeam.goal.suggest.${k}`))} className="max-w-full truncate rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-accent hover:text-accent" title={t(`aiTeam.goal.suggest.${k}`)}>
                {t(`aiTeam.goal.suggest.${k}`)}
              </button>
            ))}
          </div>
          <Button loading={busy === "plan"} disabled={goal.trim().length < 5 || !data.settings.enabled || data.settings.emergency_stop} onClick={() => run("plan", async () => { const r = await planGoalAction({ locale, goal }); if (!r.error) setGoal(""); return r; })} data-testid="goal-plan">
            <Sparkles className="h-4 w-4" /> {t("aiTeam.goal.cta")}
          </Button>
        </div>
      </Card>

      {drafts.map((g) => {
        const plan = g.plan as { understanding?: string; tasks?: { key: string; title: string; brief: string; role: string; depends_on: string[]; assignee: string | null; priority: number }[]; risks?: string[]; estimate?: number };
        return (
          <Card key={g.id} className="p-4" data-testid="goal-draft">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone="warning">{t("aiTeam.goal.review")}</Badge>
              <h3 className="font-bold">{g.title}</h3>
            </div>
            {plan.understanding ? <p className="mb-3 text-[13px] text-muted">{plan.understanding}</p> : null}
            {g.question ? <p className="mb-3 rounded-xl bg-warning/10 p-2.5 text-[13px]">❓ {g.question}</p> : null}
            <ol className="space-y-2">
              {(plan.tasks ?? []).map((x, i) => {
                const m = memberOf(data.members, x.assignee);
                return (
                  <li key={x.key} className="flex items-start gap-3 rounded-2xl border border-line p-2.5">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{i + 1}</span>
                    {m ? <AgentAvatar spec={m.avatar} size={36} /> : null}
                    <div className="min-w-0 flex-1 text-[13px]">
                      <p className="font-semibold">{x.title}</p>
                      <p className="text-[12px] text-muted">
                        {m?.name ?? t(`aiTeam.roles.${x.role}`)}
                        {x.depends_on.length ? ` · ${t("aiTeam.goal.after")} ${x.depends_on.map((k) => (plan.tasks ?? []).findIndex((y) => y.key === k) + 1).filter((n) => n > 0).join(", ")}` : ` · ${t("aiTeam.goal.parallel")}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {plan.risks?.length ? <p className="mt-2 text-[12px] text-subtle">⚠️ {plan.risks.join(" · ")}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button loading={busy === `c${g.id}`} onClick={() => run(`c${g.id}`, () => confirmGoalAction({ locale, goalId: g.id }))} data-testid="goal-confirm">
                <Check className="h-4 w-4" /> {t("aiTeam.goal.approve")}
              </Button>
              <Button variant="ghost" onClick={() => run(`x${g.id}`, () => cancelTaskAction({ locale, taskId: g.id }))}>
                <X className="h-4 w-4" /> {t("common.cancel")}
              </Button>
              <span className="text-[12px] text-subtle">{t("aiTeam.goal.estimate", { n: plan.estimate ?? 0 })}</span>
            </div>
          </Card>
        );
      })}

      {questions.length ? (
        <Card className="p-4" data-testid="team-questions">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <CircleHelp className="h-4 w-4 text-warning" /> {t("aiTeam.questions.title")}
          </h3>
          <ul className="space-y-2">
            {questions.map((q) => {
              const m = memberOf(data.members, q.assignee_id);
              const esc = (q.question ?? "").startsWith("escalate:");
              return (
                <li key={q.id} className="rounded-2xl border border-line p-3">
                  <div className="mb-1 flex items-center gap-2 text-[12.5px]">
                    {m ? <AgentAvatar spec={m.avatar} state="waiting" size={30} /> : null}
                    <span className="font-semibold">{m?.name}</span>
                    <span className="text-muted">· {q.title}</span>
                  </div>
                  <p className="mb-2 text-[13px]">{esc ? t(`aiTeam.questions.escalate.${(q.question ?? "").slice(9)}`) : q.question}</p>
                  {!esc ? (
                    <div className="flex gap-2">
                      <Input value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder={t("aiTeam.questions.answer")} />
                      <Button size="sm" disabled={!(answers[q.id] ?? "").trim()} onClick={() => run(`a${q.id}`, () => answerQuestionAction({ locale, taskId: q.id, answer: answers[q.id] ?? "" }))}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => run(`x${q.id}`, () => cancelTaskAction({ locale, taskId: q.id }))}>
                      {t("aiTeam.questions.handled")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {proposals.length ? (
        <Card className="p-4" data-testid="team-proposals">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Lightbulb className="h-4 w-4 text-gold" /> {t("aiTeam.proposals.title")}
          </h3>
          <ul className="space-y-2">
            {proposals.map((p) => {
              const m = memberOf(data.members, p.assignee_id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3 text-[13px]">
                  {m ? <AgentAvatar spec={m.avatar} size={30} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{p.title}</span>
                    <span className="block text-[12px] text-muted">{p.brief}</span>
                  </span>
                  <Button size="sm" loading={busy === `r${p.id}`} onClick={() => run(`r${p.id}`, () => runTaskNowAction({ locale, taskId: p.id }))}>
                    <Play className="h-3.5 w-3.5" /> {t("aiTeam.proposals.start")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => run(`x${p.id}`, () => cancelTaskAction({ locale, taskId: p.id }))}>
                    {t("aiTeam.proposals.dismiss")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {progressGoals.length ? (
        <Card className="p-4" data-testid="goal-progress">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <Target className="h-4 w-4 text-accent" /> {t("aiTeam.goal.progressTitle")}
          </h3>
          <ul className="space-y-3">
            {progressGoals.map((g) => {
              const kids = data.tasks.filter((x) => x.goal_id === g.id && x.id !== g.id);
              const done = kids.filter((x) => x.status === "done").length;
              const pct = kids.length ? Math.round((done / kids.length) * 100) : 0;
              const summary = String((g.result as { summary?: string } | null)?.summary ?? "");
              const m = memberOf(data.members, g.assignee_id);
              return (
                <li key={g.id} className="feed-in rounded-2xl border border-line p-3 text-[13px]">
                  <div className="flex items-center gap-2">
                    {m ? <AgentAvatar spec={m.avatar} state={g.status === "in_progress" ? "working" : g.status === "done" ? "success" : "idle"} size={30} /> : null}
                    <span className="min-w-0 flex-1 font-semibold">{g.title}</span>
                    <Badge tone={g.status === "in_progress" ? "accent" : "neutral"}>{g.status === "done" && kids.length > 0 && done < kids.length ? t("aiTeam.goal.partial") : t(`aiTeam.status.${g.status}`)}</Badge>
                  </div>
                  {kids.length ? (
                    <div className="mt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-[11.5px] text-muted">{t("aiTeam.goal.tasksDone", { done, total: kids.length })}</p>
                    </div>
                  ) : null}
                  {summary ? (
                    <details className="mt-2 rounded-xl bg-accent-soft/40 p-2.5" open={g.status === "done"}>
                      <summary className="cursor-pointer text-[12.5px] font-semibold text-accent">{t("aiTeam.goal.summaryTitle")}</summary>
                      <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-6">{summary}</p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <TaskBoard data={data} busy={busy} onRun={(id) => run(`r${id}`, () => runTaskNowAction({ locale, taskId: id }))} onCancel={(id) => run(`x${id}`, () => cancelTaskAction({ locale, taskId: id }))} />

      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Plus className="h-4 w-4" /> {t("aiTeam.task.direct")}
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={taskFor.memberId} onChange={(e) => setTaskFor({ ...taskFor, memberId: e.target.value })} className="sm:w-56" aria-label={t("aiTeam.task.who")}>
            {data.members.filter((m) => m.status === "active").map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          {data.templates?.length ? (
            <Select
              value=""
              onChange={(e) => {
                const tpl = data.templates?.find((x) => x.id === e.target.value);
                if (tpl) setTaskFor({ ...taskFor, title: t(`aiTeam.tpl.${tpl.id}`), brief: tpl.brief });
              }}
              className="sm:w-56"
              aria-label={t("aiTeam.task.template")}
              data-testid="task-template"
            >
              <option value="">{t("aiTeam.task.template")}</option>
              {data.templates.filter((x) => x.role === data.members.find((m) => m.id === taskFor.memberId)?.role_key).map((x) => (
                <option key={x.id} value={x.id}>
                  {t(`aiTeam.tpl.${x.id}`)}
                </option>
              ))}
            </Select>
          ) : null}
          <Input value={taskFor.title} onChange={(e) => setTaskFor({ ...taskFor, title: e.target.value, brief: e.target.value ? taskFor.brief : undefined })} placeholder={t("aiTeam.task.placeholder")} className="flex-1" />
          <Button disabled={taskFor.title.trim().length < 3 || !taskFor.memberId} loading={busy === "task"} onClick={() => run("task", async () => { const r = await createTaskAction({ locale, memberId: taskFor.memberId, title: taskFor.title, brief: taskFor.brief }); if (!r.error) setTaskFor({ ...taskFor, title: "", brief: undefined }); return r; })}>
            {t("aiTeam.task.add")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

const COLUMNS: { key: string; statuses: string[] }[] = [
  { key: "pending", statuses: ["pending", "blocked"] },
  { key: "in_progress", statuses: ["in_progress"] },
  { key: "awaiting", statuses: ["awaiting_approval", "awaiting_input"] },
  { key: "done", statuses: ["done", "failed", "canceled"] },
];

function TaskBoard({ data, busy, onRun, onCancel }: { data: TeamPageData; busy: string | null; onRun: (id: string) => void; onCancel: (id: string) => void }) {
  const { t, locale } = useI18n();
  const tasks = data.tasks.filter((x) => !(x.plan as { goal?: boolean })?.goal && x.status !== "draft");
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="task-board">
      {COLUMNS.map((c) => {
        const list = tasks.filter((x) => c.statuses.includes(x.status)).slice(0, 25);
        return (
          <section key={c.key} className="rounded-3xl border border-line bg-surface/60 p-3">
            <h3 className="mb-2 flex items-center justify-between text-[13px] font-semibold">
              {t(`aiTeam.board.${c.key}`)} <Badge tone="neutral">{list.length}</Badge>
            </h3>
            <ul className="space-y-2">
              {list.map((x) => {
                const m = memberOf(data.members, x.assignee_id);
                const report = String((x.result as { report?: string })?.report ?? "");
                return (
                  <li key={x.id} className="feed-in rounded-2xl border border-line bg-surface p-2.5 text-[12.5px]">
                    <div className="flex items-start gap-2">
                      {m ? <AgentAvatar spec={m.avatar} state={x.status === "in_progress" ? "working" : x.status.startsWith("awaiting") ? "waiting" : x.status === "done" ? "success" : x.status === "failed" ? "error" : "idle"} size={28} /> : null}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{x.title}</p>
                        <p className="text-[11px] text-subtle">
                          {m?.name ?? "—"} · {t(`aiTeam.status.${x.status}`)} · {ago(x.created_at, locale)}
                          {x.depends_on.length ? ` · 🔗 ${x.depends_on.length}` : ""}
                        </p>
                        {report ? <p className="mt-1 line-clamp-3 text-[11.5px] text-muted">{report}</p> : null}
                      </div>
                    </div>
                    {x.status === "pending" || x.status === "blocked" ? (
                      <div className="mt-1.5 flex gap-1">
                        {x.status === "pending" ? (
                          <Button size="sm" variant="secondary" loading={busy === `r${x.id}`} onClick={() => onRun(x.id)}>
                            <Play className="h-3.5 w-3.5" /> {t("aiTeam.task.runNow")}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => onCancel(x.id)}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ================================================================== approvals */
export function ApprovalsPanel({ data, onRefresh }: { data: TeamPageData; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // optimistic: a decided item leaves the queue at once (it comes back if the server refuses)
  const [gone, setGone] = useState<string[]>([]);
  const pending = data.approvals.filter((a) => a.status === "pending" && !gone.includes(a.id));
  const decide = async (a: ApprovalView, kind: "approve" | "reject" | "edit") => {
    setBusy(a.id + kind);
    setGone((g) => [...g, a.id]);
    const r = await decideApprovalAction({ locale, id: a.id, kind, note: notes[a.id], text: kind === "edit" ? edits[a.id] : undefined });
    setBusy(null);
    if (r.error) {
      setGone((g) => g.filter((x) => x !== a.id));
      toast.error(`${t(r.error, r.messageParams)}`);
    } else toast.success(t(r.message ?? "common.saved"));
    onRefresh();
  };
  if (!pending.length) return <EmptyState icon={<CheckCheck className="h-6 w-6" />} title={t("aiTeam.approvals.emptyTitle")} body={t("aiTeam.approvals.emptyBody")} />;
  return (
    <div className="space-y-3" data-testid="approvals-panel">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={sel.length === pending.length} onChange={(e) => setSel(e.target.checked ? pending.map((a) => a.id) : [])} />
          {t("aiTeam.approvals.selectAll")}
        </label>
        <Button
          size="sm"
          disabled={!sel.length}
          loading={busy === "bulk"}
          onClick={async () => {
            setBusy("bulk");
            const r = await approveManyAction({ locale, ids: sel });
            setBusy(null);
            toast(t(r.message ?? "common.saved", r.messageParams));
            setSel([]);
            onRefresh();
          }}
          data-testid="approve-many"
        >
          <CheckCheck className="h-4 w-4" /> {t("aiTeam.approvals.approveSelected", { n: sel.length })}
        </Button>
      </div>
      {pending.map((a) => {
        const m = memberOf(data.members, a.member_id);
        const text = String(a.payload.text ?? a.payload.body ?? "");
        return (
          <Card key={a.id} className="p-4" data-testid="approval-item">
            <div className="flex flex-wrap items-start gap-3">
              <input type="checkbox" className="mt-2 h-4 w-4 accent-[var(--accent)]" checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} aria-label={t("aiTeam.approvals.select")} />
              {m ? <AgentAvatar spec={m.avatar} state="waiting" size={44} /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{m?.name ?? "—"}</span>
                  <Badge tone={a.sensitivity === "money" ? "danger" : a.sensitivity === "customer" ? "warning" : "neutral"}>{t(`aiTeam.sens.${a.sensitivity}`)}</Badge>
                  <span className="text-[12px] text-muted">{t(`aiTeam.tools.${a.tool.replace(".", "_")}`)}</span>
                  <span className="text-[11px] text-subtle">{ago(a.created_at, locale)}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">
                  <span className="font-medium text-fg">{t("aiTeam.approvals.why")}:</span> {a.reason || "—"}
                </p>
                {text ? (
                  <Textarea className="mt-2" rows={Math.min(8, Math.max(3, Math.ceil(text.length / 70)))} value={edits[a.id] ?? text} onChange={(e) => setEdits({ ...edits, [a.id]: e.target.value })} aria-label={t("aiTeam.approvals.edit")} />
                ) : (
                  <pre dir="ltr" className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-elevated p-2.5 text-[11.5px]">{a.preview}</pre>
                )}
                <Input className="mt-2" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} placeholder={t("aiTeam.approvals.notePlaceholder")} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {edits[a.id] !== undefined && edits[a.id] !== text ? (
                    <Button size="sm" loading={busy === a.id + "edit"} onClick={() => decide(a, "edit")} data-testid="approval-edit">
                      <Check className="h-4 w-4" /> {t("aiTeam.approvals.approveEdited")}
                    </Button>
                  ) : (
                    <Button size="sm" loading={busy === a.id + "approve"} onClick={() => decide(a, "approve")} data-testid="approval-approve">
                      <Check className="h-4 w-4" /> {t("aiTeam.approvals.approve")}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" loading={busy === a.id + "reject"} onClick={() => decide(a, "reject")} data-testid="approval-reject">
                    <X className="h-4 w-4" /> {t("aiTeam.approvals.reject")}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ================================================================== memory */
export function MemoryPanel({ data, onRefresh }: { data: TeamPageData; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [who, setWho] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [add, setAdd] = useState({ content: "", kind: "fact", memberId: "" });
  const [edit, setEdit] = useState<{ id: string; content: string } | null>(null);
  const weekAgo = data.now - 7 * 86_400_000;
  const learned = data.memory.filter((m) => m.status === "proposed" || (m.layer === "semantic" && Date.parse(m.created_at) >= weekAgo && m.status === "active"));
  const list = useMemo(
    () =>
      data.memory.filter(
        (m) =>
          (who === "all" || (who === "shared" ? m.member_id === null : m.member_id === who)) &&
          (status === "all" || m.status === status) &&
          (!q.trim() || `${m.subject ?? ""} ${m.content}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [data.memory, who, status, q],
  );
  const op = async (o: "confirm" | "revoke" | "delete" | "edit" | "add" | "reset", extra: Record<string, unknown> = {}) => {
    const r = await memoryAction({ locale, op: o, ...extra } as never);
    if (r.error) return toast.error(t(r.error));
    toast.success(t("common.saved"));
    setEdit(null);
    onRefresh();
  };
  return (
    <div className="space-y-4" data-testid="memory-panel">
      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Lightbulb className="h-4 w-4 text-gold" /> {t("aiTeam.mem.week")}
        </h3>
        {learned.length ? (
          <ul className="space-y-2">
            {learned.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="text-[11.5px] text-subtle">{memberOf(data.members, m.member_id)?.name ?? t("aiTeam.mem.shared")} · </span>
                  {m.content}
                </span>
                {data.canManage && m.status === "proposed" ? (
                  <>
                    <Button size="sm" onClick={() => op("confirm", { id: m.id })}>
                      <Check className="h-3.5 w-3.5" /> {t("aiTeam.mem.confirm")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => op("revoke", { id: m.id })}>
                      {t("aiTeam.mem.revoke")}
                    </Button>
                  </>
                ) : (
                  <Badge tone="success">{t("aiTeam.mem.status.active")}</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">{t("aiTeam.mem.weekEmpty")}</p>
        )}
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("aiTeam.mem.search")} className="ps-9" />
        </div>
        <Select value={who} onChange={(e) => setWho(e.target.value)} className="sm:w-48" aria-label={t("aiTeam.mem.who")}>
          <option value="all">{t("aiTeam.mem.all")}</option>
          <option value="shared">{t("aiTeam.mem.shared")}</option>
          {data.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40" aria-label={t("aiTeam.mem.statusLabel")}>
          {["all", "active", "proposed", "revoked", "expired"].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? t("aiTeam.mem.all") : t(`aiTeam.mem.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <ul className="space-y-2">
        {list.slice(0, 120).map((m: MemoryView) => (
          <li key={m.id} className="rounded-2xl border border-line bg-surface p-3 text-[13px]">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <Badge tone="neutral">{t(`aiTeam.mem.layer.${m.layer}`)}</Badge>
              <Badge tone="neutral">{t(`aiTeam.mem.kind.${m.kind}`)}</Badge>
              <Badge tone={m.status === "active" ? "success" : m.status === "proposed" ? "warning" : "neutral"}>{t(`aiTeam.mem.status.${m.status}`)}</Badge>
              <span className="text-subtle">{memberOf(data.members, m.member_id)?.name ?? t("aiTeam.mem.shared")} · {Math.round(m.confidence * 100)}% · {ago(m.created_at, locale)}</span>
            </div>
            {edit?.id === m.id ? (
              <div className="flex gap-2">
                <Input value={edit.content} onChange={(e) => setEdit({ id: m.id, content: e.target.value })} />
                <Button size="sm" onClick={() => op("edit", { id: m.id, content: edit.content })}>
                  {t("common.save")}
                </Button>
              </div>
            ) : (
              <p>
                {m.content}
                {m.count && m.count > 1 ? <span className="ms-1.5 text-[11.5px] text-subtle">×{m.count}</span> : null}
              </p>
            )}
            {data.canManage ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEdit({ id: m.id, content: m.raw ?? m.content })}>{t("common.edit")}</Button>
                {m.status !== "revoked" ? <Button size="sm" variant="ghost" onClick={() => op("revoke", { id: m.id })}>{t("aiTeam.mem.revoke")}</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => op("delete", { id: m.id })}>{t("common.delete")}</Button>
              </div>
            ) : null}
          </li>
        ))}
        {!list.length ? <li className="rounded-2xl bg-elevated p-6 text-center text-[13px] text-muted">{t("aiTeam.mem.empty")}</li> : null}
      </ul>

      {data.canManage ? (
        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t("aiTeam.mem.addTitle")}</h3>
          <div className="grid gap-2 sm:grid-cols-[1fr_160px_180px_auto]">
            <Input value={add.content} onChange={(e) => setAdd({ ...add, content: e.target.value })} placeholder={t("aiTeam.mem.addPlaceholder")} />
            <Select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })} aria-label={t("aiTeam.mem.kindLabel")}>
              {["fact", "preference", "forbidden", "policy"].map((k) => (
                <option key={k} value={k}>
                  {t(`aiTeam.mem.kind.${k}`)}
                </option>
              ))}
            </Select>
            <Select value={add.memberId} onChange={(e) => setAdd({ ...add, memberId: e.target.value })} aria-label={t("aiTeam.mem.who")}>
              <option value="">{t("aiTeam.mem.shared")}</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Button disabled={add.content.trim().length < 2} onClick={async () => { await op("add", { content: add.content, kind: add.kind, memberId: add.memberId || null }); setAdd({ ...add, content: "" }); }}>
              <Plus className="h-4 w-4" /> {t("common.add")}
            </Button>
          </div>
          <ConfirmReset label={t("aiTeam.mem.resetShared")} onConfirm={() => op("reset", { memberId: null })} />
        </Card>
      ) : null}
    </div>
  );
}

/** a destructive reset needs a second, explicit click (no browser dialogs) */
export function ConfirmReset({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const { t } = useI18n();
  const [ask, setAsk] = useState(false);
  return ask ? (
    <span className="mt-3 inline-flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="font-medium text-danger">{t("aiTeam.mem.resetSure")}</span>
      <Button size="sm" variant="danger" onClick={() => { setAsk(false); onConfirm(); }} data-testid="reset-confirm">
        {t("aiTeam.mem.resetYes")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsk(false)}>
        {t("common.cancel")}
      </Button>
    </span>
  ) : (
    <Button className="mt-3" variant="danger" size="sm" onClick={() => setAsk(true)} data-testid="reset-ask">
      {label}
    </Button>
  );
}

/* ================================================================== playbooks */
export function PlaybooksPanel({ data, roles, onRefresh }: { data: TeamPageData; roles: readonly string[]; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const [role, setRole] = useState<string>(data.members[0]?.role_key ?? "manager");
  const [extra, setExtra] = useState<string>(data.playbookExtras[role] ?? "");
  const pb = PLAYBOOKS[role as keyof typeof PLAYBOOKS];
  const txt = locale === "he" ? pb.he : pb.en;
  const sections: [string, string[]][] = [
    ["kpis", txt.kpis],
    ["sop", txt.sop],
    ["standards", txt.standards],
    ["templates", txt.templates],
    ["forbidden", txt.forbidden],
    ["checklist", txt.checklist],
    ["escalation", txt.escalation],
  ];
  return (
    <div className="space-y-4" data-testid="playbooks-panel">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {roles.map((r) => (
          <button key={r} role="tab" aria-selected={role === r} onClick={() => { setRole(r); setExtra(data.playbookExtras[r] ?? ""); }} className={cn("rounded-full border px-3 py-1.5 text-[12.5px] font-medium", role === r ? "border-transparent bg-accent-solid text-accent-fg" : "border-line text-muted hover:bg-surface-hover")}>
            {t(`aiTeam.roles.${r}`)}
          </button>
        ))}
      </div>
      <Card className="p-5">
        <h3 className="text-lg font-bold">{t(`aiTeam.roles.${role}`)}</h3>
        <p className="mt-1 text-[13.5px] text-muted">{txt.mission}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {sections.map(([k, list]) => (
            <section key={k} className={cn("rounded-2xl border p-3", k === "forbidden" ? "border-danger/30 bg-danger/5" : "border-line")}>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                {k === "forbidden" ? <ShieldAlert className="h-4 w-4 text-danger" /> : <ListChecks className="h-4 w-4 text-accent" />} {t(`aiTeam.pb.${k}`)}
              </h4>
              <ul className="list-disc space-y-1 ps-5 text-[12.5px]">
                {list.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </section>
          ))}
          <section className="rounded-2xl border border-success/30 bg-success/5 p-3 text-[12.5px]">
            <h4 className="mb-1 font-semibold">{t("aiTeam.pb.good")}</h4>
            <p>{txt.good}</p>
          </section>
          <section className="rounded-2xl border border-danger/30 bg-danger/5 p-3 text-[12.5px]">
            <h4 className="mb-1 font-semibold">{t("aiTeam.pb.bad")}</h4>
            <p>{txt.bad}</p>
          </section>
        </div>
        <Field label={t("aiTeam.pb.extra")} htmlFor="pb-extra" hint={t("aiTeam.pb.extraHint")}>
          <Textarea id="pb-extra" rows={5} value={extra} maxLength={6000} onChange={(e) => setExtra(e.target.value)} disabled={!data.canManage} className="mt-4" />
        </Field>
        {data.canManage ? (
          <Button className="mt-2" onClick={async () => { const r = await savePlaybookExtraAction({ locale, role, extra }); if (r.error) toast.error(t(r.error)); else { toast.success(t("common.saved")); onRefresh(); } }}>
            {t("common.save")}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}

/* ================================================================== meeting + performance */
export function MeetingPanel({ data }: { data: TeamPageData }) {
  const { t, locale } = useI18n();
  const rows = data.members.map((m) => ({ m, s: data.stats[m.id] as StatsView | undefined }));
  return (
    <div className="space-y-4" data-testid="meeting-panel">
      <Card className="shine-border p-5">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Sparkles className="h-5 w-5 text-accent" /> {t("aiTeam.meeting.title")}
        </h3>
        {data.meeting ? (
          <>
            <p className="mt-1 text-[12px] text-subtle">{new Date(data.meeting.created_at).toLocaleDateString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL")}</p>
            <div className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{data.meeting.narrative ?? t("aiTeam.meeting.factsOnly")}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
              <Badge tone="success">{t("aiTeam.meeting.done", { n: Number(data.meeting.facts.done ?? 0) })}</Badge>
              <Badge tone="neutral">{t("aiTeam.meeting.credits", { n: Number(data.meeting.facts.credits ?? 0) })}</Badge>
              <Badge tone="accent">{t("aiTeam.meeting.learned", { n: Number(data.meeting.facts.learnings ?? 0) })}</Badge>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-muted">{t("aiTeam.meeting.none")}</p>
        )}
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-[13px]">
          <caption className="p-4 text-start font-semibold">{t("aiTeam.perf.title")}</caption>
          <thead className="bg-elevated text-[12px] text-muted">
            <tr>
              {["employee", "done", "approval", "rejection", "avg", "credits", "escalations"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                  {t(`aiTeam.metrics.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, s }) => (
              <tr key={m.id} className="border-t border-line">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <AgentAvatar spec={m.avatar} size={28} /> {m.name}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{s?.done ?? 0}</td>
                <td className="px-3 py-2 tabular-nums">{s?.approvalRate ?? "—"}{s?.approvalRate !== null && s?.approvalRate !== undefined ? "%" : ""}</td>
                <td className="px-3 py-2 tabular-nums">{s?.rejectionRate ?? "—"}{s?.rejectionRate !== null && s?.rejectionRate !== undefined ? "%" : ""}</td>
                <td className="px-3 py-2 tabular-nums">{s?.avgMinutes ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{s?.credits ?? 0}</td>
                <td className="px-3 py-2 tabular-nums">{s?.escalations ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ================================================================== activity timeline */
export function ActivityPanel({ data, onRefresh }: { data: TeamPageData; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  useEffect(() => {
    const id = setInterval(onRefresh, 8000);
    return () => clearInterval(id);
  }, [onRefresh]);
  if (!data.activity.length) return <EmptyState icon={<Sparkles className="h-6 w-6" />} title={t("aiTeam.activity.emptyTitle")} body={t("aiTeam.activity.emptyBody")} />;
  return (
    <ol className="relative space-y-2 border-s border-line ps-5" aria-live="polite" data-testid="activity-panel">
      {data.activity.map((a: ActivityView) => {
        const m = memberOf(data.members, a.member_id);
        return (
          <li key={a.id} className="feed-in relative">
            <span className={cn("absolute -start-[27px] top-2 h-3 w-3 rounded-full border-2 border-bg", a.ok ? "bg-accent" : "bg-danger")} aria-hidden />
            <div className="rounded-2xl border border-line bg-surface p-2.5 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                {m ? <AgentAvatar spec={m.avatar} size={24} /> : null}
                <span className="font-semibold">{m?.name ?? t("aiTeam.activity.system")}</span>
                <Badge tone="neutral">{t(`aiTeam.phase.${a.phase}`)}</Badge>
                <span className="text-[11px] text-subtle">{ago(a.created_at, locale)}</span>
              </div>
              <p className="mt-1">{a.summary}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ================================================================== settings (incl. emergency stop) */
export function SettingsPanel({ data, onRefresh }: { data: TeamPageData; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const [s, setS] = useState(data.settings);
  const [routes, setRoutes] = useState<Record<string, string>>(Object.fromEntries(data.routing.map((r) => [r.kind, r.models.map((m) => `${m.provider}/${m.model}`).join("\n")])));
  const act = async (fn: () => Promise<{ error?: string; message?: string }>) => {
    try {
      const r = await fn();
      if (r.error) toast.error(t(r.error));
      else toast.success(t(r.message ?? "common.saved"));
    } catch (e) {
      console.error("[ai-team] settings action failed", e);
      toast.error(t("common.error"));
    }
    onRefresh();
  };
  return (
    <div className="space-y-4" data-testid="settings-panel">
      {data.health ? <HealthPanel health={data.health} /> : null}
      {data.ops ? <OpsPanel ops={data.ops} sla={data.sla} canManage={data.canManage} locale={locale} onRefresh={onRefresh} /> : null}
      <Card className={cn("p-5", s.emergency_stop && "border-danger/50 bg-danger/5")}>
        <div className="flex flex-wrap items-center gap-3">
          <AlertOctagon className={cn("h-8 w-8", s.emergency_stop ? "text-danger" : "text-muted")} />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold">{t("aiTeam.stop.title")}</h3>
            <p className="text-[12.5px] text-muted">{t(s.emergency_stop ? "aiTeam.stop.on" : "aiTeam.stop.body")}</p>
          </div>
          <Button variant={s.emergency_stop ? "secondary" : "danger"} onClick={() => act(async () => { const r = await emergencyStopAction({ locale, on: !s.emergency_stop }); if (!r.error) setS({ ...s, emergency_stop: !s.emergency_stop }); return r; })} data-testid="emergency-stop">
            {t(s.emergency_stop ? "aiTeam.stop.release" : "aiTeam.stop.cta")}
          </Button>
        </div>
      </Card>
      {data.canManage ? (
        <Card className="space-y-3 p-5">
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.enabled} onChange={(e) => {
                // optimistic: the box follows the click at once (and the value is read before awaiting); reverts if the server refuses
                const on = e.target.checked;
                const before = s;
                setS({ ...s, enabled: on });
                void act(async () => {
                  try {
                    const r = await setTeamEnabledAction({ locale, enabled: on });
                    if (r.error) setS(before);
                    return r;
                  } catch (err) {
                    setS(before);
                    throw err;
                  }
                });
              }} data-testid="team-enabled" />
            {t("aiTeam.settings.enabled")}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("aiTeam.settings.pref")} htmlFor="s-pref" hint={t("aiTeam.settings.prefHint")}>
              <Select id="s-pref" value={s.routing_pref} onChange={(e) => setS({ ...s, routing_pref: e.target.value as typeof s.routing_pref })}>
                {(["quality", "balanced", "speed", "cost"] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`aiTeam.settings.prefs.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("aiTeam.settings.cap")} htmlFor="s-cap" hint={t("aiTeam.settings.capHint", { n: data.dayCredits })}>
              <Input id="s-cap" type="number" min={0} max={100000} value={s.daily_credit_cap} onChange={(e) => setS({ ...s, daily_credit_cap: Number(e.target.value) })} />
            </Field>
            <Field label={t("aiTeam.settings.depth")} htmlFor="s-depth">
              <Input id="s-depth" type="number" min={1} max={6} value={s.max_depth} onChange={(e) => setS({ ...s, max_depth: Number(e.target.value) })} />
            </Field>
            <Field label={t("aiTeam.settings.steps")} htmlFor="s-steps">
              <Input id="s-steps" type="number" min={1} max={60} value={s.max_steps} onChange={(e) => setS({ ...s, max_steps: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.initiative} onChange={(e) => setS({ ...s, initiative: e.target.checked })} />
            {t("aiTeam.settings.initiative")}
          </label>
          <Button onClick={() => act(() => saveTeamSettingsAction({ locale, routing_pref: s.routing_pref, daily_credit_cap: s.daily_credit_cap, max_depth: s.max_depth, max_steps: s.max_steps, initiative: s.initiative }))}>{t("common.save")}</Button>
        </Card>
      ) : null}
      {data.platformAdmin ? (
        <Card className="space-y-3 border-dashed p-5">
          <h3 className="font-semibold">{t("aiTeam.admin.title")}</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => act(() => setTeamFlagAction({ locale, scope: "org", enabled: false }))}>{t("aiTeam.admin.flagOffOrg")}</Button>
            <Button size="sm" variant="secondary" onClick={() => act(() => setTeamFlagAction({ locale, scope: "global", enabled: true }))}>{t("aiTeam.admin.flagOnAll")}</Button>
            <Button size="sm" variant="ghost" onClick={() => act(() => setTeamFlagAction({ locale, scope: "global", enabled: false }))}>{t("aiTeam.admin.flagOffAll")}</Button>
          </div>
          <p className="text-[12.5px] text-muted">{t("aiTeam.admin.routingHint")}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {["plan", "review", "write", "site", "classify", "summarize", "vision"].map((k) => (
              <Field key={k} label={t(`aiTeam.admin.kinds.${k}`)} htmlFor={`r-${k}`}>
                <Textarea
                  id={`r-${k}`}
                  dir="ltr"
                  rows={3}
                  value={routes[k] ?? ""}
                  onChange={(e) => setRoutes({ ...routes, [k]: e.target.value })}
                  placeholder={data.models.slice(0, 2).map((m) => `${m.provider}/${m.model}`).join("\n") || "provider/model"}
                  onBlur={() =>
                    act(() =>
                      saveRoutingAction({
                        locale,
                        kind: k,
                        models: (routes[k] ?? "")
                          .split("\n")
                          .map((x) => x.trim())
                          .filter(Boolean)
                          .map((x) => ({ provider: x.split("/")[0]!, model: x.split("/").slice(1).join("/") })),
                      }),
                    )
                  }
                />
              </Field>
            ))}
          </div>
          <p className="text-[11.5px] text-subtle" dir="ltr">
            {data.models.map((m) => `${m.provider}/${m.model}`).join(" · ") || "—"}
          </p>
        </Card>
      ) : null}
    </div>
  );
}

export type { TeamTaskView };
