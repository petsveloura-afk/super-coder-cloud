import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Building2, Mail, Phone, Briefcase, Radio, ShieldCheck, ShieldOff } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import type { AuditLogRow, ContactRow, NoteRow } from "@scc/database";
import { Badge, Card, CardHeader, Ltr } from "@/components/ui/primitives";
import { ContactDialog } from "@/components/crm/contact-form";
import { StatusBadge } from "@/components/crm/status-badge";
import { AddNoteForm, DeleteContactButton } from "@/components/crm/contact-detail-client";
import { ContactAIAssistant } from "@/components/crm/ai-assistant";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { auditLabel } from "@/lib/i18n/translate";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPhone } from "@/lib/format";
import { initials } from "@/lib/utils";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("crm.details") };
}

export default async function ContactDetailPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id: rawId } = await params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();

  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .maybeSingle<ContactRow>();
  // Another tenant's id (or a deleted one) is indistinguishable from "not found".
  if (!contact) notFound();

  const [notesRes, auditRes] = await Promise.all([
    supabase
      .from("notes")
      .select("id, body, created_at, created_by")
      .eq("organization_id", ctx.org.id)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(50),
    ctx.can("audit.read")
      ? supabase
          .from("audit_logs")
          .select("id, action, metadata, created_at")
          .eq("organization_id", ctx.org.id)
          .eq("entity_id", contact.id)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const notes = (notesRes.data ?? []) as Pick<NoteRow, "id" | "body" | "created_at" | "created_by">[];
  const audit = (auditRes.data ?? []) as Pick<AuditLogRow, "id" | "action" | "metadata" | "created_at">[];

  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const name = `${contact.first_name} ${contact.last_name}`.trim();

  const info = [
    { icon: Mail, label: t("crm.email"), value: contact.email ? <Ltr>{contact.email}</Ltr> : "—" },
    { icon: Phone, label: t("crm.phone"), value: contact.phone ? <Ltr>{formatPhone(contact.phone)}</Ltr> : "—" },
    { icon: Building2, label: t("crm.company"), value: contact.company_name || "—" },
    { icon: Briefcase, label: t("crm.jobTitle"), value: contact.job_title || "—" },
    { icon: Radio, label: t("crm.source"), value: t(`crm.sources.${contact.source}`) },
  ];

  return (
    <>
      <Link href={`/${locale}/crm`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("crm.title")}
      </Link>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-lg font-bold text-accent">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold sm:text-2xl">{name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusBadge status={contact.status} />
                {contact.is_demo ? <Badge tone="gold">{t("common.demo")}</Badge> : null}
                <span className="text-[12px] text-subtle">
                  {t("crm.createdAt")}: {formatDate(locale, contact.created_at)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {ctx.can("contacts.write") ? <ContactDialog contact={contact} /> : null}
            {ctx.can("contacts.delete") ? <DeleteContactButton id={contact.id} /> : null}
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title={t("crm.details")} />
          <dl className="divide-y divide-line">
            {info.map((row) => (
              <div key={row.label} className="flex items-center gap-3 px-5 py-3">
                <row.icon className="h-4 w-4 shrink-0 text-subtle" />
                <dt className="w-24 shrink-0 text-[13px] text-muted">{row.label}</dt>
                <dd className="min-w-0 truncate text-sm">{row.value}</dd>
              </div>
            ))}
            <div className="flex items-center gap-3 px-5 py-3 text-sm">
              {contact.marketing_consent ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-success" />
                  <span>{t("crm.consentAt", { date: contact.marketing_consent_at ? formatDate(locale, contact.marketing_consent_at) : "—" })}</span>
                </>
              ) : (
                <>
                  <ShieldOff className="h-4 w-4 text-subtle" />
                  <span className="text-muted">{t("crm.noConsent")}</span>
                </>
              )}
            </div>
          </dl>
        </Card>

        <div className="space-y-4">
        {ctx.can("ai.use") ? (
          <Card>
            <CardHeader title={t("ai.assistant")} description={t("ai.assistantHint")} />
            <div className="p-5">
              <ContactAIAssistant contactId={contact.id} canWriteNotes={ctx.can("contacts.write")} />
            </div>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("crm.timeline")} />
          <div className="space-y-4 p-5">
            {ctx.can("contacts.write") ? <AddNoteForm contactId={contact.id} /> : null}
            {notes.length === 0 && audit.length === 0 ? (
              <p className="py-6 text-center text-sm text-subtle">{t("crm.noTimeline")}</p>
            ) : (
              <ol className="relative space-y-3 border-s border-line ps-5">
                {[
                  ...notes.map((n) => ({ kind: "note" as const, at: n.created_at, id: `n${n.id}`, body: n.body })),
                  ...audit.map((a) => ({ kind: "audit" as const, at: a.created_at, id: `a${a.id}`, body: auditLabel(t, a.action) })),
                ]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((e) => (
                    <li key={e.id} className="relative">
                      <span className={`absolute -start-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${e.kind === "note" ? "bg-accent" : "bg-subtle"}`} />
                      <div className="text-[12px] text-subtle">{formatDateTime(locale, e.at)}</div>
                      {e.kind === "note" ? (
                        <p className="mt-1 whitespace-pre-wrap rounded-xl bg-elevated px-3.5 py-2.5 text-sm">{e.body}</p>
                      ) : (
                        <p className="mt-0.5 text-[13px] text-muted">{e.body}</p>
                      )}
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </Card>
        </div>
      </div>
    </>
  );
}
