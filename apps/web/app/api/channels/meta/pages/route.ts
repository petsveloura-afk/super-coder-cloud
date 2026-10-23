import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { verifyMetaSignature } from "@/lib/channels/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePagesWebhook, type RawPagesWebhook } from "@/lib/channels/meta-pages-core";

export const dynamic = "force-dynamic";
// the AI agent answers in the background (after the response)
export const maxDuration = 120;

/**
 * Wave 19 — ONE app-level webhook for every business's Facebook Page and Instagram account:
 *   Messenger / Instagram Direct messages → the inbox + the AI agent (one conversation state)
 *   echoes (the owner answered from Meta Business Suite / the phone) → the agent steps back
 *   Page / Instagram comments → the comments board (+ AI reply / private DM when enabled)
 * Configure in the Meta app (Webhooks): object "page" and object "instagram",
 *   callback https://<app>/api/channels/meta/pages, verify token META_WEBHOOK_VERIFY_TOKEN.
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

type Acc = { id: string; organization_id: string; webhook_token: string; secret_enc: string | null; config: Record<string, string> } | null;

export async function POST(request: NextRequest) {
  const secret = process.env.META_APP_SECRET ?? "";
  const raw = await request.text();
  if (!secret || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let body: RawPagesWebhook;
  try {
    body = JSON.parse(raw || "{}") as RawPagesWebhook;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { messages, comments } = parsePagesWebhook(body);
  if (!messages.length && !comments.length) return NextResponse.json({ ok: true });
  const admin = createAdminClient();
  const cache = new Map<string, Acc>();
  const account = async (kind: "messenger" | "instagram", id: string): Promise<Acc> => {
    const key = `${kind}:${id}`;
    if (!cache.has(key)) {
      const field = kind === "instagram" ? "ig_id" : "page_id";
      const { data } = await admin.from("channel_accounts").select("id, organization_id, webhook_token, secret_enc, config").eq("kind", kind).eq(`config->>${field}`, id).neq("status", "disabled").maybeSingle();
      cache.set(key, (data as Acc) ?? null);
    }
    return cache.get(key) ?? null;
  };
  const { openSecrets } = await import("@/lib/channels/secrets");
  const { ingest } = await import("@/lib/channels/ingest");

  for (const m of messages) {
    const acc = await account(m.platform, m.accountId);
    if (!acc) continue;
    if (m.echo) {
      // our own sends come back as echoes from our app — they are already stored
      if (m.echoAppId && m.echoAppId === (process.env.META_APP_ID ?? "")) continue;
      await admin.rpc("ingest_owner_message_meta", { p_token: acc.webhook_token, p_kind: m.platform, p_chat: m.senderId, p_text: m.text, p_message: m.mid, p_media: m.media ?? null }).then(
        () => undefined,
        (e: unknown) => console.error("meta owner echo failed", (e as Error).message),
      );
      continue;
    }
    // the customer's name once (new conversations only)
    let name: string | null = null;
    const { data: existing } = await admin.from("conversations").select("id").eq("organization_id", acc.organization_id).eq("channel", m.platform).eq("external_id", m.senderId).maybeSingle();
    if (!existing) {
      const secrets = acc.secret_enc ? openSecrets(acc.secret_enc) : {};
      if (secrets.page_token) {
        const { metaProfileName } = await import("@/lib/channels/meta-pages");
        name = await metaProfileName(m.platform, m.senderId, secrets.page_token).catch(() => null);
      }
    }
    await ingest({
      kind: m.platform,
      token: acc.webhook_token,
      chatId: m.senderId,
      senderName: name ?? (m.platform === "instagram" ? "Instagram" : "Messenger"),
      text: m.text,
      externalMessageId: m.mid,
      media: m.media,
      meta: { ...(m.postback ? { postback: m.postback } : {}), ...(m.referral ? { referral: m.referral } : {}) },
    });
  }

  if (comments.length) {
    const { handleSocialComment } = await import("@/lib/social/comments");
    for (const c of comments) {
      const acc = await account(c.platform === "instagram" ? "instagram" : "messenger", c.accountId);
      if (!acc) continue;
      await handleSocialComment(acc.organization_id, acc.id, c).catch((e) => console.error("social comment failed", (e as Error).message));
    }
  }
  return NextResponse.json({ ok: true });
}
