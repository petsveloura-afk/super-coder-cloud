import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { hashApiKey } from "@scc/shared/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public REST API (v1) for Zapier/Make/custom integrations.
 * Auth: `Authorization: Bearer scc_live_…` (only the SHA-256 hash is stored).
 * Every query runs with the service role AND an explicit organization filter
 * taken from the key — a key can never reach another tenant's data.
 * Rate limit: 120 requests / minute / key.
 */
export const API_SCOPES = ["contacts.read", "contacts.write", "deals.read", "deals.write", "tasks.write", "events.read", "webhooks.manage"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiContext {
  orgId: string;
  keyId: string;
  scopes: string[];
  admin: ReturnType<typeof createAdminClient>;
}

export function apiError(status: number, code: string, message?: string) {
  return NextResponse.json({ error: { code, message: message ?? code } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function authenticate(request: NextRequest, scope: ApiScope | null): Promise<ApiContext | NextResponse> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return apiError(503, "not_configured", "The API is not enabled on this server.");
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^scc_live_[A-Za-z0-9_-]{20,}$/.test(token)) return apiError(401, "unauthorized", "Missing or malformed API key.");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_key_lookup", { p_hash: hashApiKey(token) });
  const row = (data as { key_id: string; organization_id: string; scopes: string[] }[] | null)?.[0];
  if (error || !row) return apiError(401, "unauthorized", "Invalid or revoked API key.");
  const { data: allowed } = await admin.rpc("hit_rate_limit", { p_bucket: `api:${row.key_id}`, p_limit: 120, p_window_seconds: 60 });
  if (allowed === false) return apiError(429, "rate_limited", "Too many requests — max 120 per minute.");
  if (scope && !row.scopes.includes(scope)) return apiError(403, "insufficient_scope", `This key lacks the "${scope}" scope.`);
  // wave 13: the REST API is part of the Business plan and up (plans.features: api_access)
  const { data: hasApi } = await admin.rpc("has_feature", { p_org: row.organization_id, p_feature: "api_access" });
  if (hasApi !== true) return apiError(402, "plan_required", "API access is part of the Business plan — upgrade in Billing to use this key.");
  return { orgId: row.organization_id, keyId: row.key_id, scopes: row.scopes, admin };
}

export function pageParams(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 25));
  const offset = Math.max(0, Math.min(1_000_000, Number(sp.get("offset")) || 0));
  return { limit, offset };
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  const raw = await request.text();
  if (raw.length > 65_536) return apiError(413, "payload_too_large");
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return apiError(400, "invalid_body", "Body must be a JSON object.");
    return v as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_json");
  }
}

/** Maps Postgres errors to API errors without leaking internals. */
export function dbApiError(error: { code?: string; message?: string }) {
  if (error.message?.includes("plan_limit")) return apiError(402, "plan_limit", "Your plan limit was reached — upgrade to add more.");
  if (error.code === "23505") return apiError(409, "conflict", "A record with this unique value already exists.");
  if (error.code === "23503" || error.code === "23514" || error.code === "22P02") return apiError(422, "invalid_reference", "A referenced id is invalid for this workspace.");
  return apiError(500, "internal_error");
}
