import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { FormField } from "@scc/shared/engagement";
import { uuidSchema } from "@scc/shared/validators";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { FormBuilder, type FormValue } from "@/components/forms/form-builder";
import { ShareBox } from "@/components/forms/share-box";
import { DeleteFormButton } from "@/components/forms/delete-button";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("forms.edit") };
}

export default async function FormPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id: rawId } = await params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("forms.manage")) notFound();
  const supabase = await createClient();
  const { data: form } = await supabase.from("forms").select("id, name, slug, status, fields, settings, submission_count").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!form) notFound();
  const { data: subs } = await supabase
    .from("form_submissions")
    .select("id, contact_id, data, created_at")
    .eq("organization_id", ctx.org.id)
    .eq("form_id", form.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const fields = form.fields as FormField[];
  const url = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/f/${form.slug}`;
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const shown = fields.filter((f) => f.type !== "checkbox").slice(0, 4);

  return (
    <>
      <Link href={`/${locale}/forms`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("forms.pageTitle")}
      </Link>
      <PageHeader title={form.name as string} description={t("forms.submissions", { count: Number(form.submission_count) })} actions={<DeleteFormButton id={form.id as string} />} />
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <FormBuilder id={form.id as string} initial={{ name: form.name as string, slug: form.slug as string, status: form.status as FormValue["status"], fields, settings: { notify: true, ...(form.settings as object) } }} />
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("forms.share")} description={form.status === "active" ? undefined : t("forms.inactiveHint")} />
            <div className="p-4">
              <ShareBox url={url} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t("forms.latestSubmissions")} />
            {(subs ?? []).length === 0 ? (
              <p className="p-5 text-center text-sm text-subtle">{t("forms.noSubmissions")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(subs ?? []).map((s) => {
                  const d = s.data as Record<string, string>;
                  return (
                    <li key={s.id} className="px-4 py-3 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        {s.contact_id ? (
                          <Link href={`/${locale}/crm/${s.contact_id}`} className="font-medium hover:text-accent">
                            {d.name || d.first_name || d.email || d.phone || "—"}
                          </Link>
                        ) : (
                          <span className="font-medium">{d.name || d.email || "—"}</span>
                        )}
                        <span className="text-[12px] text-subtle">{formatDateTime(locale, s.created_at as string)}</span>
                      </div>
                      <div className="mt-1 space-y-0.5 text-muted">
                        {shown.map((f) => (d[f.key] ? <div key={f.key} className="truncate">{f.label}: {d[f.key]}</div> : null))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
