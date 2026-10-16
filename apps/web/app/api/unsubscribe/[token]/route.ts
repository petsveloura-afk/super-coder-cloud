import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";

/** RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) — mail providers POST here. */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ ok: false }, { status: 404 });
  const { data, error } = await createAnonClient().rpc("unsubscribe", { p_token: token });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: Boolean((data as { ok: boolean }).ok) });
}
