import { NextResponse, type NextRequest } from "next/server";
import { authenticate } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/public/v1/me — verifies a key (Zapier/Make "test connection"); works with any scope. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request, null);
  if (auth instanceof NextResponse) return auth;
  const { data } = await auth.admin.from("organizations").select("id, name, slug").eq("id", auth.orgId).maybeSingle();
  return NextResponse.json({ organization: data, scopes: auth.scopes }, { headers: { "Cache-Control": "no-store" } });
}
