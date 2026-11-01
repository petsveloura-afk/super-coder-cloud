import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { surveyMessage, type SurveyKind } from "./surveys-core";

/** Sends due surveys (created by the "conversation closed" trigger) on the customer's own channel. */
export async function sendDueSurveys(budgetMs = 8_000): Promise<{ sent: number; failed: number }> {
  const started = Date.now();
  const admin = createAdminClient();
  const { data } = await admin
    .from("survey_responses")
    .select("id, organization_id, contact_id, kind, token")
    .eq("status", "pending")
    .lte("send_after", new Date().toISOString())
    .order("send_after")
    .limit(15);
  const rows = (data ?? []) as { id: string; organization_id: string; contact_id: string | null; kind: SurveyKind; token: string }[];
  const orgs = new Map<string, { name: string; locale: string; question: string | null } | null>();
  let sent = 0;
  let failed = 0;
  const { messageContact } = await import("@/lib/agents/run");
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break;
    if (!r.contact_id) {
      await admin.from("survey_responses").update({ status: "failed" }).eq("id", r.id);
      continue;
    }
    if (!orgs.has(r.organization_id)) {
      const [{ data: o }, { data: s }] = await Promise.all([
        admin.from("organizations").select("name, locale").eq("id", r.organization_id).maybeSingle(),
        admin.from("survey_settings").select("question, enabled").eq("organization_id", r.organization_id).maybeSingle(),
      ]);
      orgs.set(r.organization_id, o && s?.enabled ? { name: String(o.name ?? ""), locale: String(o.locale ?? "he"), question: (s.question as string | null) ?? null } : null);
    }
    const org = orgs.get(r.organization_id);
    if (!org) {
      await admin.from("survey_responses").update({ status: "expired" }).eq("id", r.id);
      continue;
    }
    const link = `${publicEnv.appUrl.replace(/\/$/, "")}/${org.locale === "en" || org.locale === "ar" ? org.locale : "he"}/r/${r.token}`;
    const ok = await messageContact(r.organization_id, r.contact_id, surveyMessage({ kind: r.kind, locale: org.locale, orgName: org.name, link, custom: org.question }), "automation", { survey: true }).catch(() => false);
    await admin.from("survey_responses").update(ok ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed" }).eq("id", r.id);
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
