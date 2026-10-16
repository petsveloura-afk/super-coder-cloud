import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticate, dbApiError, readJson } from "@/lib/public-api";

export const dynamic = "force-dynamic";

const taskBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  due_at: z.iso.datetime({ offset: true }).optional(),
  contact_id: z.uuid().optional(),
  deal_id: z.uuid().optional(),
  assignee_email: z.email().optional(),
});

/** POST /api/public/v1/tasks — create a follow-up task (optionally assigned by member e-mail). */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request, "tasks.write");
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const parsed = taskBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, { status: 422 });
  const t = parsed.data;
  let assignee: string | null = null;
  if (t.assignee_email) {
    const { data: prof } = await auth.admin.from("profiles").select("id").eq("email", t.assignee_email.toLowerCase()).maybeSingle();
    if (prof) {
      const { data: m } = await auth.admin.from("organization_members").select("user_id").eq("organization_id", auth.orgId).eq("user_id", prof.id).maybeSingle();
      assignee = (m?.user_id as string | undefined) ?? null;
    }
  }
  const { data, error } = await auth.admin
    .from("tasks")
    .insert({
      organization_id: auth.orgId,
      title: t.title,
      description: t.description ?? null,
      due_at: t.due_at ?? null,
      contact_id: t.contact_id ?? null,
      deal_id: t.deal_id ?? null,
      assignee_id: assignee,
    })
    .select("id, title, description, status, due_at, contact_id, deal_id, assignee_id, created_at")
    .single();
  if (error) return dbApiError(error);
  return NextResponse.json({ data }, { status: 201 });
}
