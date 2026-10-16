import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ingest } from "@/lib/channels/ingest";
import { handleTelegramBusiness, handleTelegramSpecial, type TgBusinessConnection, type TgBusinessMessage } from "@/lib/channels/telegram-business";

export const dynamic = "force-dynamic";
// the AI agent answers in the background (after the response) and may wait for a busy provider
export const maxDuration = 120;

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  contact?: { phone_number?: string };
  photo?: unknown[];
  document?: { file_name?: string };
  voice?: unknown;
  location?: { latitude: number; longitude: number };
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * POST /api/channels/telegram/{token} — Telegram Bot API webhook.
 * setWebhook is called with secret_token = {token}; Telegram echoes it in
 * X-Telegram-Bot-Api-Secret-Token, which we verify in constant time.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ ok: false }, { status: 404 });
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!same(header, token)) return NextResponse.json({ ok: false }, { status: 401 });
  const update = (await request.json().catch(() => null)) as {
    message?: TgMessage;
    edited_message?: TgMessage;
    channel_post?: TgMessage;
    business_connection?: TgBusinessConnection;
    business_message?: TgBusinessMessage;
    edited_business_message?: TgBusinessMessage;
    deleted_business_messages?: unknown;
    callback_query?: { id: string };
  } | null;
  // wave 10: Telegram Business (the bot runs a personal account's chats) — separate update types
  if (update?.business_connection || update?.business_message || update?.edited_business_message || update?.deleted_business_messages) {
    await handleTelegramBusiness(token, update).catch((e) => console.error("telegram business update failed", (e as Error).message));
    return NextResponse.json({ ok: true });
  }
  // invited team members linking themselves (/start n_<code>) and /stop_updates — never a customer conversation
  if (update?.message && (await handleTelegramSpecial(token, update.message).catch(() => false))) return NextResponse.json({ ok: true });
  const msg = update?.message ?? update?.edited_message ?? update?.channel_post;
  if (!msg) return NextResponse.json({ ok: true }); // other update types are acknowledged and ignored

  const from = msg.from;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || msg.chat.title || null;
  let text = msg.text ?? msg.caption ?? "";
  let media: Record<string, unknown> | null = null;
  if (!text && msg.contact?.phone_number) text = `📞 ${msg.contact.phone_number}`;
  if (msg.photo) media = { type: "photo" };
  else if (msg.document) media = { type: "document", name: msg.document.file_name };
  else if (msg.voice) media = { type: "voice" };
  else if (msg.location) {
    media = { type: "location", lat: msg.location.latitude, lng: msg.location.longitude };
    text ||= `📍 ${msg.location.latitude},${msg.location.longitude}`;
  }
  await ingest({
    kind: "telegram",
    token,
    chatId: String(msg.chat.id),
    senderName: name,
    phone: msg.contact?.phone_number ?? null,
    text,
    externalMessageId: String(msg.message_id),
    media,
    chatType: msg.chat.type,
    // edits and channel posts are stored but never answered automatically
    autoReply: Boolean(update?.message),
  });
  // Always 200 so Telegram doesn't retry forever; failures are logged.
  return NextResponse.json({ ok: true });
}
