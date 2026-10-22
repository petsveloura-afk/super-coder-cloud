"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Filter, Play, Plus, Save, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { ACTION_TYPES, AUTOMATION_TRIGGERS, CONDITION_FIELDS, CONDITION_OPS, type ActionType, type AutomationTrigger } from "@scc/shared/automations";
import { CONTACT_STATUSES } from "@scc/shared/validators";
import { useI18n } from "@/lib/i18n/client";
import { stageLabel, pipelineLabel, triggerLabel } from "@/lib/labels";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveAutomationAction, testAutomationAction } from "@/app/[locale]/(dashboard)/automations/actions";
import { stepDetailLabel } from "@/components/automations/step-detail";

export interface BuilderAction {
  type: ActionType;
  config: Record<string, unknown>;
}
export interface BuilderValue {
  name: string;
  description: string;
  enabled: boolean;
  trigger_type: AutomationTrigger;
  trigger_config: Record<string, string>;
  conditions: { field: string; op: (typeof CONDITION_OPS)[number]; value: string }[];
  actions: BuilderAction[];
}
export interface BuilderOptions {
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  members: { id: string; label: string }[];
  tags: string[];
  contacts: { id: string; label: string; sub?: string | null }[];
  forms: { id: string; label: string }[];
}

const VARIABLES = [
  "contact.first_name",
  "contact.last_name",
  "contact.email",
  "contact.phone",
  "contact.company_name",
  "deal.title",
  "deal.value",
  "deal.currency",
  "org.name",
  "payload.tag",
];

const DELAYS = [0, 5, 60, 1440, 4320, 10080];

function defaultConfig(type: ActionType): Record<string, unknown> {
  switch (type) {
    case "create_task":
      return { title: "", due_in_days: 1, assignee: "owner" };
    case "notify":
      return { to: "admins", text: "" };
    case "send_email":
      return { to: "contact", subject: "", body: "" };
    case "set_contact_status":
      return { status: "customer" };
    default:
      return {};
  }
}

