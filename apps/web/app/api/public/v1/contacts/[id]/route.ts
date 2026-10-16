import { NextResponse, type NextRequest } from "next/server";
import { uuidSchema } from "@scc/shared/validators";
import { apiError, authenticate, dbApiError, readJson } from "@/lib/public-api";
import { CONTACT_PUBLIC_FIELDS, mergeContact, parseContactBody } from "@/lib/public-api-contacts";
import { kickJobs } from "@/lib/jobs/kick";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticate(request, "contacts.read");
  if (auth instanceof NextResponse) return auth;
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) return apiError(404, "not_found");
  const { data, error } = await auth.admin.from("contacts").select(CONTACT_PUBLIC_FIELDS).eq("id", id.data).eq("organization_id", auth.orgId).maybeSingle();
  if (error) return dbApiError(error);
  if (!data) return apiError(404, "not_found");
  return NextResponse.json({ data });
}

/** PATCH — partial update; only fields present in the body change. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await authenticate(request, "contacts.write");
  if (auth instanceof NextResponse) return auth;
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) return apiError(404, "not_found");
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const { data: existing } = await auth.admin.from("contacts").select(CONTACT_PUBLIC_FIELDS).eq("id", id.data).eq("organization_id", auth.orgId).maybeSingle();
  if (!existing) return apiError(404, "not_found");
  const parsed = parseContactBody(mergeContact(existing as Record<string, unknown>, body));
  if ("errors" in parsed) return NextResponse.json({ error: { code: "validation_failed", fields: parsed.errors } }, { status: 422 });
  const { data, error } = await auth.admin
    .from("contacts")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("organization_id", auth.orgId)
    .select(CONTACT_PUBLIC_FIELDS)
    .maybeSingle();
  if (error) return dbApiError(error);
  if (!data) return apiError(404, "not_found");
  kickJobs();
  return NextResponse.json({ data });
}
