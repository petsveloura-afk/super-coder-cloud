import { NextResponse, type NextRequest } from "next/server";
import { loadAccountByToken } from "@/lib/channels/accounts";
import { ingest } from "@/lib/channels/ingest";
import { verifyBridgeSignature } from "@/lib/channels/wa-bridge";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface BridgeEvent {
  type: "message" | "status";
  // message
  id?: string;
  from?: string; // digits (international, no +)
  name?: string | null;
  text?: string;
  isGroup?: boolean;
  media?: { type: string; name?: string } | null;
  // status
  status?: "qr" | "connected" | "logged_out";
  phone?: string | null;
}

/** POST /api/channels/whatsapp_qr/{token} — signed callbacks from the WhatsApp QR bridge service. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ ok: false }, { status: 404 });
  const raw = await request.text();
  if (!verifyBridgeSignature(raw, request.headers.get("x-scc-timestamp"), request.headers.get("x-scc-signature"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const acc = await loadAccountByToken("whatsapp_qr", token).catch(() => null);
  if (!acc) return NextResponse.json({ ok: false }, { status: 404 });
  const ev = JSON.parse(raw || "{}") as BridgeEvent;

  if (ev.type === "status") {
    const admin = createAdminClient();
    const connected = ev.status === "connected";
    await admin
      .from("channel_accounts")
      .update({
        status: ev.status === "logged_out" ? "error" : "active",
        last_error: ev.status === "logged_out" ? "logged_out" : null,
        name: connected && ev.phone ? `+${ev.phone}` : acc.config.phone ? `+${acc.config.phone}` : "WhatsApp",
        config: { ...acc.config, state: ev.status ?? "unknown", ...(connected ? { phone: ev.phone ?? "", display_name: ev.name ?? "" } : {}) },
        updated_at: new Date().toISOString(),
      })
      .eq("id", acc.id);
    return NextResponse.json({ ok: true });
  }

  if (ev.type === "message" && ev.from && /^\d{6,20}$/.test(ev.from)) {
    await ingest({
      kind: "whatsapp_qr",
      token,
      chatId: ev.from,
      senderName: ev.name ?? null,
      phone: `+${ev.from}`,
      text: (ev.text ?? "").slice(0, 8000),
      externalMessageId: ev.id ?? null,
      media: ev.media ?? null,
      chatType: ev.isGroup ? "group" : "private",
    });
  }
  return NextResponse.json({ ok: true });
}
