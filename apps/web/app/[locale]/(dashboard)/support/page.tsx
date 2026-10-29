import Link from "next/link";
import type { Metadata } from "next";
import { AlarmClock, BookOpen, LifeBuoy } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { NewTicketButton } from "@/components/support/support-client";
import { ShareBox } from "@/components/forms/share-box";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { contactOptions, memberOptions } from "@/lib/lookups";
import { publicEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { ScreenPulse } from "@/components/ui/screen-pulse";
import { supportPulse } from "@/lib/insights/screens-core";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("support.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const FILTERS = ["active", "mine", "unassigned", "pending", "resolved", "all"] as const;
const PRIORITY_TONE: Record<string, "neutral" | "accent" | "warning" | "danger"> = { low: "neutral", normal: "accent", high: "warning", urgent: "danger" };
const STATUS_TONE: Record<string, "accent" | "gold" | "success" | "neutral"> = { open: "accent", pending: "gold", resolved: "success", closed: "neutral" };

export default async function SupportPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("tickets.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(String(sp.f)) ? (sp.f as (typeof FILTERS)[number]) : "active";
  const supabase = await createClient();
  let q = supabase
    .from("tickets")
    .select("id, number, subject, status, priority, assignee_id, contact_id, sla_due_at, first_response_at, updated_at, channel")
    .eq("organization_id", ctx.org.id)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (filter === "active") q = q.in("status", ["open", "pending"]);
  if (filter === "mine") q = q.eq("assignee_id", ctx.userId).in("status", ["open", "pending"]);
  if (filter === "unassigned") q = q.is("assignee_id", null).in("status", ["open", "pending"]);
  if (filter === "pending") q = q.eq("status", "pending");
  if (filter === "resolved") q = q.in("status", ["resolved", "closed"]);
  const [{ data }, contacts, members] = await Promise.all([q, contactOptions(ctx.org.id), memberOptions(ctx.org.id)]);
  const rows = data ?? [];
  const contactName = new Map(contacts.map((c) => [c.id, c.label]));
  const memberName = new Map(members.map((m) => [m.id, m.label]));
  const now = new Date().getTime();
  const portalUrl = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/help/${ctx.org.slug}`;
  // wave 53 — smart pulse over all active tickets (independent of the current filter)
  const { data: activeAll } = await supabase.from("tickets").select("status, priority, sla_due_at, first_response_at").eq("organization_id", ctx.org.id).in("status", ["open", "pending"]).limit(2000);
  const supPulse = supportPulse((activeAll ?? []) as { status: string; priority: string; sla_due_at: string | null; first_response_at: string | null }[], new Date(now));

  return (
    <>
      <PageHeader
        title={t("support.title")}
        description={t("support.subtitle")}
        actions={
          <>
            {/* wave 16: knowledge base */}
            <Link href={`/${locale}/support/kb`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-hover" data-testid="kb-link">
              <BookOpen className="h-4 w-4" /> {t("kb.title")}
            </Link>
            {ctx.can("tickets.write") ? <NewTicketButton contacts={contacts} members={members} /> : null}
          </>
        }
      />
      <ScreenPulse screen="support" pulse={supPulse} locale={locale} t={t} />
      <Card className="mb-4 p-4">
        <p className="mb-2 text-[13px] text-muted">{t("support.portalHint")}</p>
        <ShareBox url={portalUrl} height={760} />
      </Card>
      <Card className="mb-4 p-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={t("support.filter")}>
          {FILTERS.map((f) => (
            <Link key={f} href={`/${locale}/support${f === "active" ? "" : `?f=${f}`}`} role="tab" aria-selected={filter === f} className={cn("flex h-9 shrink-0 items-center rounded-xl px-3.5 text-[13px]", filter === f ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg")}>
              {t(`support.filters.${f}`)}
            </Link>
          ))}
        </div>
      </Card>
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title={t("support.empty")} body={t("support.emptyBody")} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((tk) => {
              const breach = ["open"].includes(tk.status as string) && !tk.first_response_at && tk.sla_due_at && Date.parse(tk.sla_due_at as string) < now;
              return (
                <li key={tk.id}>
                  <Link href={`/${locale}/support/${tk.id}`} className="flex flex-col gap-1 px-5 py-3.5 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-3" data-ticket={tk.number}>
                    <span className="w-16 shrink-0 text-[13px] text-subtle" dir="ltr">
                      #{tk.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{tk.subject}</span>
                    <span className="text-[12.5px] text-muted">{tk.contact_id ? contactName.get(tk.contact_id as string) ?? "—" : "—"}</span>
                    <Badge tone={PRIORITY_TONE[tk.priority as string] ?? "neutral"}>{t(`support.priorities.${tk.priority}`)}</Badge>
                    <Badge tone={STATUS_TONE[tk.status as string] ?? "neutral"}>{t(`support.statuses.${tk.status}`)}</Badge>
                    {breach ? (
                      <span className="flex items-center gap-1 text-[12px] font-semibold text-danger">
                        <AlarmClock className="h-3.5 w-3.5" /> {t("support.slaBreached")}
                      </span>
                    ) : null}
                    <span className="text-[12px] text-subtle">{tk.assignee_id ? memberName.get(tk.assignee_id as string) : t("inbox.unassigned")}</span>
                    <span className="text-[12px] text-subtle">{formatDateTime(locale, tk.updated_at as string)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
