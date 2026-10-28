import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { roleHasPermission, isOrgRole } from "@scc/shared/permissions";
import { ACTIVE_ORG_COOKIE, getMemberships, getUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/channels/meta/sync — wave 43: the open inbox asks for its own business's new Facebook / Instagram
 * direct messages every ~20 seconds. Same pipeline as the webhook (de-duplicated by Meta's message ids, the agent
 * answers what is unanswered), so a missing / late webhook no longer means hours of silence.
 * Signed-in members with inbox access only; at most one run per business every 15 seconds.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, messages: 0 });
  const memberships = (await getMemberships(user.id)).filter((m) => isOrgRole(m.role) && roleHasPermission(m.role, "inbox.read"));
  const hint = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.organization_id === hint) ?? memberships[0];
  if (!active) return NextResponse.json({ ok: false }, { status: 403 });
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `metasync:${active.organization_id}`, p_limit: 1, p_window_seconds: 15 });
  if (allowed === false) return NextResponse.json({ ok: true, throttled: true, messages: 0 });
  const { syncMetaInbound } = await import("@/lib/channels/meta-sync");
  const r = await syncMetaInbound(15_000, { orgId: active.organization_id, fast: true }).catch((e) => {
    console.error("meta inbox sync failed", (e as Error).message);
    return null;
  });
  return NextResponse.json({ ok: Boolean(r), messages: r?.messages ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
