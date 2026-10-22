import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NewTicketForm } from "@/components/public/support-portal";
import { createAnonClient } from "@/lib/supabase/anon";
import Link from "next/link";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { ChatWidget } from "@/components/chat/chat-widget";

type Params = Promise<{ locale: string; org: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("support.portalTitle"), robots: { index: false } };
}

export default async function HelpPage({ params, searchParams }: { params: Params; searchParams?: Promise<{ q?: string }> }) {
  const locale = await resolveLocale(params);
  const { org } = await params;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(org)) notFound();
  // Organization name for the header (public, non-sensitive); unknown slugs 404.
  const { data } = await createAnonClient().rpc("public_org_name", { p_slug: org });
  if (!data) notFound();
  // wave 16: help-center articles (search) above the ticket form
  const q = String((await searchParams)?.q ?? "").slice(0, 120);
  const { data: kb } = await createAnonClient().rpc("get_public_kb", { p_org_slug: org, p_query: q || null });
  const { t } = await getT(locale);
  const articles = (Array.isArray(kb) ? kb : []) as { id: string; title: string; category: string | null; excerpt: string }[];
  return (
    <>
      {articles.length || q ? (
        <section className="mb-6 rounded-3xl border border-line bg-surface p-5" data-testid="public-kb">
          <h1 className="text-lg font-bold">{t("kb.publicTitle", { org: data as string })}</h1>
          <form method="get" className="mt-3" role="search">
            <input name="q" defaultValue={q} placeholder={t("kb.searchPlaceholder")} aria-label={t("common.search")} className="h-11 w-full rounded-xl border border-line bg-elevated px-3.5 text-[15px] focus:border-accent focus:outline-none" />
          </form>
          {articles.length ? (
            <ul className="mt-3 divide-y divide-line">
              {articles.map((a) => (
                <li key={a.id}>
                  <Link href={`/${locale}/help/${org}/a/${a.id}`} className="block py-2.5 hover:text-accent">
                    <span className="block font-medium">{a.title}</span>
                    <span className="line-clamp-2 block text-[12.5px] text-muted">{a.excerpt}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-subtle">{t("kb.noResults")}</p>
          )}
        </section>
      ) : null}
      <NewTicketForm org={org} orgName={data as string} />
      <ChatWidget orgSlug={org} />
    </>
  );
}
