import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { openApiDocument } from "@/lib/openapi";

export const dynamic = "force-static";

/** Spec J1 — GET /api/public/v1/openapi.json : the OpenAPI 3.1 description (public, cacheable). */
export function GET() {
  return NextResponse.json(openApiDocument(publicEnv.appUrl), { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
