import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, MessagesSquare } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { PageHeader } from "@/components/ui/primitives";
import { AgentSetup, type SetupAgent } from "@/components/ai/agent-setup";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("ai.setup.title") };
}

/** Full conversation setup of one agent: script, details to collect, pricing, links, menu, gallery. */
export default async function AgentSetupPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) redirect(`/${locale}/ai-agents`);
  if (!uuidSchema.safeParse(id).success) notFound();
  const { t } = await getT(locale);
  const supabase = await createClient();
  const { data: agent } = await supabase.from("ai_agents").select("id, name, lead_goal, profile").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!agent) notFound();
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  return (
    <>
      <Link href={`/${locale}/ai-agents`} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("ai.title")}
      </Link>
      <PageHeader
        title={t("ai.setup.titleFor", { name: agent.name as string })}
        description={t("ai.setup.subtitle")}
        actions={
          <Link href={`/${locale}/ai-agents`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
            <MessagesSquare className="h-4 w-4" /> {t("ai.setup.test")}
          </Link>
        }
      />
      <AgentSetup agent={agent as SetupAgent} />
    </>
  );
}
