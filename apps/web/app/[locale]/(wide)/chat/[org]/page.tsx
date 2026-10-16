import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatWidget } from "@/components/chat/chat-widget";
import { getT, resolveLocale } from "@/lib/i18n/server";

type Params = Promise<{ locale: string; org: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("chat.title"), robots: { index: false } };
}

/** Embeddable full-page chat (iframe) — used by /widget.js on any external website. */
export default async function EmbeddedChatPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | undefined>> }) {
  const { org } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(org)) notFound();
  const sp = await searchParams;
  const color = /^[0-9a-f]{6}$/i.test(sp.color ?? "") ? `#${sp.color}` : undefined;
  return <ChatWidget orgSlug={org} accent={color} embedded defaultOpen />;
}
