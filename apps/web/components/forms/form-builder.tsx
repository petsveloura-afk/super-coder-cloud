"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FORM_FIELD_TYPES, type FormField, type FormFieldType } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveFormAction } from "@/app/[locale]/(dashboard)/forms/actions";

export interface FormValue {
  name: string;
  slug: string;
  status: "active" | "inactive";
  fields: FormField[];
  settings: { title?: string; intro?: string; submit_label?: string; success_message?: string; redirect_url?: string; tag?: string; notify: boolean };
}

const PRESETS: { key: string; type: FormFieldType; required?: boolean }[] = [
  { key: "name", type: "text", required: true },
  { key: "email", type: "email", required: true },
  { key: "phone", type: "phone" },
  { key: "company", type: "text" },
  { key: "message", type: "textarea" },
  { key: "marketing_consent", type: "checkbox" },
];

export function FormBuilder({ id, initial }: { id?: string; initial: FormValue }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<FormValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = (patch: Partial<FormValue>) => setV((x) => ({ ...x, ...patch }));
  const setS = (patch: Partial<FormValue["settings"]>) => setV((x) => ({ ...x, settings: { ...x.settings, ...patch } }));
  const setF = (i: number, patch: Partial<FormField>) => set({ fields: v.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const err = (k: string) => (errors[k] ? t(errors[k]!) : undefined);
  const used = new Set(v.fields.map((f) => f.key));

  function save() {
    setErrors({});
    start(async () => {
      const res = await saveFormAction({ locale, id, data: v });
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(t(res.fieldErrors?.fields ?? res.fieldErrors?.slug ?? res.error));
        return;
      }
      toast.success(t(res.message ?? "common.saved"));
      if (!id && res.data?.id) router.push(`/${locale}/forms/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t("forms.name")} htmlFor="fm-name" error={err("name")}>
          <Input id="fm-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t("forms.slug")} htmlFor="fm-slug" error={err("slug")}>
          <Input id="fm-slug" dir="ltr" value={v.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
        </Field>
        <Field label={t("forms.title")} htmlFor="fm-title">
          <Input id="fm-title" value={v.settings.title ?? ""} onChange={(e) => setS({ title: e.target.value })} />
        </Field>
        <Field label={t("forms.submitLabel")} htmlFor="fm-submit">
          <Input id="fm-submit" value={v.settings.submit_label ?? ""} onChange={(e) => setS({ submit_label: e.target.value })} placeholder={t("public.submit")} />
        </Field>
        <Field label={t("forms.intro")} htmlFor="fm-intro" className="sm:col-span-2">
          <Textarea id="fm-intro" value={v.settings.intro ?? ""} onChange={(e) => setS({ intro: e.target.value })} />
        </Field>
        <Field label={t("forms.successMessage")} htmlFor="fm-success">
          <Input id="fm-success" value={v.settings.success_message ?? ""} onChange={(e) => setS({ success_message: e.target.value })} placeholder={t("public.formThanks")} />
        </Field>
        <Field label={t("forms.redirectUrl")} htmlFor="fm-redirect" error={err("settings.redirect_url")}>
          <Input id="fm-redirect" dir="ltr" placeholder="https://" value={v.settings.redirect_url ?? ""} onChange={(e) => setS({ redirect_url: e.target.value })} />
        </Field>
        <Field label={t("forms.tag")} htmlFor="fm-tag">
          <Input id="fm-tag" value={v.settings.tag ?? ""} onChange={(e) => setS({ tag: e.target.value })} />
        </Field>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={v.settings.notify} onChange={(e) => setS({ notify: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
            {t("forms.notify")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={v.status === "active"} onChange={(e) => set({ status: e.target.checked ? "active" : "inactive" })} className="h-4 w-4 accent-[var(--accent)]" />
            {t("forms.active")}
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 font-semibold">{t("forms.fields")}</h2>
        <p className="mb-3 text-[12.5px] text-subtle">{t("forms.fieldsHint")}</p>
        {err("fields") ? <p className="mb-2 text-[13px] text-danger">{err("fields")}</p> : null}
        <ol className="space-y-3">
          {v.fields.map((f, i) => (
            <li key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_140px_auto]">
              <Input aria-label={t("forms.fieldLabel")} placeholder={t("forms.fieldLabel")} value={f.label} onChange={(e) => setF(i, { label: e.target.value })} />
              <Input aria-label={t("forms.fieldKey")} dir="ltr" placeholder="key" value={f.key} onChange={(e) => setF(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
              <Select aria-label={t("forms.fieldType")} value={f.type} onChange={(e) => setF(i, { type: e.target.value as FormFieldType })}>
                {FORM_FIELD_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`forms.types.${ty}`)}
                  </option>
                ))}
              </Select>
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1.5 px-1 text-[12.5px]">
                  <input type="checkbox" checked={f.required} onChange={(e) => setF(i, { required: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
                  {t("forms.required")}
                </label>
                <Button variant="ghost" size="icon" aria-label={t("deals.moveEarlier")} disabled={i === 0} onClick={() => set({ fields: v.fields.map((x, j) => (j === i - 1 ? v.fields[i]! : j === i ? v.fields[i - 1]! : x)) })}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("deals.moveLater")} disabled={i === v.fields.length - 1} onClick={() => set({ fields: v.fields.map((x, j) => (j === i + 1 ? v.fields[i]! : j === i ? v.fields[i + 1]! : x)) })}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => set({ fields: v.fields.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {f.type === "select" ? (
                <Input
                  className="sm:col-span-4"
                  aria-label={t("forms.options")}
                  placeholder={t("forms.optionsPlaceholder")}
                  value={(f.options ?? []).join(", ")}
                  onChange={(e) => setF(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                />
              ) : null}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.filter((p) => !used.has(p.key)).map((p) => (
            <Button key={p.key} variant="secondary" size="sm" onClick={() => set({ fields: [...v.fields, { key: p.key, type: p.type, required: Boolean(p.required), label: t(`forms.presets.${p.key}`) }] })}>
              <Plus className="h-4 w-4" /> {t(`forms.presets.${p.key}`)}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => set({ fields: [...v.fields, { key: `field_${v.fields.length + 1}`, type: "text", required: false, label: "" }] })}>
            <Plus className="h-4 w-4" /> {t("forms.customField")}
          </Button>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={pending}>
          <Save className="h-4 w-4" /> {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
