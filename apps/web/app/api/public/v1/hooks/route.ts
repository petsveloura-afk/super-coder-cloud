import { NextResponse, type NextRequest } from "next/server";
import { AUTOMATION_TRIGGERS } from "@scc/shared/automations";
import { apiError, authenticate, dbApiError, readJson } from "@/lib/public-api";
import { assertPublicHttpsUrl } from "@/lib/net/safe-url";

export const dynamic = "force-dynamic";

/**
 * Wave 19 — REST Hooks (Zapier / Make / n8n instant triggers).
 *   POST   /api/public/v1/hooks        { "target_url": "https://hooks.zapier.com/…", "event": "contact.created" } → { id }
 *   GET    /api/public/v1/hooks        the key's organization subscriptions
 *   DELETE /api/public/v1/hooks/{id}   unsubscribe (Zapier calls it when a Zap is turned off)
 * Deliveries are signed (X-SCC-Signature) and retried by the job queue — same as Settings → Webhooks.
 */
const EVENTS = new Set<string>([...AUTOMATION_TRIGGERS, "*"]);

export async function POST(request: NextRequest) {
  const auth = await authenticate(request, "webhooks.manage");
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const url = String(body.target_url ?? body.hookUrl ?? body.url ?? "");
  const event = String(body.event ?? "").trim();
  if (!EVENTS.has(event)) return apiError(422, "invalid_event", `Unknown event. Use one of: ${[...EVENTS].join(", ")}`);
  try {
    await assertPublicHttpsUrl(url);
  } catch {
    return apiError(422, "invalid_url", "target_url must be a public https URL.");
  }
  const events = event === "*" ? [...AUTOMATION_TRIGGERS].slice(0, 30) : [event];
  const source = /zapier\.com$/i.test(new URL(url).hostname) ? "Zapier" : /make\.com|integromat/i.test(new URL(url).hostname) ? "Make" : "REST hook";
  const { data, error } = await auth.admin.from("webhooks").insert({ organization_id: auth.orgId, url, events, description: `${source} · ${event}`.slice(0, 200), enabled: true }).select("id").single();
  if (error || !data) return dbApiError(error ?? {});
  return NextResponse.json({ id: data.id, event, target_url: url }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request, "webhooks.manage");
  if (auth instanceof NextResponse) return auth;
  const { data, error } = await auth.admin.from("webhooks").select("id, url, events, description, enabled, last_status, last_delivery_at, created_at").eq("organization_id", auth.orgId).order("created_at", { ascending: false }).limit(100);
  if (error) return dbApiError(error);
  return NextResponse.json({ data });
}
