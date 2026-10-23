import { NextResponse, type NextRequest } from "next/server";
import { uuidSchema } from "@scc/shared/validators";
import { apiError, authenticate, dbApiError } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** DELETE /api/public/v1/hooks/{id} — unsubscribe a REST hook (wave 19). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request, "webhooks.manage");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return apiError(404, "not_found");
  const { data, error } = await auth.admin.from("webhooks").delete().eq("organization_id", auth.orgId).eq("id", id).select("id");
  if (error) return dbApiError(error);
  if (!data?.length) return apiError(404, "not_found");
  return new NextResponse(null, { status: 204 });
}
