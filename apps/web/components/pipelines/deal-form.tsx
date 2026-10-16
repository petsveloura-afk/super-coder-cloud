"use client";

import { useState, type ReactNode } from "react";
import { Plus, RotateCcw, ThumbsDown, Trophy } from "lucide-react";
import { CURRENCIES } from "@scc/shared/validators";
import { useI18n } from "@/lib/i18n/client";
import { stageLabel, pipelineLabel } from "@/lib/labels";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import { createDealAction, deleteDealAction, setDealStatusAction, updateDealAction } from "@/app/[locale]/(dashboard)/pipelines/actions";
import type { ActionState } from "@/lib/action-state";

export interface Opt {
  id: string;
  label: string;
  sub?: string | null;
}
export interface PipelineOpt {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}
export interface DealRecord {
  id: string;
  title: string;
  value: number;
  currency: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  company_id: string | null;
  expected_close_date: string | null;
  owner_id: string | null;
  status: "open" | "won" | "lost";
}

export interface DealPickers {
  pipelines: PipelineOpt[];
  contacts: Opt[];
  companies: Opt[];
  members: Opt[];
}

function DealFields({ state, deal, pickers, defaults }: { state: ActionState<unknown>; deal?: DealRecord; pickers: DealPickers; defaults?: Partial<DealRecord> }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const v = (name: string, fallback?: string | number | null) => state.values?.[name] ?? (fallback == null ? "" : String(fallback));
  const initialPipeline = v("pipelineId", deal?.pipeline_id ?? defaults?.pipeline_id ?? pickers.pipelines[0]?.id);
  const [pipelineId, setPipelineId] = useState(initialPipeline);
  const pipeline = pickers.pipelines.find((p) => p.id === pipelineId) ?? pickers.pipelines[0];
  const stageDefault = v("stageId", deal?.stage_id ?? defaults?.stage_id);
  const stageValue = pipeline?.stages.some((s) => s.id === stageDefault) ? stageDefault : pipeline?.stages[0]?.id;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("deals.title")} htmlFor="deal-title" error={err("title")} className="sm:col-span-2">
        <Input id="deal-title" name="title" required defaultValue={v("title", deal?.title)} aria-invalid={Boolean(err("title"))} />
      </Field>
      <Field label={t("deals.value")} htmlFor="deal-value" error={err("value")}>
        <Input id="deal-value" name="value" type="number" min={0} step="0.01" dir="ltr" inputMode="decimal" defaultValue={v("value", deal?.value ?? 0)} />
      </Field>
      <Field label={t("deals.currency")} htmlFor="deal-currency">
        <Select id="deal-currency" name="currency" defaultValue={v("currency", deal?.currency ?? defaults?.currency ?? "ILS")}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("deals.pipeline")} htmlFor="deal-pipeline" error={err("pipelineId")}>
        <Select id="deal-pipeline" name="pipelineId" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
          {pickers.pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {pipelineLabel(t, p.name)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("deals.stage")} htmlFor="deal-stage" error={err("stageId")}>
        <Select id="deal-stage" name="stageId" key={pipelineId} defaultValue={stageValue}>
          {(pipeline?.stages ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {stageLabel(t, s.name)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("deals.contact")} htmlFor="deal-contact" error={err("contactId")}>
        <Select id="deal-contact" name="contactId" defaultValue={v("contactId", deal?.contact_id ?? defaults?.contact_id)}>
          <option value="">—</option>
          {pickers.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.sub ? ` · ${c.sub}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("deals.company")} htmlFor="deal-company" error={err("companyId")}>
        <Select id="deal-company" name="companyId" defaultValue={v("companyId", deal?.company_id ?? defaults?.company_id)}>
          <option value="">—</option>
          {pickers.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("deals.expectedClose")} htmlFor="deal-close" error={err("expectedCloseDate")}>
        <Input id="deal-close" name="expectedCloseDate" type="date" dir="ltr" defaultValue={v("expectedCloseDate", deal?.expected_close_date)} />
      </Field>
      <Field label={t("deals.owner")} htmlFor="deal-owner">
        <Select id="deal-owner" name="ownerId" defaultValue={v("ownerId", deal?.owner_id)}>
          <option value="">{t("deals.ownerMe")}</option>
          {pickers.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function NewDealButton({ pickers, defaults, label, variant }: { pickers: DealPickers; defaults?: Partial<DealRecord>; label?: string; variant?: "primary" | "secondary" }) {
  const { t } = useI18n();
  if (pickers.pipelines.length === 0) return null;
  return (
    <FormDialog
      action={createDealAction}
      title={t("deals.newDeal")}
      submitLabel={t("common.create")}
      className="sm:max-w-2xl"
      trigger={
        <Button variant={variant ?? "primary"}>
          <Plus className="h-4 w-4" /> {label ?? t("deals.newDeal")}
        </Button>
      }
    >
      {(state) => <DealFields state={state} pickers={pickers} defaults={defaults} />}
    </FormDialog>
  );
}

export function EditDealDialog({
  deal,
  pickers,
  trigger,
  canWrite,
  canDelete,
}: {
  deal: DealRecord;
  pickers: DealPickers;
  trigger: ReactNode;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const { t } = useI18n();
  const statusButtons = canWrite ? (
    <div className="flex flex-wrap gap-2">
      {deal.status === "open" ? (
        <>
          <ConfirmActionButton action={setDealStatusAction} fields={{ id: deal.id, status: "won" }} confirm={false} variant="secondary" size="sm" icon={<Trophy className="h-4 w-4 text-success" />} label={t("deals.markWon")} />
          <ConfirmActionButton action={setDealStatusAction} fields={{ id: deal.id, status: "lost" }} confirm={t("deals.confirmLost")} variant="secondary" size="sm" icon={<ThumbsDown className="h-4 w-4 text-danger" />} label={t("deals.markLost")} />
        </>
      ) : (
        <ConfirmActionButton action={setDealStatusAction} fields={{ id: deal.id, status: "open" }} confirm={false} variant="secondary" size="sm" icon={<RotateCcw className="h-4 w-4" />} label={t("deals.reopen")} />
      )}
      {canDelete ? <ConfirmActionButton action={deleteDealAction} fields={{ id: deal.id }} size="sm" /> : null}
    </div>
  ) : null;

  if (!canWrite) return <>{trigger}</>;
  return (
    <FormDialog action={updateDealAction} title={t("deals.editDeal")} hidden={{ id: deal.id }} className="sm:max-w-2xl" trigger={trigger} footer={statusButtons}>
      {(state) => <DealFields state={state} deal={deal} pickers={pickers} />}
    </FormDialog>
  );
}
