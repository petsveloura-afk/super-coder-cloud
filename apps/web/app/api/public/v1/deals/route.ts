import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CURRENCIES } from "@scc/shared/validators";
import { apiError, authenticate, dbApiError, pageParams, readJson } from "@/lib/public-api";
import { kickJobs } from "@/lib/jobs/kick";

export const dynamic = "force-dynamic";
const FIELDS = "id, title, value, currency, status, pipeline_id, stage_id, contact_id, company_id, expected_close_date, owner_id, closed_at, created_at, updated_at";

/** GET /api/public/v1/deals?status=open|won|lost&limit=&offset= */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request, "deals.read");
  if (auth instanceof NextResponse) return auth;
  const { limit, offset } = pageParams(request);
  const status = request.nextUrl.searchParams.get("status");
  let q = auth.admin.from("deals").select(FIELDS, { count: "exact" }).eq("organization_id", auth.orgId).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (status && ["open", "won", "lost"].includes(status)) q = q.eq("status", status);
  const { data, count, error } = await q;
  if (error) return dbApiError(error);
  return NextResponse.json({ data, total: count ?? 0, limit, offset });
}

const dealBody = z.object({
  title: z.string().trim().min(1).max(160),
  value: z.coerce.number().min(0).max(999_999_999_999).default(0),
  currency: z.enum(CURRENCIES).optional(),
  pipeline_id: z.uuid().optional(),
  stage_id: z.uuid().optional(),
  contact_id: z.uuid().optional(),
  company_id: z.uuid().optional(),
  expected_close_date: z.iso.date().optional(),
});

/** POST /api/public/v1/deals — defaults to the default pipeline's first stage. */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request, "deals.write");
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const parsed = dealBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, { status: 422 });
  const d = parsed.data;
  let pipelineId = d.pipeline_id;
  let stageId = d.stage_id;
  if (!pipelineId) {
    const { data: p } = await auth.admin.from("pipelines").select("id").eq("organization_id", auth.orgId).order("is_default", { ascending: false }).order("created_at").limit(1).maybeSingle();
    if (!p) return apiError(422, "no_pipeline", "This workspace has no pipeline.");
    pipelineId = p.id as string;
  }
  if (!stageId) {
    const { data: s } = await auth.admin.from("pipeline_stages").select("id").eq("organization_id", auth.orgId).eq("pipeline_id", pipelineId).order("position").limit(1).maybeSingle();
    if (!s) return apiError(422, "no_stage", "The pipeline has no stages.");
    stageId = s.id as string;
  }
  const { data: org } = await auth.admin.from("organizations").select("currency").eq("id", auth.orgId).single();
  const { data, error } = await auth.admin
    .from("deals")
    .insert({
      organization_id: auth.orgId,
      title: d.title,
      value: d.value,
      currency: d.currency ?? (org?.currency as string) ?? "ILS",
      pipeline_id: pipelineId,
      stage_id: stageId,
      contact_id: d.contact_id ?? null,
      company_id: d.company_id ?? null,
      expected_close_date: d.expected_close_date ?? null,
    })
    .select(FIELDS)
    .single();
  if (error) {
    if (error.message.includes("stage_not_in_pipeline")) return apiError(422, "stage_not_in_pipeline");
    return dbApiError(error);
  }
  kickJobs();
  return NextResponse.json({ data }, { status: 201 });
}
