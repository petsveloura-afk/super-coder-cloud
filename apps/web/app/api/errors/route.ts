import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const body = z.object({
  message: z.string().max(1000),
  route: z.string().max(300).optional(),
  digest: z.string().max(120).optional(),
});

/** POST /api/errors — the browser reports a crash of a screen (error boundary). Rate-limited, PII redacted. */
export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "anon";
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data: allowed } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `client-error:${ip}`, p_limit: 20, p_window_seconds: 600 });
    if (allowed === false) return NextResponse.json({ ok: false }, { status: 429 });
  }
  const { captureError } = await import("@/lib/ops/log");
  await captureError(new Error(parsed.data.message), { source: "client", route: parsed.data.route ?? null, digest: parsed.data.digest ?? null });
  return NextResponse.json({ ok: true });
}
