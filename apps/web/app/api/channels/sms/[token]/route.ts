import { NextResponse, type NextRequest } from "next/server";
import { loadAccountByToken } from "@/lib/channels/accounts";
import { verifyTwilioSignature } from "@/lib/channels/providers";
import { ingest } from "@/lib/channels/ingest";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** POST /api/channels/sms/{token} — Twilio inbound SMS webhook (form-encoded, signed). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return new NextResponse("not found", { status: 404 });
  const acc = await loadAccountByToken("sms", token).catch(() => null);
  if (!acc) return new NextResponse("not found", { status: 404 });
  const form = Object.fromEntries(new URLSearchParams(await request.text())) as Record<string, string>;
  const url = `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/sms/${token}`;
  if (!verifyTwilioSignature(url, form, request.headers.get("x-twilio-signature"), acc.secrets.auth_token ?? "")) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (form.From) {
    await ingest({
      kind: "sms",
      token,
      chatId: form.From,
      senderName: null,
      phone: form.From,
      text: form.Body ?? "",
      externalMessageId: form.MessageSid ?? null,
      media: Number(form.NumMedia ?? 0) > 0 ? { type: "mms", count: Number(form.NumMedia) } : null,
    });
  }
  return new NextResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
