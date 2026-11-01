"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState } from "@/lib/action-state";

/**
 * Spec I4 — "right to be forgotten": the person's identifying details and message texts are erased, while the
 * business keeps anonymous statistics (deals / counts stay). Requires contacts.delete; written to the audit log.
 */
export async function eraseContactAction(input: { locale: string; id: string; confirm: string }): Promise<ActionState> {
  const locale = input.locale === "en" || input.locale === "ar" ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("contacts.delete")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  if (input.confirm !== "ERASE") return { error: "privacy.confirmNeeded" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contacts").select("id").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!c) return { error: "errors.notFound" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: convs } = await admin.from("conversations").select("id").eq("organization_id", ctx.org.id).eq("contact_id", input.id).limit(500);
  const convIds = ((convs ?? []) as { id: string }[]).map((x) => x.id);
  if (convIds.length) {
    await admin.from("messages").update({ body: "", media: null }).eq("organization_id", ctx.org.id).in("conversation_id", convIds);
    await admin.from("conversations").update({ title: "—" }).eq("organization_id", ctx.org.id).in("id", convIds);
  }
  await admin.from("notes").delete().eq("organization_id", ctx.org.id).eq("contact_id", input.id).then(() => undefined, () => undefined);
  await admin.from("survey_responses").update({ comment: null }).eq("organization_id", ctx.org.id).eq("contact_id", input.id).then(() => undefined, () => undefined);
  const { error } = await admin
    .from("contacts")
    .update({ first_name: "—", last_name: null, email: null, phone: null, company_name: null, job_title: null, marketing_consent: false, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("organization_id", ctx.org.id);
  if (error) return { error: "errors.generic" };
  await admin.from("audit_logs").insert({ organization_id: ctx.org.id, actor_id: ctx.userId, action: "contacts.erased", entity_type: "contact", entity_id: input.id, metadata: { conversations: convIds.length } });
  revalidatePath(`/${locale}/crm/${input.id}`);
  revalidatePath(`/${locale}/crm`);
  return { ok: true, message: "privacy.erased" };
}
