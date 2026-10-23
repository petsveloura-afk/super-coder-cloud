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
import { formatCurrency, formatDate, formatDateTime, formatPhone } from "@/lib/format";
import { initials } from "@/lib/utils";
import { TagsEditor } from "@/components/crm/tags-editor";
import { DuplicatesList, type DuplicateRow } from "@/components/crm/duplicates";
import { EditDealDialog, NewDealButton, type DealPickers, type DealRecord } from "@/components/pipelines/deal-form";
import { NewTaskButton, TaskCheckbox } from "@/components/tasks/task-form";
import { companyOptions, contactOptions, memberOptions, pipelinesWithStages } from "@/lib/lookups";
import { MessageContactButton } from "@/components/inbox/inbox-client";
import { InsightsCard, type InsightsData } from "@/components/crm/insights-card";
import { AgentCallButton } from "@/components/crm/agent-call-button";
import { UnifiedTimeline, type TimelineItem } from "@/components/crm/unified-timeline";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("crm.details") };
}

export default async function ContactDetailPage({ params, searchParams }: { params: Params; searchParams?: Promise<{ before?: string }> }) {
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
  // v4 (wave 1): tags, deals, tasks and possible duplicates for this contact.
  const [tagRes, allTagRes, dealRes, taskRes, dupRes, pipelines, contactOpts, companyOpts, memberOpts] = await Promise.all([
    supabase.from("contact_tags").select("tags(name, color)").eq("organization_id", ctx.org.id).eq("contact_id", contact.id),
    supabase.from("tags").select("name").eq("organization_id", ctx.org.id).order("name").limit(500),
    ctx.can("deals.read")
      ? supabase
          .from("deals")
          .select("id, title, value, currency, pipeline_id, stage_id, contact_id, company_id, expected_close_date, owner_id, status")
          .eq("organization_id", ctx.org.id)
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    ctx.can("tasks.read")
      ? supabase
          .from("tasks")
          .select("id, title, status, due_at")
          .eq("organization_id", ctx.org.id)
          .eq("contact_id", contact.id)
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    ctx.can("contacts.delete") ? supabase.rpc("find_duplicate_contacts", { p_org: ctx.org.id, p_contact: contact.id }) : Promise.resolve({ data: [] }),
    pipelinesWithStages(ctx.org.id),
    contactOptions(ctx.org.id),
    companyOptions(ctx.org.id),
    memberOptions(ctx.org.id),
  ]);
  const contactTags = ((tagRes.data ?? []) as unknown as { tags: { name: string; color: string } | null }[])
    .map((r) => r.tags)
    .filter((x): x is { name: string; color: string } => Boolean(x));
  const allTags = (allTagRes.data ?? []).map((x) => x.name as string);
  const contactDeals = ((dealRes.data ?? []) as DealRecord[]).map((d) => ({ ...d, value: Number(d.value) }));
  const contactTasks = (taskRes.data ?? []) as { id: string; title: string; status: string; due_at: string | null }[];
  const duplicates = (dupRes.data ?? []) as DuplicateRow[];
  const dealPickers: DealPickers = {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((st) => ({ id: st.id, name: st.name })) })),
    contacts: contactOpts,
    companies: companyOpts,
    members: memberOpts,
  };

  // v4 (wave 3): channels this workspace can message through
  const { data: channelRows } = ctx.can("inbox.reply") ? await supabase.from("channel_accounts").select("kind, status").eq("organization_id", ctx.org.id) : { data: [] };
  const connectedChannels = (channelRows ?? []).filter((r) => r.status !== "disabled").map((r) => r.kind as string);

  // wave 15: insights (score / sentiment / next action), identities and the unified timeline
  const sp = (await searchParams) ?? {};
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : null;
  const [insRes, idRes, tlRes, aiInsights] = await Promise.all([
    supabase.from("contact_insights").select("lead_score, breakdown, sentiment, stage, ai, scored_at, analyzed_at").eq("contact_id", contact.id).eq("organization_id", ctx.org.id).maybeSingle(),
    supabase.from("contact_identities").select("kind, value, source").eq("contact_id", contact.id).eq("organization_id", ctx.org.id).order("created_at").limit(20),
    supabase.rpc("contact_timeline", { p_org: ctx.org.id, p_contact: contact.id, p_limit: 60, p_before: before }),
    ctx.can("ai.use") ? import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "ai_insights")) : Promise.resolve(false),
  ]);
  let insights = (insRes.data ?? null) as InsightsData | null;
  if (!insights?.scored_at) {
    // first visit: compute the rule-based score once (cheap, no AI)
    const { data: fresh } = await supabase.rpc("refresh_contact_score", { p_org: ctx.org.id, p_contact: contact.id });
    if (fresh) insights = { ...(insights ?? {}), ...(fresh as InsightsData) };
  }
  const identities = (idRes.data ?? []) as { kind: string; value: string; source: string | null }[];
  const timeline = ((tlRes.data ?? []) as TimelineItem[]);
  const moreBefore = timeline.length >= 60 ? timeline[timeline.length - 1]!.at : null;

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
              <div className="mt-2">
                <TagsEditor contactId={contact.id} tags={contactTags} allTags={allTags} canWrite={ctx.can("contacts.write")} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {ctx.can("inbox.reply") && connectedChannels.length ? <MessageContactButton contactId={contact.id} channels={connectedChannels} /> : null}
            {ctx.can("inbox.reply") && ctx.can("contacts.write") && contact.phone && connectedChannels.includes("sms") ? <AgentCallButton contactId={contact.id} /> : null}
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
            {identities.length ? (
              <div className="px-5 py-3" data-testid="contact-identities">
                <p className="mb-1.5 text-[12px] font-medium text-muted">{t("timeline.identities")}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {identities.map((i) => (
                    <li key={`${i.kind}:${i.value}`} className="rounded-full border border-line bg-elevated px-2 py-0.5 text-[12px]">
                      {t(`timeline.identityKinds.${i.kind}`)} · <bdi dir="ltr">{i.kind === "web" ? i.value.slice(0, 8) : i.value}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </dl>
        </Card>

        <div className="space-y-4">
        <Card>
          <CardHeader title={t("insights.title")} description={t("insights.subtitle")} />
          <InsightsCard contactId={contact.id} data={insights} canAnalyze={ctx.can("ai.use")} aiLocked={!aiInsights} />
        </Card>
        {duplicates.length > 0 ? (
          <Card className="border-gold/40">
            <CardHeader title={t("merge.title", { count: duplicates.length })} description={t("merge.hint")} />
            <DuplicatesList contactId={contact.id} rows={duplicates} />
          </Card>
        ) : null}
        {ctx.can("deals.read") ? (
          <Card>
            <CardHeader
              title={t("deals.pageTitle")}
              action={ctx.can("deals.write") ? <NewDealButton pickers={dealPickers} defaults={{ contact_id: contact.id, company_id: contact.company_id, currency: ctx.org.currency || "ILS" }} variant="secondary" /> : null}
            />
            {contactDeals.length === 0 ? (
              <p className="p-5 text-center text-sm text-subtle">{t("deals.none")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {contactDeals.map((d) => (
                  <li key={d.id}>
                    <EditDealDialog
                      deal={d}
                      pickers={dealPickers}
                      canWrite={ctx.can("deals.write")}
                      canDelete={ctx.can("deals.delete")}
                      trigger={
                        <button type="button" className="flex w-full items-center gap-3 px-5 py-3 text-start text-sm hover:bg-surface-hover">
                          <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                          <span className="text-[12px] text-muted">{t(`deals.statuses.${d.status}`)}</span>
                          <bdi dir="ltr" className="font-semibold">{formatCurrency(locale, d.value, d.currency)}</bdi>
                        </button>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
        {ctx.can("tasks.read") ? (
          <Card>
            <CardHeader
              title={t("tasks.title")}
              action={ctx.can("tasks.write") ? <NewTaskButton members={memberOpts} contacts={contactOpts} defaults={{ contact_id: contact.id }} variant="secondary" size="sm" /> : null}
            />
            {contactTasks.length === 0 ? (
              <p className="p-5 text-center text-sm text-subtle">{t("tasks.none")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {contactTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <TaskCheckbox id={task.id} done={task.status === "done"} label={task.title} disabled={!ctx.can("tasks.write") || task.status === "canceled"} />
                    <span className={`min-w-0 flex-1 truncate ${task.status === "done" ? "text-subtle line-through" : ""}`}>{task.title}</span>
                    {task.due_at ? <span className="text-[12px] text-muted">{formatDateTime(locale, task.due_at)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
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
        <Card id="unified">
          <CardHeader title={t("timeline.title")} description={t("timeline.subtitle")} />
          {/* notes already have their own card above (same note never shown twice) */}
          <UnifiedTimeline locale={locale} items={timeline.filter((x) => x.kind !== "note")} contactId={contact.id} more={moreBefore} />
        </Card>
        </div>
      </div>
    </>
  );
}
