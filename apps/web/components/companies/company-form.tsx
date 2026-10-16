"use client";

import { Link2, Pencil, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import { createCompanyAction, deleteCompanyAction, linkContactAction, updateCompanyAction } from "@/app/[locale]/(dashboard)/companies/actions";
import type { ActionState } from "@/lib/action-state";

export interface CompanyRecord {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  phone: string | null;
}

function CompanyFields({ state, company }: { state: ActionState<unknown>; company?: CompanyRecord }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const v = (k: string, f?: string | null) => state.values?.[k] ?? f ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("companies.name")} htmlFor="company-name" error={err("name")} className="sm:col-span-2">
        <Input id="company-name" name="name" required defaultValue={v("name", company?.name)} aria-invalid={Boolean(err("name"))} />
      </Field>
      <Field label={t("companies.domain")} htmlFor="company-domain" error={err("domain")}>
        <Input id="company-domain" name="domain" dir="ltr" placeholder="example.com" defaultValue={v("domain", company?.domain)} />
      </Field>
      <Field label={t("companies.industry")} htmlFor="company-industry" error={err("industry")}>
        <Input id="company-industry" name="industry" defaultValue={v("industry", company?.industry)} />
      </Field>
      <Field label={t("crm.phone")} htmlFor="company-phone" error={err("phone")}>
        <Input id="company-phone" name="phone" type="tel" dir="ltr" defaultValue={v("phone", company?.phone)} />
      </Field>
    </div>
  );
}

export function NewCompanyButton({ defaultOpen }: { defaultOpen?: boolean }) {
  const { t, locale } = useI18n();
  return (
    <FormDialog
      action={createCompanyAction}
      title={t("companies.newCompany")}
      submitLabel={t("common.create")}
      defaultOpen={defaultOpen}
      redirectTo={(d) => (d?.id ? `/${locale}/companies/${d.id}` : null)}
      trigger={
        <Button>
          <Plus className="h-4 w-4" /> {t("companies.newCompany")}
        </Button>
      }
    >
      {(state) => <CompanyFields state={state} />}
    </FormDialog>
  );
}

export function EditCompanyButton({ company }: { company: CompanyRecord }) {
  const { t } = useI18n();
  return (
    <FormDialog
      action={updateCompanyAction}
      title={t("companies.editCompany")}
      hidden={{ id: company.id }}
      trigger={
        <Button variant="secondary">
          <Pencil className="h-4 w-4" /> {t("common.edit")}
        </Button>
      }
    >
      {(state) => <CompanyFields state={state} company={company} />}
    </FormDialog>
  );
}

export function DeleteCompanyButton({ id }: { id: string }) {
  const { locale } = useI18n();
  return <ConfirmActionButton action={deleteCompanyAction} fields={{ id }} redirectTo={`/${locale}/companies`} />;
}

export function LinkContactButton({ companyId, contacts }: { companyId: string; contacts: { id: string; label: string; sub?: string | null }[] }) {
  const { t } = useI18n();
  const action = async (_prev: ActionState, fd: FormData): Promise<ActionState> => linkContactAction(fd);
  return (
    <FormDialog
      action={action}
      title={t("companies.linkContact")}
      hidden={{ companyId }}
      submitLabel={t("companies.link")}
      trigger={
        <Button variant="secondary" size="sm">
          <Link2 className="h-4 w-4" /> {t("companies.linkContact")}
        </Button>
      }
    >
      {() => (
        <Field label={t("deals.contact")} htmlFor="link-contact">
          <Select id="link-contact" name="contactId" required>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.sub ? ` · ${c.sub}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </FormDialog>
  );
}

export function UnlinkContactButton({ contactId }: { contactId: string }) {
  const { t } = useI18n();
  return <ConfirmActionButton action={linkContactAction} fields={{ contactId, companyId: "" }} variant="ghost" size="sm" label={t("companies.unlink")} confirm={false} icon={<span />} />;
}
