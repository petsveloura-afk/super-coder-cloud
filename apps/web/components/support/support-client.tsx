"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import { createTicketAction, replyTicketAction, updateTicketAction } from "@/app/[locale]/(dashboard)/support/actions";
import { cn } from "@/lib/utils";

interface Opt {
  id: string;
  label: string;
  sub?: string | null;
}

function TicketFields({ state, contacts, members }: { state: { values?: Record<string, string>; fieldErrors?: Record<string, string> }; contacts: Opt[]; members: Opt[] }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("support.subject")} htmlFor="tk-subject" error={err("subject")} className="sm:col-span-2">
              <Input id="tk-subject" name="subject" defaultValue={state.values?.subject ?? ""} required />
            </Field>
            <Field label={t("deals.contact")} htmlFor="tk-contact">
              <Select id="tk-contact" name="contactId" defaultValue={state.values?.contactId ?? ""}>
                <option value="">—</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.sub ? ` · ${c.sub}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("support.priority")} htmlFor="tk-priority">
              <Select id="tk-priority" name="priority" defaultValue={state.values?.priority ?? "normal"}>
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`support.priorities.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("inbox.assignee")} htmlFor="tk-assignee">
              <Select id="tk-assignee" name="assigneeId" defaultValue={state.values?.assigneeId ?? ""}>
                <option value="">{t("deals.ownerMe")}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("support.internalNote")} htmlFor="tk-body" className="sm:col-span-2">
              <Textarea id="tk-body" name="body" defaultValue={state.values?.body ?? ""} />
            </Field>
          </div>
        );
}

export function NewTicketButton({ contacts, members }: { contacts: Opt[]; members: Opt[] }) {
  const { t, locale } = useI18n();
  return (
    <FormDialog<{ id: string }>
      action={createTicketAction}
      title={t("support.newTicket")}
      submitLabel={t("common.create")}
      redirectTo={(d) => (d?.id ? `/${locale}/support/${d.id}` : null)}
      trigger={
        <Button>
          <Plus className="h-4 w-4" /> {t("support.newTicket")}
        </Button>
      }
    >
      {(state) => <TicketFields state={state} contacts={contacts} members={members} />}
    </FormDialog>
  );
}

export function TicketReply({ ticketId, status }: { ticketId: string; status: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className={cn("space-y-2 border-t border-line p-4", internal && "bg-gold-soft")}>
      <Textarea aria-label={t("support.reply")} rows={4} placeholder={t(internal ? "support.notePlaceholder" : "support.replyPlaceholder")} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          <Lock className="h-3.5 w-3.5" /> {t("support.internal")}
        </label>
        <Select aria-label={t("support.setStatus")} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} className="h-9 w-48 text-[13px]">
          <option value="">{t("support.keepStatus", { status: t(`support.statuses.${status}`) })}</option>
          {TICKET_STATUSES.filter((s) => s !== status).map((s) => (
            <option key={s} value={s}>
              {t("support.andSetStatus", { status: t(`support.statuses.${s}`) })}
            </option>
          ))}
        </Select>
        <Button
          className="ms-auto"
          loading={pending}
          disabled={!body.trim()}
          onClick={() =>
            start(async () => {
              const res = await replyTicketAction({ locale, ticketId, body, internal, status: nextStatus || undefined });
              if (res.error) toast.error(t(res.error));
              else {
                toast.success(t(res.message ?? "common.saved"));
                setBody("");
                setNextStatus("");
                router.refresh();
              }
            })
          }
        >
          <Send className="h-4 w-4 rtl:-scale-x-100" /> {t(internal ? "support.addNote" : "support.sendReply")}
        </Button>
      </div>
    </div>
  );
}

export function TicketControls({ ticketId, status, priority, assigneeId, members }: { ticketId: string; status: string; priority: string; assigneeId: string | null; members: Opt[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (patch: { status?: string; priority?: string; assigneeId?: string | null }) =>
    start(async () => {
      const res = await updateTicketAction({ locale, ticketId, ...patch });
      if (res.error) toast.error(t(res.error));
      else toast.success(t("support.updated"));
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <Field label={t("support.status")} htmlFor="tc-status">
        <Select id="tc-status" value={status} disabled={pending} onChange={(e) => run({ status: e.target.value })}>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`support.statuses.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("support.priority")} htmlFor="tc-priority">
        <Select id="tc-priority" value={priority} disabled={pending} onChange={(e) => run({ priority: e.target.value })}>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`support.priorities.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("inbox.assignee")} htmlFor="tc-assignee">
        <Select id="tc-assignee" value={assigneeId ?? ""} disabled={pending} onChange={(e) => run({ assigneeId: e.target.value || null })}>
          <option value="">{t("inbox.unassigned")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
