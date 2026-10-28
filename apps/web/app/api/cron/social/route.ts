import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET|POST /api/cron/social — wave 35: ONLY the due social posts (fast, runs first every 5 minutes). Bearer CRON_SECRET. */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const t0 = Date.now();
  const { publishDuePosts } = await import("@/lib/social/publish");
  const result = await publishDuePosts(45_000).catch((e) => ({ error: (e as Error).message }));
  // wave 41: customers' Facebook / Instagram comments and messages that Meta's webhook did not deliver
  // (runs only in the time that is left; never delays or blocks the posts above)
  const left = 56_000 - (Date.now() - t0);
  const metaSync = left > 9_000 ? await import("@/lib/channels/meta-sync").then((m) => m.syncMetaInbound(Math.min(20_000, left - 8_000))).catch((e) => ({ error: (e as Error).message })) : { skipped: true };
  // wave 43: is the Meta app's own webhook (Page + Instagram) delivering? Reported here (visible in the Actions log)
  // and repaired when it is clearly broken — the real reason messages arrive minutes or hours late
  const metaWebhook = await (async () => {
    try {
      const { publicEnv } = await import("@/lib/env");
      const { checkMetaAppWebhooks } = await import("@/lib/channels/meta-webhook-health");
      return await checkMetaAppWebhooks({ callbackBase: publicEnv.appUrl });
    } catch (e) {
      return { checked: false, error: (e as Error).message };
    }
  })();
  return NextResponse.json({ ok: true, socialPosts: result, metaSync, metaWebhook }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
