"use server";

import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { baseSystem, dataBlock } from "@/lib/ai/prompt";
import { runAI } from "@/lib/ai/run";
import type { ActionState } from "@/lib/action-state";

function loc(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

const kindSchema = z.enum(["summary", "followup"]);

/** AI assistant on a contact: summary or follow-up draft. Output is never auto-saved. */
export async function aiContactAction(_prev: ActionState<{ text: string }>, fd: FormData): Promise<ActionState<{ text: string }>> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(fd.get("contactId"));
  const kind = kindSchema.safeParse(fd.get("kind"));
  if (!id.success || !kind.success) return { error: "validation.invalidId" };
  if (!ctx.can("ai.use")) return { error: "errors.forbidden" };

  const supabase = await createClient();
  const { data: c } = await supabase
    .from("contacts")
    .select("first_name, last_name, email, phone, company_name, job_title, status, source, marketing_consent, created_at")
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!c) return { error: "errors.notFound" };
  const { data: notes } = await supabase
    .from("notes")
    .select("body, created_at")
    .eq("organization_id", ctx.org.id)
    .eq("contact_id", id.data)
    .order("created_at", { ascending: false })
    .limit(10);

  const data = dataBlock({
    name: `${c.first_name} ${c.last_name ?? ""}`.trim(),
    company: c.company_name,
    job_title: c.job_title,
    status: c.status,
    source: c.source,
    marketing_consent: c.marketing_consent ? "yes" : "no",
    created_at: c.created_at,
    notes: (notes ?? []).map((n) => `- (${n.created_at.slice(0, 10)}) ${n.body}`).join("\n"),
  });

  const task =
    kind.data === "summary"
      ? "Summarise this contact for a salesperson in 3-5 bullet points: who they are, where they are in the funnel, what was discussed, and the single best next step."
      : `Draft a short, warm follow-up message (WhatsApp/email style, max 90 words) to this contact based on the notes. ${
          c.marketing_consent ? "" : "The contact did NOT consent to marketing: keep it strictly service-related, no promotions."
        } Do not invent prices, dates or promises.`;

  const out = await runAI({
    orgId: ctx.org.id,
    feature: kind.data === "summary" ? "contact_summary" : "followup_draft",
    system: baseSystem(locale),
    messages: [{ role: "user", content: `${task}\n\n${data}` }],
    temperature: kind.data === "summary" ? 0.2 : 0.5,
    maxTokens: 500,
  });
  if (!out.ok) return { error: out.error };
  return { ok: true, data: { text: out.text } };
}
