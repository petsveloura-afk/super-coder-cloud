import { NextResponse, type NextRequest } from "next/server";
import { loadAccountByToken } from "@/lib/channels/accounts";
import { verifyMetaSignature } from "@/lib/channels/providers";
import { ingest } from "@/lib/channels/ingest";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// the AI agent answers in the background (after the response) and may wait for a busy provider
export const maxDuration = 120;

/** GET — Meta webhook verification: echo hub.challenge when hub.verify_token matches. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sp = request.nextUrl.searchParams;
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token && /^[a-f0-9]{48}$/.test(token)) {
    const acc = await loadAccountByToken("whatsapp", token).catch(() => null);
    if (acc) return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface WaValue {
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

/** POST — messages and delivery statuses, signed with the Meta app secret. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ ok: false }, { status: 404 });
  const acc = await loadAccountByToken("whatsapp", token).catch(() => null);
  if (!acc) return NextResponse.json({ ok: false }, { status: 404 });
  const raw = await request.text();
  if (!acc.secrets.app_secret || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), acc.secrets.app_secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = JSON.parse(raw || "{}") as { entry?: { changes?: { value?: WaValue }[] }[] };
  const admin = createAdminClient();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
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
          token,
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
