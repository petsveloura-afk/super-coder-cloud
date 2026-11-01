"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, MessageSquare, Pause, Play, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ACCESSORIES, AgentAvatar, FACES, HAIRS, SKINS } from "./avatar";
import type { AvatarSpec, MemoryView, StatsView, TeamMemberView, TeamTaskView } from "./types";
import { ConfirmReset } from "./panels";
import { duplicateMemberAction, memoryAction, saveMemberAction, testChatAction } from "@/app/[locale]/(dashboard)/ai-team/actions";

/**
 * The full employee editor: profile + avatar (live preview), personality and instructions, tools and permissions,
 * autonomy (and which customer actions may run alone), memory (view / confirm / edit / delete / reset), task
 * history, performance, a test conversation, and activate / pause / duplicate. Also used to hire (no id yet).
 */
export interface EditorDraft {
  id?: string;
  role_key: string;
  name: string;
  title: string;
  avatar: AvatarSpec;
  tone: string;
  instructions: string;
  tools: string[];
  autonomy: "suggest" | "approve" | "auto";
  auto_actions: string[];
  reports_to: string | null;
  status: "active" | "paused";
  limits: { max_steps?: number; max_credits?: number };
}

const TABS = ["profile", "personality", "tools", "autonomy", "memory", "history", "performance", "test"] as const;
type Tab = (typeof TABS)[number];

