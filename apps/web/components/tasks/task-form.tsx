"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { TASK_STATUSES } from "@scc/shared/validators";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import { createTaskAction, deleteTaskAction, setTaskStatusAction, updateTaskAction } from "@/app/[locale]/(dashboard)/tasks/actions";
import type { ActionState } from "@/lib/action-state";

export interface TaskOpt {
  id: string;
  label: string;
  sub?: string | null;
}
export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  status: (typeof TASK_STATUSES)[number];
  due_at: string | null;
  assignee_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
}

/** ISO → value for <input type="datetime-local"> in the viewer's timezone. */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date-time picker that submits an absolute ISO timestamp (no server-timezone drift). */
function DueInput({ initialIso }: { initialIso: string }) {
  const [iso, setIso] = useState(initialIso);
  return (
    <>
      <Input
        id="task-due"
        type="datetime-local"
        dir="ltr"
        defaultValue={toLocalInput(initialIso)}
        onChange={(e) => setIso(e.target.value ? new Date(e.target.value).toISOString() : "")}
      />
      <input type="hidden" name="dueAt" value={iso} />
    </>
  );
}

function TaskFields({ state, task, members, contacts, defaults }: { state: ActionState<unknown>; task?: TaskRecord; members: TaskOpt[]; contacts: TaskOpt[]; defaults?: Partial<TaskRecord> }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const v = (k: string, f?: string | null) => state.values?.[k] ?? f ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("tasks.taskTitle")} htmlFor="task-title" error={err("title")} className="sm:col-span-2">
        <Input id="task-title" name="title" required defaultValue={v("title", task?.title)} aria-invalid={Boolean(err("title"))} />
      </Field>
      <Field label={t("tasks.description")} htmlFor="task-desc" error={err("description")} className="sm:col-span-2">
        <Textarea id="task-desc" name="description" defaultValue={v("description", task?.description)} />
      </Field>
      <Field label={t("tasks.due")} htmlFor="task-due" error={err("dueAt")}>
        <DueInput initialIso={state.values?.dueAt || task?.due_at || defaults?.due_at || ""} />
      </Field>
      <Field label={t("tasks.status")} htmlFor="task-status">
        <Select id="task-status" name="status" defaultValue={v("status", task?.status ?? "open")}>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.statuses.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("tasks.assignee")} htmlFor="task-assignee">
        <Select id="task-assignee" name="assigneeId" defaultValue={v("assigneeId", task?.assignee_id ?? defaults?.assignee_id)}>
          <option value="">{t("deals.ownerMe")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("deals.contact")} htmlFor="task-contact">
        <Select id="task-contact" name="contactId" defaultValue={v("contactId", task?.contact_id ?? defaults?.contact_id)}>
          <option value="">—</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.sub ? ` · ${c.sub}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      {task?.deal_id || defaults?.deal_id ? <input type="hidden" name="dealId" value={task?.deal_id ?? defaults?.deal_id ?? ""} /> : null}
    </div>
  );
}

export function NewTaskButton({ members, contacts, defaults, variant, size }: { members: TaskOpt[]; contacts: TaskOpt[]; defaults?: Partial<TaskRecord>; variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const { t } = useI18n();
  return (
    <FormDialog
      action={createTaskAction}
      title={t("tasks.newTask")}
      submitLabel={t("common.create")}
      trigger={
        <Button variant={variant ?? "primary"} size={size}>
          <Plus className="h-4 w-4" /> {t("tasks.newTask")}
        </Button>
      }
    >
      {(state) => <TaskFields state={state} members={members} contacts={contacts} defaults={defaults} />}
    </FormDialog>
  );
}

export function EditTaskDialog({ task, members, contacts, trigger, canWrite }: { task: TaskRecord; members: TaskOpt[]; contacts: TaskOpt[]; trigger: ReactNode; canWrite: boolean }) {
  const { t } = useI18n();
  if (!canWrite) return <>{trigger}</>;
  return (
    <FormDialog
      action={updateTaskAction}
      title={t("tasks.editTask")}
      hidden={{ id: task.id }}
      trigger={trigger}
      footer={<ConfirmActionButton action={deleteTaskAction} fields={{ id: task.id }} size="sm" />}
    >
      {(state) => <TaskFields state={state} task={task} members={members} contacts={contacts} />}
    </FormDialog>
  );
}

/** Accessible "done" checkbox — toggles open ↔ done instantly. */
export function TaskCheckbox({ id, done, label, disabled }: { id: string; done: boolean; label: string; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  // Optimistic: flips immediately, re-synced when the server value changes.
  const [checked, setChecked] = useState(done);
  const [prevDone, setPrevDone] = useState(done);
  if (done !== prevDone) {
    setPrevDone(done);
    setChecked(done);
  }
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled || pending}
      aria-label={t(checked ? "tasks.markOpen" : "tasks.markDone", { title: label })}
      className="h-5 w-5 shrink-0 cursor-pointer rounded accent-[var(--accent)] disabled:cursor-not-allowed"
      onChange={() => {
        const next = !checked;
        setChecked(next);
        start(async () => {
          const fd = new FormData();
          fd.set("locale", locale);
          fd.set("id", id);
          fd.set("status", next ? "done" : "open");
          const res = await setTaskStatusAction(fd);
          if (res.error) {
            setChecked(!next);
            toast.error(t(res.error));
          } else toast.success(t(res.message ?? "common.saved"));
          router.refresh();
        });
      }}
    />
  );
}
