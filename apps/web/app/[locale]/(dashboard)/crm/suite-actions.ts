"use server";

import { revalidatePath } from "next/cache";
import { IMPORT_COLUMNS, tagNamesSchema, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { kickJobs } from "@/lib/jobs/kick";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, str } from "@/lib/form";

export interface ImportResult {
  inserted: number;
  skipped: number;
  invalid: number;
  errors: { row: number; reason: "invalid" | "duplicate" }[];
}

/**
 * Imports a chunk of already-parsed CSV records (max 1,000 per call).
 * Only known columns are forwarded; the database validates every row again.
 */
export async function importContactsAction(input: { locale: string; rows: Record<string, unknown>[]; offset?: number }): Promise<ActionState<ImportResult>> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden" };
  if (!Array.isArray(input.rows) || input.rows.length === 0) return { error: "import.empty" };
  if (input.rows.length > 1000) return { error: "import.tooLarge" };
  const allowed = new Set<string>(IMPORT_COLUMNS);
  const rows = input.rows.map((r) => {
    const out: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      if (!allowed.has(k)) continue;
      if (k === "marketing_consent") out[k] = v === true;
      else if (typeof v === "string") out[k] = v.slice(0, 300);
    }
    return out;
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_contacts", { p_org: ctx.org.id, p_rows: rows });
  if (error) return { error: dbErrorKey(error) };
  const res = data as ImportResult;
  const offset = input.offset ?? 0;
  res.errors = (res.errors ?? []).map((e) => ({ ...e, row: e.row + offset }));
  revalidatePath(`/${locale}/crm`);
  revalidatePath(`/${locale}/overview`);
  kickJobs();
  return { ok: true, data: res };
}

export async function setContactTagsAction(input: { locale: string; contactId: string; names: string[] }): Promise<ActionState> {
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.contactId);
  const names = tagNamesSchema.safeParse(input.names);
  if (!id.success) return { error: "validation.invalidId" };
  if (!names.success) return { error: "tags.invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_contact_tags", { p_org: ctx.org.id, p_contact: id.data, p_names: names.data });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/crm/${id.data}`);
  revalidatePath(`/${locale}/crm`);
  kickJobs();
  return { ok: true, message: "tags.saved" };
}

export async function mergeContactsAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.write") || !ctx.can("contacts.delete")) return { error: "errors.forbidden" };
  const keep = uuidSchema.safeParse(str(fd, "keepId"));
  const merge = uuidSchema.safeParse(str(fd, "mergeId"));
  if (!keep.success || !merge.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_contacts", { p_org: ctx.org.id, p_keep: keep.data, p_merge: merge.data });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/crm`);
  revalidatePath(`/${locale}/crm/${keep.data}`);
  kickJobs();
  return { ok: true, message: "merge.done" };
}
