"use client";

import { ArrowDown, ArrowUp, Plus, Settings2, Zap } from "lucide-react";
import { STAGE_EVENTS } from "@/lib/crm/stage-events";
import { useI18n } from "@/lib/i18n/client";
import { pipelineLabel, stageLabel } from "@/lib/labels";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import {
  addStageAction,
  createPipelineAction,
  deletePipelineAction,
  deleteStageAction,
  moveStageAction,
  renamePipelineAction,
  updateStageAction,
  updateStageAutomationAction,
} from "@/app/[locale]/(dashboard)/pipelines/actions";
import type { ActionState } from "@/lib/action-state";

interface Stage {
  id: string;
  name: string;
  probability: number;
  auto_on?: string[];
  marks_won?: boolean;
}

/** Wave 15 — choose which business events move deals into this stage by themselves. */
function StageAutomation({ stage }: { stage: Stage }) {
  const { t } = useI18n();
  const count = stage.auto_on?.length ?? 0;
  return (
    <FormDialog
      action={updateStageAutomationAction}
      title={t("stageAuto.title", { stage: stageLabel(t, stage.name) })}
      description={t("stageAuto.subtitle")}
      hidden={{ id: stage.id }}
      trigger={
        <Button variant="ghost" size="sm" data-testid="stage-auto" title={t("stageAuto.button")}>
          <Zap className={`h-4 w-4 ${count ? "text-gold" : ""}`} />
          {count ? <span className="text-[11px] font-semibold text-gold">{count}</span> : null}
          <span className="sr-only">{t("stageAuto.button")}</span>
        </Button>
      }
    >
      {() => (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[13px] font-medium text-muted">{t("stageAuto.when")}</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {STAGE_EVENTS.map((e) => (
              <label key={e} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover">
                <input type="checkbox" name="auto_on" value={e} defaultChecked={stage.auto_on?.includes(e)} className="h-4 w-4 accent-[var(--brand)]" />
                {t(`stageAuto.events.${e}`)}
              </label>
            ))}
          </div>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-success/30 bg-success-soft px-3 text-sm">
            <input type="checkbox" name="marks_won" defaultChecked={stage.marks_won} className="h-4 w-4 accent-[var(--brand)]" />
            {t("stageAuto.marksWon")}
          </label>
          <p className="text-[12px] text-subtle">{t("stageAuto.hint")}</p>
        </fieldset>
      )}
    </FormDialog>
  );
}

function StageFields({ state, stage }: { state: ActionState<unknown>; stage?: Stage }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
      <Field label={t("deals.stageName")} htmlFor="stage-name" error={err("name")}>
        <Input id="stage-name" name="name" required defaultValue={state.values?.name ?? (stage ? stageLabel(t, stage.name) : "")} />
      </Field>
      <Field label={t("deals.probability")} htmlFor="stage-prob" error={err("probability")}>
        <Input id="stage-prob" name="probability" type="number" min={0} max={100} dir="ltr" defaultValue={state.values?.probability ?? String(stage?.probability ?? 50)} />
      </Field>
    </div>
  );
}

export function NewPipelineButton() {
  const { t, locale } = useI18n();
  return (
    <FormDialog
      action={createPipelineAction}
      title={t("deals.newPipeline")}
      submitLabel={t("common.create")}
      redirectTo={(d) => (d?.id ? `/${locale}/pipelines?p=${d.id}` : null)}
      trigger={
        <Button variant="secondary">
          <Plus className="h-4 w-4" /> {t("deals.newPipeline")}
        </Button>
      }
    >
      {(state) => (
        <Field label={t("deals.pipelineName")} htmlFor="pipeline-name" error={state.fieldErrors?.name ? t(state.fieldErrors.name) : undefined}>
          <Input id="pipeline-name" name="name" required defaultValue={state.values?.name ?? ""} />
        </Field>
      )}
    </FormDialog>
  );
}

export function PipelineManager({ pipeline }: { pipeline: { id: string; name: string; is_default: boolean; stages: Stage[] } }) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t("deals.manageStages")}
      description={pipelineLabel(t, pipeline.name)}
      className="sm:max-w-2xl"
      trigger={
        <Button variant="secondary">
          <Settings2 className="h-4 w-4" /> {t("deals.manageStages")}
        </Button>
      }
    >
      <div className="space-y-5">
        <FormDialog
          action={renamePipelineAction}
          title={t("deals.renamePipeline")}
          hidden={{ id: pipeline.id }}
          trigger={
            <Button variant="ghost" size="sm">
              {t("deals.renamePipeline")}
            </Button>
          }
        >
          {(state) => (
            <Field label={t("deals.pipelineName")} htmlFor="pipeline-rename" error={state.fieldErrors?.name ? t(state.fieldErrors.name) : undefined}>
              <Input id="pipeline-rename" name="name" required defaultValue={state.values?.name ?? pipelineLabel(t, pipeline.name)} />
            </Field>
          )}
        </FormDialog>

        <ol className="divide-y divide-line rounded-xl border border-line">
          {pipeline.stages.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <span className="w-6 text-center text-[12px] text-subtle">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{stageLabel(t, s.name)}</span>
              <span className="text-[12px] text-muted">{s.probability}%</span>
              <StageAutomation stage={s} />
              <ConfirmActionButton action={moveStageAction} fields={{ id: s.id, direction: "-1" }} confirm={false} variant="ghost" size="sm" icon={<ArrowUp className="h-4 w-4" />} label={t("deals.moveEarlier")} />
              <ConfirmActionButton action={moveStageAction} fields={{ id: s.id, direction: "1" }} confirm={false} variant="ghost" size="sm" icon={<ArrowDown className="h-4 w-4" />} label={t("deals.moveLater")} />
              <FormDialog
                action={updateStageAction}
                title={t("deals.editStage")}
                hidden={{ id: s.id }}
                trigger={
                  <Button variant="ghost" size="sm">
                    {t("common.edit")}
                  </Button>
                }
              >
                {(state) => <StageFields state={state} stage={s} />}
              </FormDialog>
              <ConfirmActionButton action={deleteStageAction} fields={{ id: s.id }} variant="ghost" size="sm" />
            </li>
          ))}
        </ol>

        <FormDialog
          action={addStageAction}
          title={t("deals.addStage")}
          hidden={{ pipelineId: pipeline.id }}
          submitLabel={t("common.create")}
          trigger={
            <Button variant="secondary">
              <Plus className="h-4 w-4" /> {t("deals.addStage")}
            </Button>
          }
        >
          {(state) => <StageFields state={state} />}
        </FormDialog>

        {!pipeline.is_default ? (
          <div className="border-t border-line pt-4">
            <ConfirmActionButton action={deletePipelineAction} fields={{ id: pipeline.id }} label={t("deals.deletePipeline")} confirm={t("deals.confirmDeletePipeline")} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
