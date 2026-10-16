import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Lock, User } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { TicketControls, TicketReply } from "@/components/support/support-client";
import { ShareBox } from "@/components/forms/share-box";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { memberOptions } from "@/lib/lookups";
import { publicEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("support.title") };
}

export default async function TicketPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id: rawId } = await params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("tickets.read")) notFound();
  const supabase = await createClient();
  const { data: tk } = await supabase
    .from("tickets")
    .select("id, number, subject, status, priority, assignee_id, contact_id, public_token, sla_due_at, first_response_at, resolved_at, channel, created_at, contacts(first_name, last_name, email, phone)")
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!tk) notFound();
  const [{ data: msgs }, members] = await Promise.all([
    supabase.from("ticket_messages").select("id, author_type, author_id, body, internal, created_at").eq("organization_id", ctx.org.id).eq("ticket_id", tk.id).order("created_at"),
    memberOptions(ctx.org.id),
  ]);
  const memberName = new Map(members.map((m) => [m.id, m.label]));
  const contact = tk.contacts as unknown as { first_name: string; last_name: string; email: string | null; phone: string | null } | null;
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const portal = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/t/${tk.public_token}`;

  return (
    <>
      <Link href={`/${locale}/support`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("support.title")}
      </Link>
      <PageHeader title={`#${tk.number} · ${tk.subject}`} description={`${t(`support.channels.${tk.channel}`)} · ${formatDateTime(locale, tk.created_at as string)}`} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="flex flex-col overflow-hidden">
          <ol className="flex-1 space-y-3 p-4">
            {(msgs ?? []).map((m) => (
              <li key={m.id} className={cn("rounded-2xl border p-3.5", m.internal ? "border-gold/40 bg-gold-soft" : m.author_type === "customer" ? "border-line bg-elevated" : "border-accent/30 bg-accent-soft/40")}>
                <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
                  {m.internal ? <Lock className="h-3.5 w-3.5" /> : null}
                  <span className="font-semibold">{m.author_type === "customer" ? (contact ? `${contact.first_name} ${contact.last_name}`.trim() : t("support.customer")) : m.author_type === "agent" ? memberName.get(m.author_id as string) ?? t("support.agent") : t("support.system")}</span>
                  <span>·</span>
                  <span>{formatDateTime(locale, m.created_at as string)}</span>
                  {m.internal ? <span className="font-semibold text-gold">{t("support.internal")}</span> : null}
                </div>
                <p className="whitespace-pre-wrap text-sm" dir="auto">
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
          {ctx.can("tickets.write") ? <TicketReply ticketId={tk.id as string} status={tk.status as string} /> : null}
        </Card>
        <div className="space-y-4">
          {ctx.can("tickets.write") ? (
            <Card className="p-4">
              <TicketControls ticketId={tk.id as string} status={tk.status as string} priority={tk.priority as string} assigneeId={tk.assignee_id as string | null} members={members} />
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("support.customer")} />
            <div className="space-y-1 p-4 text-sm">
              {contact ? (
                <>
                  <Link href={`/${locale}/crm/${tk.contact_id}`} className="flex items-center gap-1.5 font-medium hover:text-accent">
                    <User className="h-4 w-4" /> {contact.first_name} {contact.last_name}
                  </Link>
                  {contact.email ? <div className="text-muted" dir="ltr">{contact.email}</div> : null}
                  {contact.phone ? <div className="text-muted" dir="ltr">{contact.phone}</div> : null}
                </>
              ) : (
                <span className="text-subtle">—</span>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={t("support.sla")} />
            <dl className="space-y-1.5 p-4 text-[13px]">
              <div className="flex justify-between gap-2"><dt className="text-muted">{t("support.slaDue")}</dt><dd>{tk.sla_due_at ? formatDateTime(locale, tk.sla_due_at as string) : "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">{t("support.firstResponse")}</dt><dd>{tk.first_response_at ? formatDateTime(locale, tk.first_response_at as string) : "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">{t("support.resolvedAt")}</dt><dd>{tk.resolved_at ? formatDateTime(locale, tk.resolved_at as string) : "—"}</dd></div>
            </dl>
          </Card>
          <Card className="p-4">
            <p className="mb-2 text-[12.5px] text-muted">{t("support.customerLink")}</p>
            <ShareBox url={portal} />
          </Card>
        </div>
      </div>
    </>
  );
}
