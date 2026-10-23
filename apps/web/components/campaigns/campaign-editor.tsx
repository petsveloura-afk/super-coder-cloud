"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Save, Send, Smartphone, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { CAMPAIGN_CHANNELS } from "@scc/shared/engagement";
import { CONTACT_STATUSES, LEAD_SOURCES } from "@scc/shared/validators";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { aiSegmentAction, launchCampaignAction, previewAudienceAction, saveCampaignAction } from "@/app/[locale]/(dashboard)/campaigns/actions";
import { cn } from "@/lib/utils";

export interface CampaignValue {
  name: string;
  channel: (typeof CAMPAIGN_CHANNELS)[number];
  subject: string;
  body: string;
  audience: {
    status?: string;
    source?: string;
    tags?: string[];
    // wave 17: smart audience
    min_score?: number;
    max_score?: number;
    sentiment?: string;
    stage?: string;
    active_days?: number;
    inactive_days?: number;
    purchases_min?: number;
  };
  scheduled_at?: string;
  wa_template?: { name: string; language: string; params: string[] } | null;
}

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const STAGES = ["new", "interested", "considering", "ready", "customer", "lost"] as const;
const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

const ICON = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, telegram: Send } as const;

function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CampaignEditor({ id, initial, tags, channelsReady }: { id?: string; initial: CampaignValue; tags: string[]; channelsReady: Record<string, boolean> }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<CampaignValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [count, setCount] = useState<number | null>(null);
  const [saving, startSave] = useTransition();
  const [counting, startCount] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [segText, setSegText] = useState("");
  const [segmenting, startSeg] = useTransition();
  const set = (patch: Partial<CampaignValue>) => {
    setV((x) => ({ ...x, ...patch }));
    setCount(null);
    setDirty(true);
  };
  const err = (k: string) => (errors[k] ? t(errors[k]!) : undefined);

  function save() {
    setErrors({});
    startSave(async () => {
      const res = await saveCampaignAction({ locale, id, data: { ...v, audience: clean(v.audience), wa_template: v.channel === "whatsapp" && v.wa_template?.name ? v.wa_template : null } });
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(t(res.error));
        return;
      }
      toast.success(t(res.message ?? "common.saved"));
      setDirty(false);
      if (!id && res.data?.id) router.push(`/${locale}/campaigns/${res.data.id}`);
      else router.refresh();
    });
  }

  function aiSegment() {
    startSeg(async () => {
      const res = await aiSegmentAction({ locale, text: segText });
      if (res.error || !res.data) {
        toast.error(t(res.error ?? "errors.generic"));
        return;
      }
      set({ audience: { ...(res.data.audience as CampaignValue["audience"]) } });
      toast.success(t(res.message ?? "campaigns.segmentReady"));
    });
  }

  function preview() {
    startCount(async () => {
      const res = await previewAudienceAction({ locale, channel: v.channel, audience: clean(v.audience) });
      if (res.error) toast.error(t(res.error));
      else setCount(res.data?.count ?? 0);
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <Field label={t("campaigns.name")} htmlFor="cp-name" error={err("name")}>
          <Input id="cp-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-muted">{t("campaigns.channel")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
            {CAMPAIGN_CHANNELS.map((c) => {
              const Icon = ICON[c];
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={v.channel === c}
                  onClick={() => set({ channel: c })}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border p-3 text-sm", v.channel === c ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-accent")}
                >
                  <Icon className="h-5 w-5" />
                  {t(`campaigns.channels.${c}`)}
                  {!channelsReady[c] ? <span className="text-[11px] text-danger">{t("campaigns.notConnected")}</span> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
        {v.channel === "email" ? (
          <Field label={t("automations.cfg.subject")} htmlFor="cp-subject" error={err("subject")}>
            <Input id="cp-subject" value={v.subject} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
        ) : null}
        <Field label={t("campaigns.message")} htmlFor="cp-body" error={err("body")}>
          <Textarea id="cp-body" rows={8} value={v.body} onChange={(e) => set({ body: e.target.value })} />
        </Field>
        <p className="text-[12px] text-subtle">
          {t("automations.variablesHint")} <code dir="ltr">{"{{contact.first_name}}"}</code> <code dir="ltr">{"{{org.name}}"}</code>
          {v.channel === "sms" ? ` · ${t("campaigns.smsLength", { count: v.body.length })}` : ""}
        </p>
        {v.channel === "whatsapp" ? (
          <div className="space-y-3 rounded-xl border border-line p-3">
            <p className="text-[13px] font-medium">{t("campaigns.waTemplate")}</p>
            <p className="text-[12px] text-subtle">{t("campaigns.waTemplateHint")}</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <Field label={t("campaigns.waTemplateName")} htmlFor="cp-tpl-name" error={err("wa_template")}>
                <Input id="cp-tpl-name" dir="ltr" placeholder="spring_sale" value={v.wa_template?.name ?? ""} onChange={(e) => set({ wa_template: { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 120), language: v.wa_template?.language ?? (locale === "en" ? "en" : locale === "ar" ? "ar" : "he"), params: v.wa_template?.params ?? [] } })} />
              </Field>
              <Field label={t("campaigns.waTemplateLang")} htmlFor="cp-tpl-lang">
                <Input id="cp-tpl-lang" dir="ltr" placeholder="he" value={v.wa_template?.language ?? ""} onChange={(e) => set({ wa_template: { name: v.wa_template?.name ?? "", language: e.target.value.replace(/[^a-zA-Z_]/g, "").slice(0, 6), params: v.wa_template?.params ?? [] } })} />
              </Field>
            </div>
            <Field label={t("campaigns.waTemplateParams")} htmlFor="cp-tpl-params" hint={t("campaigns.waTemplateParamsHint")}>
              <Input id="cp-tpl-params" dir="auto" placeholder="{{contact.first_name}} | 20%" value={(v.wa_template?.params ?? []).join(" | ")} onChange={(e) => set({ wa_template: { name: v.wa_template?.name ?? "", language: v.wa_template?.language ?? "he", params: e.target.value.split("|").map((x) => x.trim()).filter(Boolean).slice(0, 10) } })} />
            </Field>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Users className="h-4 w-4 text-accent" /> {t("campaigns.audience")}
        </h2>
        <p className="text-[12.5px] text-subtle">{t("campaigns.consentNote")}</p>
        {/* wave 17: describe the audience in words → filters */}
        <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3 sm:flex-row sm:items-end">
          <Field label={t("campaigns.aiSegment")} htmlFor="cp-seg" className="flex-1">
            <Input id="cp-seg" value={segText} onChange={(e) => setSegText(e.target.value.slice(0, 600))} placeholder={t("campaigns.aiSegmentPlaceholder")} />
          </Field>
          <Button variant="secondary" onClick={aiSegment} loading={segmenting} disabled={segText.trim().length < 3}>
            <Sparkles className="h-4 w-4" /> {t("campaigns.aiSegmentGo")}
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("crm.status")} htmlFor="cp-status">
            <Select id="cp-status" value={v.audience.status ?? ""} onChange={(e) => set({ audience: { ...v.audience, status: e.target.value || undefined } })}>
              <option value="">{t("common.all")}</option>
              {CONTACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`crm.statuses.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("crm.source")} htmlFor="cp-source">
            <Select id="cp-source" value={v.audience.source ?? ""} onChange={(e) => set({ audience: { ...v.audience, source: e.target.value || undefined } })}>
              <option value="">{t("common.all")}</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`crm.sources.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("campaigns.tags")} htmlFor="cp-tags">
            <Input id="cp-tags" list="cp-tag-list" placeholder={t("campaigns.tagsPlaceholder")} value={(v.audience.tags ?? []).join(", ")} onChange={(e) => set({ audience: { ...v.audience, tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} />
            <datalist id="cp-tag-list">
              {tags.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </Field>
        </div>
        <details className="rounded-xl border border-line p-3" open={Boolean(v.audience.min_score ?? v.audience.max_score ?? v.audience.sentiment ?? v.audience.stage ?? v.audience.active_days ?? v.audience.inactive_days ?? v.audience.purchases_min)}>
          <summary className="cursor-pointer text-[13px] font-medium">{t("campaigns.smartFilters")}</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label={t("campaigns.minScore")} htmlFor="cp-minscore">
              <Input id="cp-minscore" type="number" min={0} max={100} value={v.audience.min_score ?? ""} onChange={(e) => set({ audience: { ...v.audience, min_score: num(e.target.value) } })} />
            </Field>
            <Field label={t("campaigns.maxScore")} htmlFor="cp-maxscore">
              <Input id="cp-maxscore" type="number" min={0} max={100} value={v.audience.max_score ?? ""} onChange={(e) => set({ audience: { ...v.audience, max_score: num(e.target.value) } })} />
            </Field>
            <Field label={t("campaigns.sentiment")} htmlFor="cp-sent">
              <Select id="cp-sent" value={v.audience.sentiment ?? ""} onChange={(e) => set({ audience: { ...v.audience, sentiment: e.target.value || undefined } })}>
                <option value="">{t("common.all")}</option>
                {SENTIMENTS.map((x) => (
                  <option key={x} value={x}>
                    {t(`insights.sentiment.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("campaigns.buyStage")} htmlFor="cp-stage">
              <Select id="cp-stage" value={v.audience.stage ?? ""} onChange={(e) => set({ audience: { ...v.audience, stage: e.target.value || undefined } })}>
                <option value="">{t("common.all")}</option>
                {STAGES.map((x) => (
                  <option key={x} value={x}>
                    {t(`insights.stage.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("campaigns.activeDays")} htmlFor="cp-active">
              <Input id="cp-active" type="number" min={1} value={v.audience.active_days ?? ""} onChange={(e) => set({ audience: { ...v.audience, active_days: num(e.target.value) } })} />
            </Field>
            <Field label={t("campaigns.inactiveDays")} htmlFor="cp-inactive">
              <Input id="cp-inactive" type="number" min={1} value={v.audience.inactive_days ?? ""} onChange={(e) => set({ audience: { ...v.audience, inactive_days: num(e.target.value) } })} />
            </Field>
            <Field label={t("campaigns.purchasesMin")} htmlFor="cp-purch">
              <Input id="cp-purch" type="number" min={0} value={v.audience.purchases_min ?? ""} onChange={(e) => set({ audience: { ...v.audience, purchases_min: num(e.target.value) } })} />
            </Field>
          </div>
          <p className="mt-2 text-[12px] text-subtle">{t("campaigns.optOutExcluded")}</p>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={preview} loading={counting}>
            {t("campaigns.countRecipients")}
          </Button>
          {count !== null ? (
            <span role="status" className="text-sm font-semibold">
              {t("campaigns.recipientsCount", { count })}
            </span>
          ) : null}
        </div>
        <Field label={t("campaigns.schedule")} htmlFor="cp-schedule" error={err("scheduled_at")}>
          <Input id="cp-schedule" type="datetime-local" dir="ltr" className="max-w-xs" defaultValue={toLocalInput(v.scheduled_at)} onChange={(e) => set({ scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
        </Field>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={save} loading={saving}>
          <Save className="h-4 w-4" /> {t("campaigns.saveDraft")}
        </Button>
        {id && dirty ? <span className="self-center text-[12.5px] text-subtle">{t("campaigns.saveBeforeSend")}</span> : null}
        {id && !dirty ? (
          <ConfirmActionButton
            action={launchCampaignAction}
            fields={{ id }}
            variant="primary"
            icon={<Send className="h-4 w-4" />}
            label={v.scheduled_at ? t("campaigns.schedule") : t("campaigns.sendNow")}
            confirm={t("campaigns.confirmLaunch")}
          />
        ) : null}
      </div>
    </div>
  );
}

function clean(a: CampaignValue["audience"]) {
  const out: CampaignValue["audience"] = {};
  if (a.status) out.status = a.status;
  if (a.source) out.source = a.source;
  if (a.tags?.length) out.tags = a.tags;
  // wave 17
  for (const k of ["min_score", "max_score", "active_days", "inactive_days", "purchases_min"] as const) if (typeof a[k] === "number") out[k] = a[k];
  if (a.sentiment) out.sentiment = a.sentiment;
  if (a.stage) out.stage = a.stage;
  return out;
}
