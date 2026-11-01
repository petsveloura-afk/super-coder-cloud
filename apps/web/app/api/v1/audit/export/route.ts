import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { roleHasPermission, isOrgRole } from "@scc/shared/permissions";
import { createClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Spec I5 — GET /api/v1/audit/export?org=<uuid>&days=30&action=<prefix> : the audit log as CSV (audit.read).
 * Formula-injection safe; up to 20,000 rows.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const org = z.uuid().safeParse(sp.get("org"));
  if (!org.success) return NextResponse.json({ error: "invalid_org" }, { status: 400 });
  const days = Math.max(1, Math.min(365, Number(sp.get("days") ?? 30) || 30));
  const action = (sp.get("action") ?? "").replace(/[^a-z_.]/gi, "").slice(0, 40);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: m } = await supabase.from("organization_members").select("role").eq("organization_id", org.data).eq("user_id", auth.user.id).maybeSingle();
  if (!isOrgRole(m?.role) || !roleHasPermission(m!.role as never, "audit.read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const header = ["created_at", "action", "entity_type", "entity_id", "actor_id", "metadata"];
  const lines = [header.join(",")];
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  for (let from = 0; from < 20_000; from += 1000) {
    let q = supabase.from("audit_logs").select(header.join(",")).eq("organization_id", org.data).gte("created_at", since).order("created_at", { ascending: false }).range(from, from + 999);
    if (action) q = q.like("action", `${action}%`);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) lines.push(header.map((h) => csvCell(h === "metadata" ? JSON.stringify(row[h] ?? {}) : row[h])).join(","));
    if (!data || data.length < 1000) break;
  }
  return new NextResponse(`﻿${lines.join("\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-${days}d.csv"`, "Cache-Control": "no-store" } });
}
