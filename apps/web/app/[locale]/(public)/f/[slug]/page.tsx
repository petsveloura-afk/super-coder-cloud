import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { FormField } from "@scc/shared/engagement";
import { PublicForm } from "@/components/public/public-form";
import { createAnonClient } from "@/lib/supabase/anon";
import { resolveLocale } from "@/lib/i18n/server";

type Params = Promise<{ locale: string; slug: string }>;

async function load(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return null;
  const { data } = await createAnonClient().rpc("get_public_form", { p_slug: slug });
  return data as { name: string; fields: FormField[]; settings: Record<string, string>; org: string } | null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const f = await load(slug);
  return { title: f ? `${f.settings.title || f.name} · ${f.org}` : "404", robots: { index: false } };
}

export default async function PublicFormPage({ params }: { params: Params }) {
  await resolveLocale(params);
  const { slug } = await params;
  const f = await load(slug);
  if (!f) notFound();
  return <PublicForm slug={slug} fields={f.fields} settings={f.settings} orgName={f.org} formName={f.name} />;
}