export function AutomationBuilder({ id, initial, options, inboundUrl }: { id?: string; initial: BuilderValue; options: BuilderOptions; inboundUrl?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState<BuilderValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [testContact, setTestContact] = useState("");
  const [testResult, setTestResult] = useState<{ type: string; status: string; detail?: string }[] | null>(null);

  const allStages = useMemo(() => options.pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name }))), [options.pipelines]);
  const set = (patch: Partial<BuilderValue>) => setValue((v) => ({ ...v, ...patch }));
  const setAction = (i: number, a: BuilderAction) => set({ actions: value.actions.map((x, j) => (j === i ? a : x)) });
  const err = (path: string) => (errors[path] ? t(errors[path]!) : undefined);

  function save() {
    setErrors({});
    startSave(async () => {
      const res = await saveAutomationAction({ locale, id, data: value });
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(t(res.fieldErrors?.actions ?? res.error));
        return;
      }
      toast.success(t(res.message ?? "common.saved"));
      if (!id && res.data?.id) router.push(`/${locale}/automations/${res.data.id}`);
      else router.refresh();
    });
  }

  function runTest() {
    if (!id) return;
    startTest(async () => {
      const res = await testAutomationAction({ locale, id, contactId: testContact || undefined });
      if (res.error) toast.error(t(res.error));
      else {
        setTestResult(res.data?.steps ?? []);
        router.refresh();
      }
    });
  }

  const triggerConfig = () => {
    const tc = value.trigger_config;
    const setTc = (k: string, v: string) => set({ trigger_config: v ? { ...tc, [k]: v } : Object.fromEntries(Object.entries(tc).filter(([key]) => key !== k)) });
    switch (value.trigger_type) {
      case "contact.status_changed":
        return (
          <Field label={t("automations.cfg.toStatus")} htmlFor="tc-status">
            <Select id="tc-status" value={tc.to ?? ""} onChange={(e) => setTc("to", e.target.value)}>
              <option value="">{t("automations.any")}</option>
              {CONTACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`crm.statuses.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "contact.tagged":
        return (
          <Field label={t("automations.cfg.tag")} htmlFor="tc-tag">
            <Input id="tc-tag" list="automation-tags" value={tc.tag ?? ""} onChange={(e) => setTc("tag", e.target.value)} placeholder={t("automations.any")} />
          </Field>
        );
      case "deal.stage_changed":
        return (
          <Field label={t("automations.cfg.stage")} htmlFor="tc-stage">
            <Select id="tc-stage" value={tc.stage_id ?? ""} onChange={(e) => setTc("stage_id", e.target.value)}>
              <option value="">{t("automations.any")}</option>
              {allStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {pipelineLabel(t, s.pipeline)} › {stageLabel(t, s.name)}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "deal.created":
      case "deal.won":
      case "deal.lost":
        return (
          <Field label={t("deals.pipeline")} htmlFor="tc-pipeline">
            <Select id="tc-pipeline" value={tc.pipeline_id ?? ""} onChange={(e) => setTc("pipeline_id", e.target.value)}>
              <option value="">{t("automations.any")}</option>
              {options.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {pipelineLabel(t, p.name)}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "form.submitted":
        return (
          <Field label={t("automations.cfg.form")} htmlFor="tc-form">
            <Select id="tc-form" value={tc.form_id ?? ""} onChange={(e) => setTc("form_id", e.target.value)}>
              <option value="">{t("automations.any")}</option>
              {options.forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "webhook.inbound":
        return inboundUrl ? (
          <div className="space-y-1.5 sm:col-span-2">
            <span className="text-[13px] font-medium text-muted">{t("automations.inboundUrl")}</span>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-elevated px-3 py-2 text-[12.5px]">
                {inboundUrl}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(inboundUrl);
                  toast.success(t("common.copied"));
                }}
              >
                <Copy className="h-4 w-4" /> {t("common.copy")}
              </Button>
            </div>
            <p className="text-[12px] text-subtle">{t("automations.inboundHint")}</p>
          </div>
        ) : (
          <p className="text-[13px] text-muted sm:col-span-2">{t("automations.inboundAfterSave")}</p>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <datalist id="automation-tags">
        {options.tags.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("automations.name")} htmlFor="a-name" error={err("name")}>
            <Input id="a-name" value={value.name} onChange={(e) => set({ name: e.target.value })} required />
          </Field>
          <Field label={t("automations.description")} htmlFor="a-desc" error={err("description")}>
            <Input id="a-desc" value={value.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
            <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
            {t("automations.enabled")}
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Zap className="h-4 w-4 text-gold" /> {t("automations.when")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("automations.trigger")} htmlFor="a-trigger" error={err("trigger_type")}>
            <Select id="a-trigger" value={value.trigger_type} onChange={(e) => set({ trigger_type: e.target.value as AutomationTrigger, trigger_config: {} })}>
              {AUTOMATION_TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>
                  {triggerLabel(t, tr)}
                </option>
              ))}
            </Select>
          </Field>
          {triggerConfig()}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Filter className="h-4 w-4 text-teal" /> {t("automations.onlyIf")}
        </h2>
        <p className="mb-3 text-[12.5px] text-subtle">{t("automations.conditionsHint")}</p>
        <ol className="space-y-2">
          {value.conditions.map((c, i) => (
            <li key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_160px_1fr_auto]">
              <Select aria-label={t("automations.field")} value={c.field} onChange={(e) => set({ conditions: value.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>
                {CONDITION_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {t(`automations.fields.${f.replace(/\./g, "_")}`)}
                  </option>
                ))}
              </Select>
              <Select aria-label={t("automations.operator")} value={c.op} onChange={(e) => set({ conditions: value.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof c.op } : x)) })}>
                {CONDITION_OPS.map((o) => (
                  <option key={o} value={o}>
                    {t(`automations.ops.${o}`)}
                  </option>
                ))}
              </Select>
              {c.op === "empty" || c.op === "not_empty" ? (
                <span />
              ) : (
                <Input aria-label={t("automations.value")} value={c.value} onChange={(e) => set({ conditions: value.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              )}
              <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => set({ conditions: value.conditions.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => set({ conditions: [...value.conditions, { field: "contact.source", op: "eq", value: "" }] })}>
          <Plus className="h-4 w-4" /> {t("automations.addCondition")}
        </Button>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Play className="h-4 w-4 text-accent" /> {t("automations.then")}
        </h2>
        <p className="mb-3 text-[12.5px] text-subtle">
          {t("automations.variablesHint")}{" "}
          {VARIABLES.map((v) => (
            <code key={v} dir="ltr" className="mx-0.5 inline-block rounded bg-elevated px-1.5 py-0.5 text-[11.5px]">
              {`{{${v}}}`}
            </code>
          ))}
        </p>
        {err("actions") ? <p className="mb-2 text-[13px] text-danger">{err("actions")}</p> : null}
        <ol className="space-y-3">
          {value.actions.map((a, i) => (
            <li key={i} className="rounded-xl border border-line p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{i + 1}</span>
                <Select aria-label={t("automations.actionType")} className="max-w-xs flex-1" value={a.type} onChange={(e) => setAction(i, { type: e.target.value as ActionType, config: defaultConfig(e.target.value as ActionType) })}>
                  {ACTION_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`automations.actions.${x}`)}
                    </option>
                  ))}
                </Select>
                <div className="ms-auto flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={t("deals.moveEarlier")} disabled={i === 0} onClick={() => set({ actions: value.actions.map((x, j) => (j === i - 1 ? value.actions[i]! : j === i ? value.actions[i - 1]! : x)) })}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t("deals.moveLater")} disabled={i === value.actions.length - 1} onClick={() => set({ actions: value.actions.map((x, j) => (j === i + 1 ? value.actions[i]! : j === i ? value.actions[i + 1]! : x)) })}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => set({ actions: value.actions.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <ActionFields index={i} action={a} onChange={(cfg) => setAction(i, { ...a, config: cfg })} options={options} allStages={allStages} err={err} />
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => set({ actions: [...value.actions, { type: "create_task", config: defaultConfig("create_task") }] })}>
          <Plus className="h-4 w-4" /> {t("automations.addAction")}
        </Button>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {id ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select aria-label={t("automations.testContact")} value={testContact} onChange={(e) => setTestContact(e.target.value)} className="sm:w-64">
              <option value="">{t("automations.testNoContact")}</option>
              {options.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.sub ? ` · ${c.sub}` : ""}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={runTest} loading={testing}>
              <Play className="h-4 w-4" /> {t("automations.test")}
            </Button>
          </div>
        ) : (
          <span className="text-[13px] text-subtle">{t("automations.saveToTest")}</span>
        )}
        <Button onClick={save} loading={saving}>
          <Save className="h-4 w-4" /> {t("common.save")}
        </Button>
      </div>

      {testResult ? (
        <Card className="p-4" role="status">
          <h3 className="mb-2 text-sm font-semibold">{t("automations.testResult")}</h3>
          <ul className="space-y-1 text-[13px]">
            {testResult.map((s, i) => (
              <li key={i} className={s.status === "error" ? "text-danger" : s.status === "skipped" ? "text-muted" : "text-success"}>
                {i + 1}. {t(`automations.actions.${s.type}`)} — {t(`automations.stepStatus.${s.status}`)}
                {s.detail ? <span className="text-subtle"> — <bdi>{stepDetailLabel(t, s.detail)}</bdi></span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function ActionFields({
  index,
  action,
  onChange,
  options,
  allStages,
  err,
}: {
  index: number;
  action: BuilderAction;
  onChange: (cfg: Record<string, unknown>) => void;
  options: BuilderOptions;
  allStages: { id: string; name: string; pipeline: string }[];
  err: (p: string) => string | undefined;
}) {
  const { t } = useI18n();
  const c = action.config;
  const [emailMode, setEmailMode] = useState<"contact" | "custom">(!c.to || c.to === "contact" ? "contact" : "custom");
  const s = (k: string) => (c[k] == null ? "" : String(c[k]));
  const up = (k: string, v: unknown) => onChange({ ...c, [k]: v === "" ? undefined : v });
  const id = (k: string) => `act-${index}-${k}`;
  const e = (k: string) => err(`actions.${index}.config.${k}`);

  const delay = (
    <Field label={t("automations.delay")} htmlFor={id("delay")}>
      <Select id={id("delay")} value={s("delay_minutes") || "0"} onChange={(ev) => up("delay_minutes", Number(ev.target.value) || undefined)}>
        {DELAYS.map((d) => (
          <option key={d} value={d}>
            {t(`automations.delays.${d}`)}
          </option>
        ))}
      </Select>
    </Field>
  );

  const body = () => {
    switch (action.type) {
      case "create_task":
        return (
          <>
            <Field label={t("tasks.taskTitle")} htmlFor={id("title")} error={e("title")} className="sm:col-span-2">
              <Input id={id("title")} value={s("title")} onChange={(ev) => up("title", ev.target.value)} />
            </Field>
            <Field label={t("automations.cfg.dueInDays")} htmlFor={id("due")}>
              <Input id={id("due")} type="number" min={0} dir="ltr" value={s("due_in_days")} onChange={(ev) => up("due_in_days", ev.target.value === "" ? undefined : Number(ev.target.value))} />
            </Field>
            <Field label={t("tasks.assignee")} htmlFor={id("assignee")}>
              <Select id={id("assignee")} value={s("assignee")} onChange={(ev) => up("assignee", ev.target.value)}>
                <option value="">{t("automations.cfg.unassigned")}</option>
                <option value="owner">{t("automations.cfg.recordOwner")}</option>
                {options.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        );
      case "add_tag":
      case "remove_tag":
        return (
          <Field label={t("automations.cfg.tag")} htmlFor={id("tag")} error={e("tag")}>
            <Input id={id("tag")} list="automation-tags" value={s("tag")} onChange={(ev) => up("tag", ev.target.value)} />
          </Field>
        );
      case "set_contact_status":
        return (
          <Field label={t("crm.status")} htmlFor={id("status")}>
            <Select id={id("status")} value={s("status") || "customer"} onChange={(ev) => up("status", ev.target.value)}>
              {CONTACT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {t(`crm.statuses.${st}`)}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "set_deal_stage":
        return (
          <Field label={t("deals.stage")} htmlFor={id("stage")} error={e("stage_id")}>
            <Select id={id("stage")} value={s("stage_id")} onChange={(ev) => up("stage_id", ev.target.value)}>
              <option value="">—</option>
              {allStages.map((st) => (
                <option key={st.id} value={st.id}>
                  {pipelineLabel(t, st.pipeline)} › {stageLabel(t, st.name)}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "assign_owner":
        return (
          <Field label={t("deals.owner")} htmlFor={id("owner")} error={e("user_id")}>
            <Select id={id("owner")} value={s("user_id")} onChange={(ev) => up("user_id", ev.target.value)}>
              <option value="">—</option>
              {options.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "add_note":
        return (
          <Field label={t("automations.cfg.noteBody")} htmlFor={id("body")} error={e("body")} className="sm:col-span-2">
            <Textarea id={id("body")} value={s("body")} onChange={(ev) => up("body", ev.target.value)} />
          </Field>
        );
      case "notify":
        return (
          <>
            <Field label={t("automations.cfg.notifyWho")} htmlFor={id("to")}>
              <Select id={id("to")} value={s("to") || "admins"} onChange={(ev) => up("to", ev.target.value)}>
                <option value="admins">{t("automations.cfg.admins")}</option>
                <option value="owner">{t("automations.cfg.recordOwner")}</option>
                <option value="all">{t("automations.cfg.everyone")}</option>
                {options.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("automations.cfg.message")} htmlFor={id("text")} error={e("text")} className="sm:col-span-2">
              <Input id={id("text")} value={s("text")} onChange={(ev) => up("text", ev.target.value)} />
            </Field>
          </>
        );
      case "send_email":
        return (
          <>
            <Field label={t("automations.cfg.emailTo")} htmlFor={id("tomode")} error={e("to")}>
              <div className="flex gap-2">
                <Select id={id("tomode")} value={emailMode} onChange={(ev) => { setEmailMode(ev.target.value as "contact" | "custom"); onChange({ ...c, to: ev.target.value === "contact" ? "contact" : "" }); }} className="w-40 shrink-0">
                  <option value="contact">{t("automations.cfg.toContact")}</option>
                  <option value="custom">{t("automations.cfg.toAddress")}</option>
                </Select>
                {emailMode === "custom" ? (
                  <Input aria-label={t("automations.cfg.toAddress")} dir="ltr" type="email" placeholder="name@example.com" value={s("to")} onChange={(ev) => onChange({ ...c, to: ev.target.value })} />
                ) : null}
              </div>
            </Field>
            <Field label={t("automations.cfg.subject")} htmlFor={id("subject")} error={e("subject")}>
              <Input id={id("subject")} value={s("subject")} onChange={(ev) => up("subject", ev.target.value)} />
            </Field>
            <Field label={t("automations.cfg.emailBody")} htmlFor={id("ebody")} error={e("body")} className="sm:col-span-2">
              <Textarea id={id("ebody")} rows={5} value={s("body")} onChange={(ev) => up("body", ev.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-muted sm:col-span-2">
              <input type="checkbox" checked={c.marketing === true} onChange={(ev) => up("marketing", ev.target.checked || undefined)} className="h-4 w-4 accent-[var(--accent)]" />
              {t("automations.cfg.marketing")}
            </label>
          </>
        );
      case "send_webhook":
        return (
          <Field label="URL (https)" htmlFor={id("url")} error={e("url")} className="sm:col-span-2">
            <Input id={id("url")} dir="ltr" placeholder="https://hooks.zapier.com/…" value={s("url")} onChange={(ev) => up("url", ev.target.value)} />
          </Field>
        );
      case "send_whatsapp":
      case "send_telegram":
      case "send_sms":
        return (
          <Field label={t("automations.cfg.message")} htmlFor={id("msg")} error={e("text")} className="sm:col-span-2">
            <Textarea id={id("msg")} value={s("text")} onChange={(ev) => up("text", ev.target.value)} />
          </Field>
        );
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {body()}
      {delay}
    </div>
  );
}
