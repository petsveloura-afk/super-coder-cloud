import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { roleHasPermission, isOrgRole } from "@scc/shared/permissions";
import { createClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/contacts/export?org=<uuid>
 * Session-authenticated CSV export. Requires contacts.export in that org.
 * Output is protected against CSV formula injection.
 */
export async function GET(request: NextRequest) {
  const org = z.uuid().safeParse(request.nextUrl.searchParams.get("org"));
  if (!org.success) return NextResponse.json({ error: "invalid_org" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.data)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const role = membership?.role;
  if (!isOrgRole(role) || !roleHasPermission(role, "contacts.export")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const header = ["first_name", "last_name", "email", "phone", "company_name", "job_title", "status", "source", "marketing_consent", "created_at"];
  const lines = [header.join(",")];
  const pageSize = 1000;
  for (let from = 0; from < 50_000; from += pageSize) {
    const { data, error } = await supabase
      .from("contacts")
      .select(header.join(","))
      .eq("organization_id", org.data)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) lines.push(header.map((h) => csvCell(row[h])).join(","));
    if (!data || data.length < pageSize) break;
  }

  await supabase.rpc("log_event", {
    p_org: org.data,
    p_action: "contacts.exported",
    p_entity_type: "contacts",
    p_metadata: { rows: lines.length - 1 },
  });
  const body = "\uFEFF" + lines.join("\r\n"); // BOM so Excel renders Hebrew/Arabic correctly
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
