import "server-only";
import { companyOptions, contactOptions } from "@/lib/lookups";
import { createClient } from "@/lib/supabase/server";

/** Pickers + defaults for the quote/invoice editor (all through RLS). */
export async function financeEditorData(orgId: string) {
  const supabase = await createClient();
  const [contacts, companies, { data: deals }, { data: products }, { data: settings }] = await Promise.all([
    contactOptions(orgId),
    companyOptions(orgId),
    supabase.from("deals").select("id, title").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300),
    supabase.from("products").select("id, name, description, unit_price, tax_rate").eq("organization_id", orgId).eq("active", true).order("name").limit(500),
    supabase.from("finance_settings").select("default_tax_rate, quote_valid_days, payment_terms_days, default_notes").eq("organization_id", orgId).maybeSingle(),
  ]);
  return {
    contacts: contacts.map((c) => ({ id: c.id, label: c.sub ? `${c.label} · ${c.sub}` : c.label })),
    companies: companies.map((c) => ({ id: c.id, label: c.label })),
    deals: (deals ?? []).map((d) => ({ id: d.id as string, label: d.title as string })),
    products: (products ?? []).map((p) => ({ id: p.id as string, name: p.name as string, description: p.description as string | null, unit_price: Number(p.unit_price), tax_rate: p.tax_rate == null ? null : Number(p.tax_rate) })),
    defaultTax: settings?.default_tax_rate == null ? 18 : Number(settings.default_tax_rate),
    quoteValidDays: (settings?.quote_valid_days as number | undefined) ?? 14,
    paymentTermsDays: (settings?.payment_terms_days as number | undefined) ?? 30,
    defaultNotes: (settings?.default_notes as string | null) ?? "",
  };
}

export function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
