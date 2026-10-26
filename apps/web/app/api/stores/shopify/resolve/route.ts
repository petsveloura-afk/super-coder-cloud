import { NextResponse, type NextRequest } from "next/server";
import { resolveShop } from "@/lib/stores/resolve";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * GET /api/stores/shopify/resolve?shop=<anything the person typed>
 * Wave 26 — live "do we recognise this store?" check for the Shopify field. Signed-in users only
 * (it makes outbound requests), never returns anything secret, never blocks the connect flow.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const input = (request.nextUrl.searchParams.get("shop") ?? "").slice(0, 300);
  const r = await resolveShop(input);
  return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
