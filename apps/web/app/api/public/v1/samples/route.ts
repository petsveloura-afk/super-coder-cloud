import { NextResponse, type NextRequest } from "next/server";
import { authenticate } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/samples?event=contact.created — wave 19: sample deliveries for Zapier / Make
 * field mapping ("perform list"): the last 3 real events of that type, or one example.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request, null);
  if (auth instanceof NextResponse) return auth;
  const event = request.nextUrl.searchParams.get("event") ?? "contact.created";
  if (!/^[a-z_.]{3,60}$/.test(event)) return NextResponse.json({ data: [] });
  const { data } = await auth.admin.from("events").select("id, type, entity_type, entity_id, payload, created_at").eq("organization_id", auth.orgId).eq("type", event).order("id", { ascending: false }).limit(3);
  const rows = (data ?? []).map((e) => ({ id: e.id, type: e.type, entity_type: e.entity_type, entity_id: e.entity_id, data: e.payload ?? {}, created_at: e.created_at }));
  if (rows.length) return NextResponse.json({ data: rows });
  return NextResponse.json({ data: [{ id: 0, type: event, entity_type: "contact", entity_id: "00000000-0000-0000-0000-000000000000", data: { example: true }, created_at: new Date(0).toISOString() }] });
}
