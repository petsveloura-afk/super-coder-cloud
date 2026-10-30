import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { verifyTwilioSignature } from "@/lib/channels/providers";
import { publicEnv } from "@/lib/env";
import { platformTwilio } from "./platform-phone-core";

/** Wave 57 — Twilio webhooks of PLATFORM numbers: verified with the platform account's auth token. */
export async function platformVoiceRequest(request: NextRequest, path: string): Promise<{ form: Record<string, string> } | NextResponse> {
  const tw = platformTwilio(process.env);
  if (!tw) return new NextResponse("not found", { status: 404 });
  const form = Object.fromEntries(new URLSearchParams(await request.text())) as Record<string, string>;
  const url = `${publicEnv.appUrl.replace(/\/$/, "")}/api/voice/platform${path}${request.nextUrl.search}`;
  if (!verifyTwilioSignature(url, form, request.headers.get("x-twilio-signature"), tw.token)) return new NextResponse("forbidden", { status: 403 });
  return { form };
}

export const twimlResponse = (body: string) => new NextResponse(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
