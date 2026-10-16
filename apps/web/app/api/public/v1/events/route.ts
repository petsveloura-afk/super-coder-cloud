import { NextResponse, type NextRequest } from "next/server";
import { authenticate, dbApiError } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/events?after_id=&type=&limit= — event feed for polling
 * triggers (Zapier/Make "new contact", "deal won"…). Ordered by id ascending;
 * pass the last id you processed as after_id.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request, "events.read");
  if (auth instanceof NextResponse) return auth;
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
  const afterId = Math.max(0, Number(sp.get("after_id")) || 0);
  let q = auth.admin
    .from("events")
    .select("id, type, entity_type, entity_id, payload, created_at")
    .eq("organization_id", auth.orgId)
    .gt("id", afterId)
    .order("id", { ascending: afterId > 0 })
    .limit(limit);
  const type = sp.get("type");
  if (type && /^[a-z_.]{3,60}$/.test(type)) q = q.eq("type", type);
  const { data, error } = await q;
  if (error) return dbApiError(error);
  const rows = (data ?? []).map((e) => ({ ...e, data: (e.payload as Record<string, unknown>) ?? {}, payload: undefined }));
  return NextResponse.json({ data: rows, last_id: rows.length ? Math.max(...rows.map((r) => Number(r.id))) : afterId });
}
