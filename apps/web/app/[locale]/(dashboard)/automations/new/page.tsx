import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AUTOMATION_RECIPES } from "@scc/shared/automations";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AutomationBuilder, type BuilderValue } from "@/components/automations/builder";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { builderOptions } from "@/lib/automation-options";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("automations.new") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function NewAutomationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("automations.manage")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const sp = await searchParams;
  const recipe = AUTOMATION_RECIPES.find((r) => r.key === sp.recipe);
  const initial: BuilderValue = recipe
    ? {
        name: t(`automations.recipes.${recipe.key}.name`),
        description: t(`automations.recipes.${recipe.key}.body`),
        enabled: true,
        trigger_type: recipe.trigger_type,
        trigger_config: recipe.trigger_config ?? {},
        conditions: (recipe.conditions ?? []).map((c) => ({ field: c.field, op: c.op, value: c.value ?? "" })),
        actions: recipe.actions.map((a) => ({ type: a.type, config: { ...a.config } })),
      }
    : { name: "", description: "", enabled: true, trigger_type: "contact.created", trigger_config: {}, conditions: [], actions: [{ type: "create_task", config: { title: "", due_in_days: 1, assignee: "owner" } }] };
  const options = await builderOptions(ctx.org.id);
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  return (
    <>
      <Link href={`/${locale}/automations`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("automations.title")}
      </Link>
      <PageHeader title={t("automations.new")} description={t("automations.builderHint")} />
      <AutomationBuilder initial={initial} options={options} />
    </>
  );
}
