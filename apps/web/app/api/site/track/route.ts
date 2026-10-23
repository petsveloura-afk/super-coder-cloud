import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { isVariant, validVisitorId } from "@/lib/site/ab-core";

/**
 * Wave 17 — anonymous behavior events from a published website (view / time on page /
 * click / conversion). Random visitor id only; no IP or personal data is stored.
 * Rate-limited per visitor in the database (track_site_event).
 */
export const dynamic = "force-dynamic";

const EVENTS = new Set(["view", "time", "click", "convert"]);

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.length > 2000) return new NextResponse(null, { status: 413 });
    body = JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const slug = typeof body.slug === "string" ? body.slug : "";
  const event = typeof body.event === "string" ? body.event : "";
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug) || !EVENTS.has(event) || !validVisitorId(body.visitor)) return new NextResponse(null, { status: 400 });
  const path = typeof body.path === "string" ? body.path.slice(0, 300) : "/";
  const seconds = Math.max(0, Math.min(86_400, Math.round(Number(body.seconds) || 0)));
  const { error } = await createAnonClient().rpc("track_site_event", {
    p_slug: slug,
    p_visitor: body.visitor,
    p_path: path,
    p_event: event,
    p_seconds: seconds,
    p_variant: isVariant(body.variant) ? body.variant : null,
  });
  // tracking never breaks the site; 204 either way
  if (error && error.code !== "PGRST202") console.error("site track failed", error.message);
  return new NextResponse(null, { status: 204 });
}
