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
  // the Page webhook is signed with the app secret; Instagram-login apps have their own secret — either one is accepted
  const secrets = [process.env.META_APP_SECRET, process.env.META_IG_APP_SECRET, process.env.META_PAGES_APP_SECRET].filter((v): v is string => Boolean(v));
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!secrets.length || !secrets.some((secret) => verifyMetaSignature(raw, signature, secret))) {
    console.error("meta pages webhook rejected: bad or missing signature (META_APP_SECRET must be the secret of the app that sends the webhook)");
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
      const { data } = await admin.from("channel_accounts").select("id, organization_id, webhook_token, secret_enc, config").eq("kind", kind).eq(`config->>${field}`, id).neq("status", "disabled").order("created_at").limit(1).maybeSingle();
      cache.set(key, (data as Acc) ?? null);
    }
    return cache.get(key) ?? null;
  };
  const agentCache = new Map<string, boolean>();
  const orgHasAgent = async (orgId: string): Promise<boolean> => {
    if (!agentCache.has(orgId)) {
      const { count } = await admin.from("ai_agents").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("enabled", true);
      agentCache.set(orgId, (count ?? 0) > 0);
    }
    return agentCache.get(orgId) ?? false;
  };
  const { openSecrets } = await import("@/lib/channels/secrets");
  const { ingest } = await import("@/lib/channels/ingest");

  for (const m of messages) {
    try {
    const acc = await account(m.platform, m.accountId);
    if (!acc) {
      console.error(`meta pages webhook: no connected ${m.platform} account for id ${m.accountId} — message dropped`);
      continue;
    }
    if (m.echo) {
      // our own sends come back as echoes from our app — they are already stored
      if (m.echoAppId && m.echoAppId === (process.env.META_APP_ID ?? "")) continue;
      // the echo of a reply our agent / inbox just sent can arrive before its message id is stored (or without our app id):
      // it must never switch the conversation to "a person answered" — compare with what we sent in the last minutes
      {
        const { data: c } = await admin.from("conversations").select("id").eq("organization_id", acc.organization_id).eq("channel", m.platform).eq("external_id", m.senderId).maybeSingle();
        if (c?.id) {
          const { data: recent } = await admin
            .from("messages")
            .select("body, external_id, meta")
            .eq("conversation_id", c.id as string)
            .eq("direction", "out")
            .gte("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
            .order("created_at", { ascending: false })
            .limit(15);
          const probe = m.text.trim().slice(0, 80);
          const ours = ((recent ?? []) as { body: string | null; external_id: string | null; meta: { owner?: boolean } | null }[]).some(
            (r) => r.meta?.owner !== true && ((r.external_id && r.external_id === m.mid) || (probe.length > 0 && (r.body ?? "").includes(probe))),
          );
          if (ours) continue;
        }
      }
      await admin.rpc("ingest_owner_message_meta", { p_token: acc.webhook_token, p_kind: m.platform, p_chat: m.senderId, p_text: m.text, p_message: m.mid, p_media: m.media ?? null }).then(
        () => undefined,
        (e: unknown) => console.error("meta owner echo failed", (e as Error).message),
      );
      continue;
    }
    // the customer's name once (new conversations only)
    let name: string | null = null;
    const { data: existing } = await admin.from("conversations").select("id, ai_mode, opt_out").eq("organization_id", acc.organization_id).eq("channel", m.platform).eq("external_id", m.senderId).maybeSingle();
    const secrets = acc.secret_enc ? openSecrets(acc.secret_enc) : {};
    const pageToken = secrets.page_token ?? "";
    // speed: the customer sees "seen" + "typing…" at once — before anything is stored or the agent is loaded.
    // Only when the agent is really going to answer (conversation in auto mode, not opted out, an agent exists).
    if (pageToken && (!existing || (existing.ai_mode === "auto" && existing.opt_out !== true)) && (await orgHasAgent(acc.organization_id))) {
      const { metaSenderAction } = await import("@/lib/channels/meta-pages");
      void metaSenderAction(pageToken, m.senderId, "mark_seen")
        .then(() => metaSenderAction(pageToken, m.senderId, "typing_on"))
        .catch(() => undefined);
    }
    // the profile name must never hold the answer back: wait for it at most ~1.2s; when it is slower the
    // conversation starts with a neutral title and the real name is filled in right after
    let latePatch: Promise<string | null> | null = null;
    if (!existing && pageToken) {
      const { metaProfileName } = await import("@/lib/channels/meta-pages");
      const { withSoftDeadline } = await import("@/lib/ai/speed-core");
      const lookup = metaProfileName(m.platform, m.senderId, pageToken).catch(() => null);
      name = await withSoftDeadline(lookup, 1200, null);
      if (!name) latePatch = lookup;
    }
    const res = await ingest({
      kind: m.platform,
      token: acc.webhook_token,
      chatId: m.senderId,
      senderName: name ?? (m.platform === "instagram" ? "Instagram" : "Messenger"),
      text: m.text,
      externalMessageId: m.mid,
      media: m.media,
      meta: { ...(m.postback ? { postback: m.postback } : {}), ...(m.referral ? { referral: m.referral } : {}) },
    });
    if (latePatch) {
      const convId = (res?.data as { conversation_id?: string; contact_id?: string } | null)?.conversation_id;
      const contactId = (res?.data as { conversation_id?: string; contact_id?: string } | null)?.contact_id;
      const fallbackName = m.platform === "instagram" ? "Instagram" : "Messenger";
      const patch = async () => {
        const real = await latePatch;
        if (!real || !convId) return;
        await admin.from("conversations").update({ title: real }).eq("id", convId).eq("title", fallbackName);
        if (contactId) {
          const first = real.split(" ")[0]!.slice(0, 80);
          const last = real.slice(first.length).trim().slice(0, 80);
          await admin.from("contacts").update({ first_name: first, last_name: last }).eq("id", contactId).eq("first_name", fallbackName);
        }
      };
      try {
        const { after } = await import("next/server");
        after(() => patch().catch(() => undefined));
      } catch {
        void patch().catch(() => undefined);
      }
    }
    } catch (e) {
      // never answer 500 to Meta because of one message: it retries the whole batch and finally turns the webhook off
      console.error("meta pages webhook message failed", (e as Error).message);
    }
  }

  if (comments.length) {
    const { handleSocialComment } = await import("@/lib/social/comments");
    for (const c of comments) {
      const acc = await account(c.platform === "instagram" ? "instagram" : "messenger", c.accountId);
      if (!acc) {
        console.error(`meta pages webhook: no connected ${c.platform} account for id ${c.accountId} — comment dropped`);
        continue;
      }
      await handleSocialComment(acc.organization_id, acc.id, c).catch((e) => console.error("social comment failed", (e as Error).message));
    }
  }
  return NextResponse.json({ ok: true });
}
