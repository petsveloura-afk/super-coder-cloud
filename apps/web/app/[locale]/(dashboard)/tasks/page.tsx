import Link from "next/link";
import type { Metadata } from "next";
import { AlarmClock, CheckSquare, User } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { EditTaskDialog, NewTaskButton, TaskCheckbox, type TaskRecord } from "@/components/tasks/task-form";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { contactOptions, memberOptions } from "@/lib/lookups";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("tasks.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const FILTERS = ["mine", "open", "overdue", "done", "all"] as const;

export default async function TasksPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const sp = await searchParams;
  if (!ctx.can("tasks.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const filter = (FILTERS as readonly string[]).includes(String(sp.f)) ? (sp.f as (typeof FILTERS)[number]) : "mine";
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  let req = supabase
    .from("tasks")
    .select("id, title, description, status, due_at, assignee_id, contact_id, deal_id, created_at, remind_at")
    .eq("organization_id", ctx.org.id)
    .limit(300);
  if (filter === "mine") req = req.eq("assignee_id", ctx.userId).in("status", ["open", "in_progress"]);
  if (filter === "open") req = req.in("status", ["open", "in_progress"]);
  if (filter === "overdue") req = req.in("status", ["open", "in_progress"]).lt("due_at", nowIso);
  if (filter === "done") req = req.eq("status", "done");
  req = filter === "done" ? req.order("updated_at", { ascending: false }) : req.order("due_at", { ascending: true, nullsFirst: false });

  const [{ data }, members, contacts] = await Promise.all([req, memberOptions(ctx.org.id), contactOptions(ctx.org.id)]);
  const tasks = (data ?? []) as (TaskRecord & { created_at: string })[];
  const memberName = new Map(members.map((m) => [m.id, m.label]));
  const contactName = new Map(contacts.map((c) => [c.id, c.label]));
  const canWrite = ctx.can("tasks.write");

  return (
    <>
      <PageHeader title={t("tasks.title")} description={t("tasks.subtitle")} actions={canWrite ? <NewTaskButton members={members} contacts={contacts} /> : null} />
      <Card className="mb-4 p-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={t("tasks.filter")}>
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={`/${locale}/tasks${f === "mine" ? "" : `?f=${f}`}`}
              role="tab"
              aria-selected={filter === f}
              className={cn(
                "flex h-9 shrink-0 items-center rounded-xl px-3.5 text-[13px]",
                filter === f ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {t(`tasks.filters.${f}`)}
            </Link>
          ))}
        </div>
      </Card>

      {tasks.length === 0 ? (
        <Card>
          <EmptyState icon={<CheckSquare className="h-6 w-6" />} title={t("tasks.empty")} body={t("tasks.emptyBody")} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {tasks.map((task) => {
              const done = task.status === "done";
              const overdue = !done && task.status !== "canceled" && task.due_at && task.due_at < nowIso;
              return (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <div className="pt-0.5">
                    <TaskCheckbox id={task.id} done={done} label={task.title} disabled={!canWrite || task.status === "canceled"} />
                  </div>
                  <EditTaskDialog
                    task={task}
                    members={members}
                    contacts={contacts}
                    canWrite={canWrite}
                    trigger={
                      <button type="button" className="min-w-0 flex-1 text-start">
                        <span className={cn("block font-medium", done && "text-subtle line-through")}>{task.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                          {task.due_at ? (
                            <span className={cn("flex items-center gap-1", overdue && "font-semibold text-danger")}>
                              <AlarmClock className="h-3.5 w-3.5" />
                              {formatDateTime(locale, task.due_at)}
                            </span>
                          ) : null}
                          {task.assignee_id ? (
                            <span className="flex items-center gap-1">
                              <User className="h-3.5 w-3.5" />
                              {memberName.get(task.assignee_id) ?? "—"}
                            </span>
                          ) : null}
                          {task.contact_id ? <span>{contactName.get(task.contact_id) ?? ""}</span> : null}
                          {task.status === "in_progress" || task.status === "canceled" ? <Badge tone="neutral">{t(`tasks.statuses.${task.status}`)}</Badge> : null}
                          {overdue ? <Badge tone="danger">{t("tasks.overdue")}</Badge> : null}
                        </span>
                      </button>
                    }
                  />
                  {task.contact_id ? (
                    <Link href={`/${locale}/crm/${task.contact_id}`} className="hidden text-[12.5px] text-accent hover:underline sm:block">
                      {t("tasks.openContact")}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
