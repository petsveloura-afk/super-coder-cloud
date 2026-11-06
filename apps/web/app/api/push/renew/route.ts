import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPushEndpoint } from "@/lib/push/webpush-core";

export const dynamic = "force-dynamic";

/**
 * Push fix — POST /api/push/renew: the service worker reports that the browser rotated this device's subscription
 * (pushsubscriptionchange). Only the signed-in member's own subscription row (found by the old endpoint) is updated.
 */
const body = z.object({
  old: z.string().url().max(1000).nullable().optional(),
  sub: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/) }) }),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isPushEndpoint(parsed.data.sub.endpoint)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false }, { status: 503 });
  const admin = createAdminClient();
  const { old, sub } = parsed.data;
  const patch = { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300) || null };
  if (old) {
    const { data } = await admin.from("push_subscriptions").update(patch).eq("user_id", auth.user.id).eq("endpoint", old).select("id");
    if (data?.length) return NextResponse.json({ ok: true, renewed: true });
  }
  // no old row: attach to the member's most recent device workspace (the push job reaches every device of the member anyway)
  const { data: last } = await admin.from("push_subscriptions").select("organization_id").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: member } = last ? { data: null } : await admin.from("organization_members").select("organization_id").eq("user_id", auth.user.id).limit(1).maybeSingle();
  const org = (last?.organization_id as string | undefined) ?? (member?.organization_id as string | undefined);
  if (!org) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  const { error } = await admin.from("push_subscriptions").upsert({ organization_id: org, user_id: auth.user.id, ...patch }, { onConflict: "endpoint" });
  return error ? NextResponse.json({ ok: false }, { status: 500 }) : NextResponse.json({ ok: true, renewed: false });
}
