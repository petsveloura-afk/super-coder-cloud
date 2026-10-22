import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { verifyMetaSignature } from "@/lib/channels/providers";
import { ingest } from "@/lib/channels/ingest";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// the AI agent answers in the background (after the response) and may wait for a busy provider
export const maxDuration = 120;

/**
 * App-level WhatsApp webhook for numbers connected with Embedded Signup
 * ("Connect WhatsApp" button). One URL for every business: messages are routed
 * by metadata.phone_number_id. Configure in the Meta app:
 *   Callback URL  https://<app>/api/channels/meta/whatsapp
 *   Verify token  META_WEBHOOK_VERIFY_TOKEN
 *   Fields        messages
 * (Numbers connected manually keep using /api/channels/whatsapp/{token}.)
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
  const given = sp.get("hub.verify_token") ?? "";
  const same = expected.length >= 8 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (sp.get("hub.mode") === "subscribe" && same) {
    return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: {
    id: string;
    from: string;
    type: string;
    text?: { body: string };
    button?: { text: string };
    interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
    image?: { caption?: string };
    document?: { filename?: string; caption?: string };
    location?: { latitude: number; longitude: number };
  }[];
  statuses?: { id: string; status: "sent" | "delivered" | "read" | "failed"; errors?: { title?: string }[] }[];
}

export async function POST(request: NextRequest) {
  const secret = process.env.META_APP_SECRET ?? "";
  const raw = await request.text();
  if (!secret || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = JSON.parse(raw || "{}") as { entry?: { changes?: { value?: WaValue }[] }[] };
  const admin = createAdminClient();
  const accounts = new Map<string, { organization_id: string; webhook_token: string } | null>();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const pid = v.metadata?.phone_number_id ?? "";
      if (!/^\d{5,30}$/.test(pid)) continue;
      if (!accounts.has(pid)) {
        const { data } = await admin.from("channel_accounts").select("organization_id, webhook_token").eq("kind", "whatsapp").eq("config->>phone_number_id", pid).neq("status", "disabled").maybeSingle();
        accounts.set(pid, (data as { organization_id: string; webhook_token: string } | null) ?? null);
      }
      const acc = accounts.get(pid);
      if (!acc) continue;
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          m.image?.caption ??
          m.document?.caption ??
          (m.location ? `📍 ${m.location.latitude},${m.location.longitude}` : "");
        await ingest({
          kind: "whatsapp",
          token: acc.webhook_token,
          chatId: m.from,
          senderName: names.get(m.from) ?? null,
          phone: `+${m.from}`,
          text,
          externalMessageId: m.id,
          media: ["image", "document", "audio", "video", "sticker"].includes(m.type) ? { type: m.type, name: m.document?.filename } : null,
        });
      }
      for (const s of v.statuses ?? []) {
        await admin
          .from("messages")
          .update({ status: s.status, error: s.status === "failed" ? (s.errors?.[0]?.title ?? "failed").slice(0, 500) : null })
          .eq("organization_id", acc.organization_id)
          .eq("external_id", s.id);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
