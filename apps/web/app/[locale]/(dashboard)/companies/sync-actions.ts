"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";
import { suggestCompanies, type CompanySuggestion } from "@/lib/crm/companies-core";

/**
 * Round 12 — companies found in the contacts (smart sync). Contacts with a company name or a business e-mail domain that
 * are not linked to a company become companies (or are linked to the company that already exists). Runs with the person's
 * own session (row-level security applies); needs companies.write + contacts.write. Never touches contacts that already
 * have a company. At most 100 new companies per run.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

async function load(orgId: string) {
  const supabase = await createClient();
  const [{ data: contacts }, { data: companies }] = await Promise.all([
    supabase.from("contacts").select("id, company_name, email").eq("organization_id", orgId).is("company_id", null).eq("is_demo", false).limit(5000),
    supabase.from("companies").select("id, name, domain").eq("organization_id", orgId).limit(5000),
  ]);
  return { supabase, plan: suggestCompanies((contacts ?? []) as { id: string; company_name: string | null; email: string | null }[], (companies ?? []) as { id: string; name: string; domain: string | null }[]) };
}

export async function previewCompanySyncAction(input: { locale: string }): Promise<ActionState<{ create: CompanySuggestion[]; link: number }>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("companies.write") || !ctx.can("contacts.write")) return { error: "errors.forbidden" };
  const { plan } = await load(ctx.org.id);
  return { ok: true, data: { create: plan.create.slice(0, 100), link: plan.link.reduce((n, l) => n + l.contactIds.length, 0) } };
}

export async function runCompanySyncAction(input: { locale: string }): Promise<ActionState<{ created: number; linked: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("companies.write") || !ctx.can("contacts.write")) return { error: "errors.forbidden" };
  const { supabase, plan } = await load(ctx.org.id);
  let created = 0;
  let linked = 0;
  // 1) contacts of companies that already exist
  for (const l of plan.link) {
    for (let i = 0; i < l.contactIds.length; i += 200) {
      const { data } = await supabase.from("contacts").update({ company_id: l.companyId }).eq("organization_id", ctx.org.id).is("company_id", null).in("id", l.contactIds.slice(i, i + 200)).select("id");
      linked += (data ?? []).length;
    }
  }
  // 2) new companies, then their contacts
  for (const s of plan.create.slice(0, 100)) {
    const { data: co, error } = await supabase
      .from("companies")
      .insert({ organization_id: ctx.org.id, name: s.name.slice(0, 160), domain: s.domain, owner_id: ctx.userId, created_by: ctx.userId, custom_properties: { source: "contacts_sync" } })
      .select("id")
      .single();
    if (error || !co) continue;
    created++;
    const { data } = await supabase.from("contacts").update({ company_id: co.id }).eq("organization_id", ctx.org.id).is("company_id", null).in("id", s.contactIds.slice(0, 500)).select("id");
    linked += (data ?? []).length;
  }
  revalidatePath(`/${locale}/companies`);
  return { ok: true, message: "companies.sync.done", messageParams: { created, linked }, data: { created, linked } };
}
