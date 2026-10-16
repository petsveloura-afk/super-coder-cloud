"use client";

import { useActionState, useState } from "react";
import { Copy, UserPlus, X } from "lucide-react";
import type { OrgRole } from "@scc/shared/permissions";
import { useI18n } from "@/lib/i18n/client";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { changeRoleAction, createInvitationAction, removeMemberAction, revokeInvitationAction } from "@/app/[locale]/(dashboard)/team/actions";
import type { ActionState } from "@/lib/action-state";

export function InviteDialog({ roles }: { roles: OrgRole[] }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createInvitationAction, {} as ActionState<{ link: string; emailed?: boolean }>);
  const err = useFieldError(state);
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("team.invite")}
      trigger={
        <Button>
          <UserPlus className="h-4 w-4" /> {t("team.invite")}
        </Button>
      }
    >
      {state.ok && state.data ? (
        <div className="space-y-3">
          <FormAlert state={state} />
          <p className="text-sm text-muted">{t(state.data.emailed ? "team.inviteLinkBackup" : "team.inviteLinkHint")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-bg px-3 py-2.5 text-[12px]" dir="ltr">
              {state.data.link}
            </code>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("common.copy")}
              onClick={async () => {
                await navigator.clipboard.writeText(state.data!.link);
                setCopied(true);
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {copied ? <p className="text-[12px] text-success">{t("common.copied")}</p> : null}
        </div>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="locale" value={locale} />
          <FormAlert state={state} />
          <Field label={t("team.inviteEmail")} htmlFor="invite-email" error={err("email")}>
            <Input id="invite-email" name="email" type="email" dir="ltr" required defaultValue={state.values?.email} aria-invalid={Boolean(err("email"))} />
          </Field>
          <Field label={t("team.role")} htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue={state.values?.role ?? (roles.includes("sales") ? "sales" : roles[0])}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`team.roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton className="w-full justify-center">{t("team.invite")}</SubmitButton>
        </form>
      )}
    </Dialog>
  );
}

export function RoleSelect({ userId, role, roles, disabled }: { userId: string; role: OrgRole; roles: OrgRole[]; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(changeRoleAction, {} as ActionState);
  const options = roles.includes(role) ? roles : [role, ...roles];
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="userId" value={userId} />
      <Select
        name="role"
        defaultValue={role}
        disabled={disabled}
        aria-label={t("team.changeRole")}
        className="h-9 w-40 text-[13px]"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {options.map((r) => (
          <option key={r} value={r} disabled={!roles.includes(r)}>
            {t(`team.roles.${r}`)}
          </option>
        ))}
      </Select>
      {state.error ? <span className="text-[12px] text-danger">{t(state.error)}</span> : null}
    </form>
  );
}

export function RemoveMemberButton({ userId }: { userId: string }) {
  const { t, locale } = useI18n();
  return (
    <form
      action={removeMemberAction}
      onSubmit={(e) => {
        if (!window.confirm(t("common.confirmDelete"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" variant="ghost" size="sm" aria-label={t("team.remove")}>
        <X className="h-4 w-4" />
      </Button>
    </form>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const { t, locale } = useI18n();
  return (
    <form action={revokeInvitationAction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm">
        {t("team.revoke")}
      </Button>
    </form>
  );
}
