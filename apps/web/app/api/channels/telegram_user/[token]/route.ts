import { NextResponse, type NextRequest } from "next/server";
import { loadAccountByToken } from "@/lib/channels/accounts";
import { ingest } from "@/lib/channels/ingest";
import { verifyBridgeSignature } from "@/lib/channels/wa-bridge";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// the AI agent answers in the background (after the response) and may wait for a busy provider
export const maxDuration = 120;

interface TgUserEvent {
  type: "message" | "status" | "owner_message";
  // owner_message (wave 12): the owner wrote it himself from his Telegram app
  to?: string;
  id?: string;
  from?: string; // Telegram user id
  name?: string | null;
  phone?: string | null;
  username?: string | null;
  text?: string;
  media?: { type: string } | null;
  status?: "connected" | "logged_out";
}

/** POST /api/channels/telegram_user/{token} — signed callbacks for a personal Telegram account (bridge). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ ok: false }, { status: 404 });
  const raw = await request.text();
  if (!verifyBridgeSignature(raw, request.headers.get("x-scc-timestamp"), request.headers.get("x-scc-signature"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const acc = await loadAccountByToken("telegram_user", token).catch(() => null);
  if (!acc) return NextResponse.json({ ok: false }, { status: 404 });
  const ev = JSON.parse(raw || "{}") as TgUserEvent;

  if (ev.type === "status") {
    const connected = ev.status === "connected";
    await createAdminClient()
      .from("channel_accounts")
      .update({
        status: ev.status === "logged_out" ? "error" : "active",
        last_error: ev.status === "logged_out" ? "logged_out" : null,
        name: connected ? (ev.username ? `@${ev.username}` : ev.name || (ev.phone ? `+${ev.phone}` : "Telegram")) : acc.config.username ? `@${acc.config.username}` : "Telegram",
        config: { ...acc.config, state: ev.status ?? "unknown", ...(connected ? { phone: ev.phone ?? "", display_name: ev.name ?? "", username: ev.username ?? "" } : {}) },
        updated_at: new Date().toISOString(),
      })
      .eq("id", acc.id);
    return NextResponse.json({ ok: true });
  }

  // wave 12: the owner answered himself → recorded, the agent steps back in that chat
  if (ev.type === "owner_message" && ev.to && /^\d{3,20}$/.test(ev.to)) {
    const { ingestOwnerMessage } = await import("@/lib/channels/owner");
    await ingestOwnerMessage({ kind: "telegram_user", token, chat: ev.to, text: ev.text ?? "", messageId: ev.id ?? null, media: ev.media ?? null });
    return NextResponse.json({ ok: true });
  }

  if (ev.type === "message" && ev.from && /^\d{3,20}$/.test(ev.from)) {
    await ingest({
      kind: "telegram_user",
      token,
      chatId: ev.from,
      senderName: ev.name ?? (ev.username ? `@${ev.username}` : null),
      phone: ev.phone ? `+${ev.phone.replace(/^\+/, "")}` : null,
      text: (ev.text ?? "").slice(0, 8000),
      externalMessageId: ev.id ?? null,
      media: ev.media ?? null,
      chatType: "private",
    });
  }
  return NextResponse.json({ ok: true });
}
