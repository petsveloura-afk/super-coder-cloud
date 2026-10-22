import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Download, Mail, Phone, Users } from "lucide-react";
import { CONTACT_STATUSES, listQuerySchema } from "@scc/shared/validators";
import type { ContactRow } from "@scc/database";
import { Card, EmptyState, Ltr, PageHeader } from "@/components/ui/primitives";
import { ContactDialog } from "@/components/crm/contact-form";
import { StatusBadge } from "@/components/crm/status-badge";
import { ImportContactsDialog } from "@/components/crm/import-dialog";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { contactSearchFilter, sanitizeSearch } from "@/lib/search";
import { formatDate, formatNumber, formatPhone } from "@/lib/format";
import { cn, initials } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("crm.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ContactsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const sp = await searchParams;
  const query = listQuerySchema.parse({
    q: typeof sp.q === "string" ? sp.q : undefined,
    status: typeof sp.status === "string" && (CONTACT_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined,
    page: typeof sp.page === "string" ? sp.page : undefined,
  });

  const supabase = await createClient();
  const from = (query.page - 1) * query.pageSize;
  let req = supabase
    .from("contacts")
    .select("id, first_name, last_name, email, phone, company_name, status, source, created_at, is_demo", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .range(from, from + query.pageSize - 1);
  if (query.status) req = req.eq("status", query.status);
  const filter = contactSearchFilter(query.q);
  if (filter) req = req.or(filter);
  const { data, count, error } = await req;
  if (error) throw new Error("contacts query failed");

  const rows = (data ?? []) as Pick<ContactRow, "id" | "first_name" | "last_name" | "email" | "phone" | "company_name" | "status" | "source" | "created_at" | "is_demo">[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const q = sanitizeSearch(query.q);

  const href = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: q || undefined, status: query.status, page: query.page, ...over };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return `/${locale}/crm${s ? `?${s}` : ""}`;
  };

  const canWrite = ctx.can("contacts.write");
  const Prev = locale === "en" ? ChevronLeft : ChevronRight;
  const Next = locale === "en" ? ChevronRight : ChevronLeft;

  return (
    <>
      <PageHeader
        title={t("crm.title")}
        description={t("crm.subtitle")}
        actions={
          <>
            {ctx.can("contacts.export") && total > 0 ? (
              <a
                href={`/api/v1/contacts/export?org=${ctx.org.id}`}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover"
              >
                <Download className="h-4 w-4" /> {t("crm.exportCsv")}
              </a>
            ) : null}
            {canWrite ? <ImportContactsDialog /> : null}
            {canWrite ? <ContactDialog defaultOpen={sp.new === "1"} /> : null}
          </>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-3">
        <form method="get" className="flex flex-col gap-2 sm:flex-row" role="search">
          <input
            name="q"
            defaultValue={q}
            placeholder={t("common.searchPlaceholder")}
            aria-label={t("common.search")}
            className="h-10 flex-1 rounded-xl border border-line bg-elevated px-3.5 text-[14px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={t("crm.status")}>
            {[undefined, ...CONTACT_STATUSES].map((s) => (
              <Link
                key={s ?? "all"}
                href={href({ status: s, page: 1 })}
                role="tab"
                aria-selected={query.status === s}
                className={cn(
                  "flex h-10 shrink-0 items-center rounded-xl px-3.5 text-[13px] transition-colors",
                  query.status === s ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-fg",
                )}
              >
                {s ? t(`crm.statuses.${s}`) : t("common.all")}
              </Link>
            ))}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={q || query.status ? t("common.noResults") : t("crm.empty")}
            body={q || query.status ? undefined : t("crm.emptyBody")}
            action={!q && !query.status && canWrite ? <ContactDialog /> : undefined}
          />
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-line bg-elevated/60 text-[12px] uppercase tracking-wide text-subtle">
                <tr>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("settings.name")}</th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("crm.email")} / {t("crm.phone")}</th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("crm.company")}</th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("crm.status")}</th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("crm.createdAt")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-surface-hover">
                    <td className="px-5 py-3">
                      <Link href={`/${locale}/crm/${c.id}`} className="flex items-center gap-3 font-medium text-fg hover:text-accent">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">
                          {initials(`${c.first_name} ${c.last_name}`)}
                        </span>
                        <span className="truncate">{c.first_name} {c.last_name}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {c.email ? <Ltr className="block truncate">{c.email}</Ltr> : null}
                      {c.phone ? <Ltr className="block text-[12px] text-subtle">{formatPhone(c.phone)}</Ltr> : null}
                    </td>
                    <td className="px-5 py-3 text-muted">{c.company_name ?? "—"}</td>
                    <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-5 py-3 text-muted">{formatDate(locale, c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/${locale}/crm/${c.id}`} className="block">
                  <Card className="flex items-center gap-3 p-4 active:bg-surface-hover">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-[14px] font-bold text-accent">
                      {initials(`${c.first_name} ${c.last_name}`)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{c.first_name} {c.last_name}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[12.5px] text-muted">
                        {c.phone ? (
                          <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /><Ltr>{formatPhone(c.phone)}</Ltr></span>
                        ) : c.email ? (
                          <span className="flex min-w-0 items-center gap-1"><Mail className="h-3.5 w-3.5 shrink-0" /><Ltr className="truncate">{c.email}</Ltr></span>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          <nav className="mt-4 flex items-center justify-between text-sm text-muted" aria-label="pagination">
            <span>{t("crm.total", { count: formatNumber(locale, total) })}</span>
            <div className="flex items-center gap-2">
              {query.page > 1 ? (
                <Link href={href({ page: query.page - 1 })} className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-surface-hover" aria-label={t("common.previous")}>
                  <Prev className="h-4 w-4" />
                </Link>
              ) : null}
              <span>{t("common.pageOf", { page: query.page, pages })}</span>
              {query.page < pages ? (
                <Link href={href({ page: query.page + 1 })} className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-surface-hover" aria-label={t("common.next")}>
                  <Next className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
