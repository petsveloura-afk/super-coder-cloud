import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { roleHasPermission, isOrgRole } from "@scc/shared/permissions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Spec I4 — GET /api/v1/contacts/{id}/privacy : everything the business holds about one person (data subject
 * access request), as a JSON download. Session-authenticated, requires contacts.export, written to the audit log.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: contact } = await supabase.from("contacts").select("id, organization_id, first_name, last_name, email, phone, company_name, job_title, status, source, marketing_consent, tags, created_at, updated_at").eq("id", id).maybeSingle();
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const org = contact.organization_id as string;
  const { data: membership } = await supabase.from("organization_members").select("role").eq("organization_id", org).eq("user_id", auth.user.id).maybeSingle();
  if (!isOrgRole(membership?.role) || !roleHasPermission(membership!.role as never, "contacts.export")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const safe = <T,>(p: PromiseLike<{ data: T | null }>) => Promise.resolve(p).then((r) => r.data ?? []).catch(() => []);
  const [conversations, deals, tasks, notes, appointments, surveys] = await Promise.all([
    safe(supabase.from("conversations").select("id, channel, title, status, created_at").eq("organization_id", org).eq("contact_id", id).limit(200)),
    safe(supabase.from("deals").select("id, title, value, currency, status, created_at").eq("organization_id", org).eq("contact_id", id).limit(200)),
    safe(supabase.from("tasks").select("id, title, status, due_at, created_at").eq("organization_id", org).eq("contact_id", id).limit(500)),
    safe(supabase.from("notes").select("id, body, created_at").eq("organization_id", org).eq("contact_id", id).limit(500)),
    safe(supabase.from("appointments").select("id, title, starts_at, status").eq("organization_id", org).eq("contact_id", id).limit(200)),
    safe(supabase.from("survey_responses").select("kind, score, comment, answered_at").eq("organization_id", org).eq("contact_id", id).limit(100)),
  ]);
  const convIds = (conversations as { id: string }[]).map((c) => c.id);
  const messages = convIds.length ? await safe(supabase.from("messages").select("conversation_id, direction, body, created_at").eq("organization_id", org).in("conversation_id", convIds).order("created_at").limit(5000)) : [];
  await supabase.rpc("log_event", { p_org: org, p_action: "contacts.privacy_export", p_entity_type: "contact", p_entity_id: id, p_metadata: {} }).then(() => undefined, () => undefined);
  const body = JSON.stringify({ exported_at: new Date().toISOString(), contact, conversations, messages, deals, tasks, notes, appointments, surveys }, null, 2);
  return new NextResponse(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="contact-${id}.json"`, "Cache-Control": "no-store" } });
}
