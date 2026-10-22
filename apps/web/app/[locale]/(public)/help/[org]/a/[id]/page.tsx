import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAnonClient } from "@/lib/supabase/anon";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/format";
import { ChatWidget } from "@/components/chat/chat-widget";
import { HelpfulButton } from "@/components/public/kb-helpful";

type Params = Promise<{ locale: string; org: string; id: string }>;

async function load(org: string, id: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(org) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await createAnonClient().rpc("get_public_kb_article", { p_org_slug: org, p_id: id });
  return (data as { id: string; title: string; body: string; category: string | null; updated_at: string } | null) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, id } = await params;
  const a = await load(org, id);
  return { title: a?.title ?? "Help", robots: { index: false } };
}

/** Wave 16 — one public help-center article. */
export default async function HelpArticlePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { org, id } = await params;
  const { t } = await getT(locale);
  const a = await load(org, id);
  if (!a) notFound();
  return (
    <>
      <article className="rounded-3xl border border-line bg-surface p-6" data-testid="kb-article">
        <Link href={`/${locale}/help/${org}`} className="text-[13px] text-accent hover:underline">
          ← {t("kb.back")}
        </Link>
        {a.category ? <p className="mt-3 text-[12px] text-subtle">{a.category}</p> : null}
        <h1 className="mt-1 text-xl font-bold">{a.title}</h1>
        <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{a.body}</div>
        <p className="mt-6 text-[12px] text-subtle">{t("kb.updated", { date: formatDate(locale, a.updated_at) })}</p>
        <HelpfulButton id={a.id} />
      </article>
      <ChatWidget orgSlug={org} />
    </>
  );
}
