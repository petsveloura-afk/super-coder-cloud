import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { loadAccountByToken, type LoadedAccount } from "@/lib/channels/accounts";
import { verifyTwilioSignature } from "@/lib/channels/providers";
import { publicEnv } from "@/lib/env";

/** Wave 16 — Twilio voice webhooks: the SMS account's token + a valid Twilio signature. */
export async function twilioVoiceRequest(request: NextRequest, token: string, path: string): Promise<{ acc: LoadedAccount; form: Record<string, string> } | NextResponse> {
  if (!/^[a-f0-9]{48}$/.test(token)) return new NextResponse("not found", { status: 404 });
  const acc = await loadAccountByToken("sms", token).catch(() => null);
  if (!acc) return new NextResponse("not found", { status: 404 });
  const form = Object.fromEntries(new URLSearchParams(await request.text())) as Record<string, string>;
  const url = `${publicEnv.appUrl.replace(/\/$/, "")}/api/voice/twilio/${token}${path}${request.nextUrl.search}`;
  if (!verifyTwilioSignature(url, form, request.headers.get("x-twilio-signature"), acc.secrets.auth_token ?? "")) return new NextResponse("forbidden", { status: 403 });
  return { acc, form };
}

export const xml = (body: string) => new NextResponse(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
