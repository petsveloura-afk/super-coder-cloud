"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import type { FormField } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { submitPublicForm } from "@/app/[locale]/(public)/actions";

export function PublicForm({
  slug,
  fields,
  settings,
  orgName,
  formName,
}: {
  slug: string;
  fields: FormField[];
  settings: { title?: string; intro?: string; submit_label?: string; success_message?: string };
  orgName: string;
  formName: string;
}) {
  const { t } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, string> = {};
    for (const f of fields) {
      const v = fd.get(f.key);
      if (f.type === "checkbox") data[f.key] = v ? "true" : "";
      else if (typeof v === "string") data[f.key] = v;
    }
    const utm = Object.fromEntries(Array.from(new URLSearchParams(window.location.search)).filter(([k]) => k.startsWith("utm_")));
    setErrors({});
    setFormError(null);
    start(async () => {
      const res = await submitPublicForm({ slug, data, utm, honeypot: String(fd.get("website") ?? "") });
      if (res.ok) {
        if (res.redirect) {
          // inside an iframe, navigate the embedding page
          (window.top ?? window).location.href = res.redirect;
          return;
        }
        setDone(res.message || t("public.formThanks"));
      } else if (res.errors) setErrors(res.errors);
      else setFormError(t(res.error ?? "errors.generic"));
    });
  }

  if (done) {
    return (
      <div role="status" className="rounded-3xl border border-line bg-surface p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <p className="mt-4 whitespace-pre-wrap text-lg font-semibold">{done}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <header>
        <p className="text-[12.5px] font-medium text-subtle">{orgName}</p>
        <h1 className="mt-1 text-2xl font-bold">{settings.title || formName}</h1>
        {settings.intro ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{settings.intro}</p> : null}
      </header>
      {formError ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}
      {/* honeypot: hidden from humans and assistive tech */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {fields.map((f) => {
        const id = `pf-${f.key}`;
        const err = errors[f.key] ? t(errors[f.key]!) : undefined;
        const label = `${f.label}${f.required ? " *" : ""}`;
        if (f.type === "checkbox") {
          return (
            <div key={f.key}>
              <label className="flex items-start gap-2.5 text-sm">
                <input id={id} type="checkbox" name={f.key} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" aria-invalid={Boolean(err)} />
                <span>{label}</span>
              </label>
              {err ? <p className="mt-1 text-[13px] text-danger">{err}</p> : null}
            </div>
          );
        }
        return (
          <Field key={f.key} label={label} htmlFor={id} error={err}>
            {f.type === "textarea" ? (
              <Textarea id={id} name={f.key} placeholder={f.placeholder} required={f.required} aria-invalid={Boolean(err)} />
            ) : f.type === "select" ? (
              <Select id={id} name={f.key} required={f.required} defaultValue="" aria-invalid={Boolean(err)}>
                <option value="" disabled>
                  {f.placeholder || "—"}
                </option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                name={f.key}
                type={f.type === "phone" ? "tel" : f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                dir={f.type === "email" || f.type === "phone" ? "ltr" : undefined}
                inputMode={f.type === "phone" ? "tel" : f.type === "email" ? "email" : undefined}
                autoComplete={f.key === "email" ? "email" : f.key === "phone" ? "tel" : f.key === "name" ? "name" : "off"}
                placeholder={f.placeholder}
                required={f.required}
                aria-invalid={Boolean(err)}
              />
            )}
          </Field>
        );
      })}
      <Button type="submit" size="lg" loading={pending} className="w-full justify-center">
        {settings.submit_label || t("public.submit")}
      </Button>
    </form>
  );
}