export function MemberEditor({
  open,
  onOpenChange,
  draft: initial,
  members,
  tools,
  memory,
  tasks,
  stats,
  canManage,
  roles,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: EditorDraft;
  members: TeamMemberView[];
  tools: { key: string; kind: string; sensitivity: string; about: string }[];
  memory: MemoryView[];
  tasks: TeamTaskView[];
  stats?: StatsView;
  canManage: boolean;
  roles: readonly string[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [d, setD] = useState<EditorDraft>(initial);
  const [tab, setTab] = useState<Tab>("profile");
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [editMem, setEditMem] = useState<{ id: string; content: string } | null>(null);
  const isNew = !d.id;
  const myMemory = useMemo(() => memory.filter((m) => m.member_id === d.id), [memory, d.id]);
  const myTasks = useMemo(() => tasks.filter((x) => x.assignee_id === d.id).slice(0, 30), [tasks, d.id]);
  const set = <K extends keyof EditorDraft>(k: K, v: EditorDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setAv = (patch: Partial<AvatarSpec>) => setD((x) => ({ ...x, avatar: { ...x.avatar, ...patch } }));

  async function save() {
    setBusy(true);
    const r = await saveMemberAction({ locale, ...d, role_key: d.role_key as never, title: d.title, tone: d.tone, avatar: { hue: d.avatar.hue ?? 222, accessory: (d.avatar.accessory ?? "none") as never, face: d.avatar.face, skin: d.avatar.skin, hair: d.avatar.hair }, limits: d.limits });
    setBusy(false);
    if (r.error) return toast.error(t(r.error));
    toast.success(t(isNew ? "aiTeam.msg.hired" : "common.saved"));
    if (r.data?.id) setD((x) => ({ ...x, id: r.data!.id }));
    router.refresh();
    if (isNew) onOpenChange(false);
  }

  async function mem(op: "confirm" | "revoke" | "delete" | "edit" | "reset", id?: string, content?: string) {
    const r = await memoryAction({ locale, op, id, memberId: op === "reset" ? (d.id ?? null) : undefined, content });
    if (r.error) return toast.error(t(r.error));
    toast.success(t("common.saved"));
    setEditMem(null);
    router.refresh();
  }

  async function sendTest() {
    if (!msg.trim()) return;
    setBusy(true);
    const history = chat.slice(-10);
    const r = await testChatAction({ locale, role: d.role_key, name: d.name || t(`aiTeam.roles.${d.role_key}`), tone: d.tone, instructions: d.instructions, message: msg, history });
    setBusy(false);
    if (r.error || !r.data) return toast.error(t(r.error ?? "common.error"));
    setChat([...history, { role: "user", content: msg }, { role: "assistant", content: r.data.reply }]);
    setMsg("");
  }

  const writeTools = tools.filter((x) => d.tools.includes(x.key) && x.kind === "write" && x.sensitivity !== "internal");

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={isNew ? t("aiTeam.hire.title") : d.name} description={t(`aiTeam.roles.${d.role_key}`)} className="sm:max-w-3xl">
      <div className="space-y-4" data-testid="member-editor">
        <div className="hero-mesh flex items-center gap-4 rounded-3xl border border-line p-4">
          <AgentAvatar spec={d.avatar} state={d.status === "paused" ? "paused" : "idle"} size={92} label={d.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{d.name || t("aiTeam.editor.unnamed")}</p>
            <p className="truncate text-[13px] text-muted">{d.title || t(`aiTeam.roles.${d.role_key}`)}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone={d.status === "active" ? "success" : "neutral"}>{t(`aiTeam.live.${d.status === "active" ? "idle" : "paused"}`)}</Badge>
              <Badge tone="accent">{t(`aiTeam.autonomy.${d.autonomy}`)}</Badge>
            </div>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist">
          {TABS.filter((x) => !(isNew && (x === "memory" || x === "history" || x === "performance"))).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition", tab === x ? "border-transparent bg-accent-solid text-accent-fg" : "border-line text-muted hover:bg-surface-hover")}>
              {t(`aiTeam.editor.tabs.${x}`)}
            </button>
          ))}
        </div>

        {tab === "profile" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("aiTeam.editor.name")} htmlFor="m-name">
              <Input id="m-name" value={d.name} maxLength={80} onChange={(e) => set("name", e.target.value)} disabled={!canManage} data-testid="editor-name" />
            </Field>
            <Field label={t("aiTeam.editor.title")} htmlFor="m-title">
              <Input id="m-title" value={d.title} maxLength={120} onChange={(e) => set("title", e.target.value)} disabled={!canManage} />
            </Field>
            <Field label={t("aiTeam.editor.role")} htmlFor="m-role">
              <Select id="m-role" value={d.role_key} onChange={(e) => set("role_key", e.target.value)} disabled={!canManage}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {t(`aiTeam.roles.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("aiTeam.editor.reportsTo")} htmlFor="m-boss">
              <Select id="m-boss" value={d.reports_to ?? ""} onChange={(e) => set("reports_to", e.target.value || null)} disabled={!canManage}>
                <option value="">—</option>
                {members.filter((m) => m.id !== d.id).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-[13px] font-medium">{t("aiTeam.editor.avatar")}</p>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-muted">{t("aiTeam.editor.color")}</span>
                <input type="range" min={0} max={360} value={d.avatar.hue ?? 222} onChange={(e) => setAv({ hue: Number(e.target.value) })} disabled={!canManage} className="flex-1 accent-[var(--accent)]" aria-label={t("aiTeam.editor.color")} />
              </div>
              {(
                [
                  ["accessory", ACCESSORIES],
                  ["face", FACES],
                  ["hair", HAIRS],
                  ["skin", SKINS],
                ] as const
              ).map(([k, list]) => (
                <div key={k} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-16 shrink-0 text-[12px] text-muted">{t(`aiTeam.editor.av.${k}`)}</span>
                  {list.map((v) => (
                    <button key={v} type="button" disabled={!canManage} onClick={() => setAv({ [k]: v } as Partial<AvatarSpec>)} aria-pressed={(d.avatar[k] ?? (k === "skin" ? "tan" : k === "hair" ? "short" : k === "face" ? "smile" : "none")) === v} className={cn("rounded-full border p-0.5 transition", (d.avatar[k] ?? (k === "skin" ? "tan" : k === "hair" ? "short" : k === "face" ? "smile" : "none")) === v ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-accent/50")} title={t(`aiTeam.editor.avv.${v}`)}>
                      <AgentAvatar spec={{ ...d.avatar, [k]: v }} state="idle" size={34} className="av-still" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "personality" ? (
          <div className="space-y-3">
            <Field label={t("aiTeam.editor.tone")} htmlFor="m-tone" hint={t("aiTeam.editor.toneHint")}>
              <Input id="m-tone" value={d.tone} maxLength={400} onChange={(e) => set("tone", e.target.value)} disabled={!canManage} />
            </Field>
            <Field label={t("aiTeam.editor.instructions")} htmlFor="m-ins" hint={t("aiTeam.editor.instructionsHint")}>
              <Textarea id="m-ins" rows={8} value={d.instructions} maxLength={6000} onChange={(e) => set("instructions", e.target.value)} disabled={!canManage} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("aiTeam.editor.maxSteps")} htmlFor="m-steps">
                <Input id="m-steps" type="number" min={1} max={60} value={d.limits.max_steps ?? ""} onChange={(e) => set("limits", { ...d.limits, max_steps: e.target.value ? Number(e.target.value) : undefined })} disabled={!canManage} />
              </Field>
              <Field label={t("aiTeam.editor.maxCredits")} htmlFor="m-credits">
                <Input id="m-credits" type="number" min={1} max={500} value={d.limits.max_credits ?? ""} onChange={(e) => set("limits", { ...d.limits, max_credits: e.target.value ? Number(e.target.value) : undefined })} disabled={!canManage} />
              </Field>
            </div>
          </div>
        ) : null}

        {tab === "tools" ? (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="editor-tools">
            {tools.map((x) => (
              <li key={x.key}>
                <label className={cn("flex h-full cursor-pointer items-start gap-2 rounded-2xl border p-2.5 text-[12.5px] transition", d.tools.includes(x.key) ? "border-accent/50 bg-accent-soft/40" : "border-line hover:bg-surface-hover")}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={d.tools.includes(x.key)} disabled={!canManage} onChange={(e) => set("tools", e.target.checked ? [...d.tools, x.key] : d.tools.filter((k) => k !== x.key))} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">
                      {t(`aiTeam.tools.${x.key.replace(".", "_")}`)}
                      {x.sensitivity !== "internal" ? <Badge tone={x.sensitivity === "money" ? "danger" : "warning"}>{t(`aiTeam.sens.${x.sensitivity}`)}</Badge> : x.kind === "read" ? <Badge tone="neutral">{t("aiTeam.sens.read")}</Badge> : null}
                    </span>
                    <span className="block text-[11.5px] text-subtle" dir="ltr">
                      {x.key}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === "autonomy" ? (
          <div className="space-y-3">
            {(["suggest", "approve", "auto"] as const).map((a) => (
              <label key={a} className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border p-3", d.autonomy === a ? "border-accent/50 bg-accent-soft/40" : "border-line")}>
                <input type="radio" name="autonomy" className="mt-1 accent-[var(--accent)]" checked={d.autonomy === a} disabled={!canManage} onChange={() => set("autonomy", a)} />
                <span>
                  <span className="block font-semibold">{t(`aiTeam.autonomy.${a}`)}</span>
                  <span className="block text-[12.5px] text-muted">{t(`aiTeam.autonomy.${a}Body`)}</span>
                </span>
              </label>
            ))}
            {d.autonomy === "auto" ? (
              <div className="rounded-2xl border border-warning/40 bg-warning/5 p-3">
                <p className="mb-2 text-[12.5px] font-medium">{t("aiTeam.autonomy.explicit")}</p>
                {writeTools.length ? (
                  writeTools.map((x) => (
                    <label key={x.key} className="flex items-center gap-2 py-1 text-[12.5px]">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={d.auto_actions.includes(x.key)} disabled={!canManage} onChange={(e) => set("auto_actions", e.target.checked ? [...d.auto_actions, x.key] : d.auto_actions.filter((k) => k !== x.key))} />
                      {t(`aiTeam.tools.${x.key.replace(".", "_")}`)} <Badge tone={x.sensitivity === "money" ? "danger" : "warning"}>{t(`aiTeam.sens.${x.sensitivity}`)}</Badge>
                    </label>
                  ))
                ) : (
                  <p className="text-[12px] text-muted">{t("aiTeam.autonomy.noSensitive")}</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "memory" ? (
          <div className="space-y-2" data-testid="editor-memory">
            {myMemory.length ? (
              myMemory.map((m) => (
                <div key={m.id} className="rounded-2xl border border-line p-2.5 text-[12.5px]">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={m.status === "proposed" ? "warning" : m.status === "active" ? "success" : "neutral"}>{t(`aiTeam.mem.status.${m.status}`)}</Badge>
                    <Badge tone="neutral">{t(`aiTeam.mem.kind.${m.kind}`)}</Badge>
                    <span className="text-[11px] text-subtle">{Math.round(m.confidence * 100)}%</span>
                  </div>
                  {editMem?.id === m.id ? (
                    <div className="flex gap-2">
                      <Input value={editMem.content} onChange={(e) => setEditMem({ id: m.id, content: e.target.value })} />
                      <Button size="sm" onClick={() => mem("edit", m.id, editMem.content)}>
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <p>{m.content}</p>
                  )}
                  {canManage ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.status === "proposed" ? <Button size="sm" variant="secondary" onClick={() => mem("confirm", m.id)}>{t("aiTeam.mem.confirm")}</Button> : null}
                      {m.status !== "revoked" ? <Button size="sm" variant="ghost" onClick={() => mem("revoke", m.id)}>{t("aiTeam.mem.revoke")}</Button> : null}
                      <Button size="sm" variant="ghost" onClick={() => setEditMem({ id: m.id, content: m.content })}>{t("common.edit")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => mem("delete", m.id)} aria-label={t("common.delete")}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="rounded-2xl bg-elevated p-4 text-center text-[13px] text-muted">{t("aiTeam.mem.empty")}</p>
            )}
            {canManage && myMemory.length ? (
              <ConfirmReset label={t("aiTeam.mem.reset")} onConfirm={() => mem("reset")} />
            ) : null}
          </div>
        ) : null}

        {tab === "history" ? (
          <ul className="space-y-1.5">
            {myTasks.length ? (
              myTasks.map((x) => (
                <li key={x.id} className="flex items-center gap-2 rounded-xl bg-elevated px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  <Badge tone={x.status === "done" ? "success" : x.status === "failed" || x.status === "blocked" ? "danger" : x.status.startsWith("awaiting") ? "warning" : "neutral"}>{t(`aiTeam.status.${x.status}`)}</Badge>
                </li>
              ))
            ) : (
              <p className="rounded-2xl bg-elevated p-4 text-center text-[13px] text-muted">{t("aiTeam.editor.noHistory")}</p>
            )}
          </ul>
        ) : null}

        {tab === "performance" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="editor-performance">
            {(
              [
                ["done", stats?.done ?? 0],
                ["approval", stats?.approvalRate === null || stats?.approvalRate === undefined ? "—" : `${stats.approvalRate}%`],
                ["rejection", stats?.rejectionRate === null || stats?.rejectionRate === undefined ? "—" : `${stats.rejectionRate}%`],
                ["avg", stats?.avgMinutes === null || stats?.avgMinutes === undefined ? "—" : `${stats.avgMinutes}′`],
                ["credits", stats?.credits ?? 0],
                ["escalations", stats?.escalations ?? 0],
                ["edited", stats?.edited ?? 0],
                ["failed", stats?.failed ?? 0],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-surface p-3 text-center">
                <p className="num-pop tabular-nums text-xl font-bold">{v}</p>
                <p className="text-[11.5px] text-muted">{t(`aiTeam.metrics.${k}`)}</p>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "test" ? (
          <div className="space-y-2" data-testid="editor-test">
            <p className="text-[12.5px] text-muted">{t("aiTeam.editor.testHint")}</p>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl bg-elevated p-3">
              {chat.length ? (
                chat.map((c, i) => (
                  <p key={i} className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px]", c.role === "user" ? "ms-auto bg-accent-solid text-accent-fg" : "bg-surface")}>
                    {c.content}
                  </p>
                ))
              ) : (
                <p className="py-6 text-center text-[12.5px] text-subtle">
                  <MessageSquare className="mx-auto mb-1 h-5 w-5" />
                  {t("aiTeam.editor.testEmpty")}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void sendTest())} placeholder={t("aiTeam.editor.testPlaceholder")} />
              <Button onClick={sendTest} loading={busy} disabled={!msg.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button onClick={save} loading={busy && tab !== "test"} disabled={!d.name.trim()} data-testid="editor-save">
              <Save className="h-4 w-4" /> {t(isNew ? "aiTeam.hire.cta" : "common.save")}
            </Button>
            {!isNew ? (
              <>
                <Button variant="secondary" onClick={() => set("status", d.status === "active" ? "paused" : "active")}>
                  {d.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {t(d.status === "active" ? "aiTeam.editor.pause" : "aiTeam.editor.activate")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const r = await duplicateMemberAction({ locale, id: d.id! });
                    if (r.error) return toast.error(t(r.error));
                    toast.success(t(r.message ?? "aiTeam.msg.duplicated"));
                    router.refresh();
                  }}
                >
                  <Copy className="h-4 w-4" /> {t("aiTeam.editor.duplicate")}
                </Button>
              </>
            ) : null}
            <span className="flex-1" />
            {d.status !== initial.status ? <span className="text-[11.5px] text-warning">{t("aiTeam.editor.unsaved")}</span> : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
