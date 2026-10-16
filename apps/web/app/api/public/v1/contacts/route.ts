import { NextResponse, type NextRequest } from "next/server";
import { authenticate, dbApiError, apiError, pageParams, readJson } from "@/lib/public-api";
import { CONTACT_PUBLIC_FIELDS, parseContactBody } from "@/lib/public-api-contacts";
import { kickJobs } from "@/lib/jobs/kick";

export const dynamic = "force-dynamic";

/** GET /api/public/v1/contacts?limit=&offset=&email=&phone=&updated_since= */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request, "contacts.read");
  if (auth instanceof NextResponse) return auth;
  const { limit, offset } = pageParams(request);
  const sp = request.nextUrl.searchParams;
  let q = auth.admin
    .from("contacts")
    .select(CONTACT_PUBLIC_FIELDS, { count: "exact" })
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const email = sp.get("email");
  const phone = sp.get("phone");
  const since = sp.get("updated_since");
  if (email) q = q.eq("email", email.toLowerCase().trim());
  if (phone) q = q.eq("phone", phone.replace(/[\s\-().]/g, ""));
  if (since && !Number.isNaN(Date.parse(since))) q = q.gte("updated_at", new Date(since).toISOString());
  const { data, count, error } = await q;
  if (error) return dbApiError(error);
  return NextResponse.json({ data, total: count ?? 0, limit, offset }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/public/v1/contacts — create, or update when the e-mail already exists
 * (upsert by e-mail). Returns 201 when created, 200 when updated.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request, "contacts.write");
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const parsed = parseContactBody(body);
  if ("errors" in parsed) return NextResponse.json({ error: { code: "validation_failed", fields: parsed.errors } }, { status: 422 });
  const row = parsed.row!;
  if (row.email) {
    const { data: existing } = await auth.admin.from("contacts").select("id").eq("organization_id", auth.orgId).eq("email", row.email as string).maybeSingle();
    if (existing) {
      const { data, error } = await auth.admin
        .from("contacts")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("organization_id", auth.orgId)
        .select(CONTACT_PUBLIC_FIELDS)
        .single();
      if (error) return dbApiError(error);
      kickJobs();
      return NextResponse.json({ data, created: false });
    }
  }
  const { data, error } = await auth.admin.from("contacts").insert({ ...row, organization_id: auth.orgId }).select(CONTACT_PUBLIC_FIELDS).single();
  if (error) return dbApiError(error);
  if (Array.isArray(body.tags) && body.tags.length) {
    const names = body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 30);
    if (names.length) {
      await auth.admin.from("tags").upsert(names.map((name) => ({ organization_id: auth.orgId, name })), { onConflict: "organization_id,name", ignoreDuplicates: true });
      const { data: tags } = await auth.admin.from("tags").select("id").eq("organization_id", auth.orgId).in("name", names);
      if (tags?.length) await auth.admin.from("contact_tags").insert(tags.map((t) => ({ organization_id: auth.orgId, contact_id: data.id, tag_id: t.id })));
    }
  }
  kickJobs();
  return NextResponse.json({ data, created: true }, { status: 201 });
}

export function OPTIONS() {
  return apiError(405, "method_not_allowed");
}
