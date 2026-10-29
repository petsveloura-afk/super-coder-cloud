import "server-only";
import { graphVersion } from "./meta";
import type { ProviderResult } from "./providers";
import { quickReplies, splitForMeta, type SocialPlatform } from "./meta-pages-core";

/**
 * Wave 19 — Facebook Page (Messenger + comments + posts) and Instagram (Direct + comments + posts)
 * with ONE Facebook login ("Facebook Login for Business" configuration). The business clicks
 * "Connect Facebook & Instagram", picks its Page in Meta's popup — done: messages reach the inbox
 * and the AI agent, comments reach the comments board, the marketing agent can publish.
 *
 * One-time platform setup (owner) — the same Meta app as WhatsApp:
 *   products: Messenger, Instagram (Messenger API for Instagram), Facebook Login for Business
 *   a Login configuration with: pages_show_list, pages_messaging, pages_manage_metadata,
 *     pages_read_engagement, pages_manage_engagement, pages_manage_posts, business_management,
 *     instagram_basic, instagram_manage_messages, instagram_manage_comments, instagram_content_publish
 *   webhooks: Page → messages, messaging_postbacks, message_echoes, feed;
 *             Instagram → messages, comments   →   https://<app>/api/channels/meta/pages
 *   env: META_APP_ID, META_APP_SECRET, META_PAGES_CONFIG_ID, META_WEBHOOK_VERIFY_TOKEN
 */
export function metaPagesConfigured(): boolean {
  return /^\d{5,30}$/.test(process.env.META_APP_ID ?? "") && /^[a-f0-9]{32}$/i.test(process.env.META_APP_SECRET ?? "") && /^\d{5,30}$/.test(process.env.META_PAGES_CONFIG_ID ?? "");
}

export function metaPagesPublicConfig() {
  return metaPagesConfigured() ? { appId: process.env.META_APP_ID!, configId: process.env.META_PAGES_CONFIG_ID!, version: graphVersion() } : null;
}

const graph = () => (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");

async function g(path: string, init: { method?: "GET" | "POST" | "DELETE"; token?: string; body?: unknown } = {}) {
  try {
    const res = await fetch(`${graph()}${path}`, {
      method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number; error_subcode?: number } };
    return { ok: res.ok, status: res.status, data: j, error: j.error?.message ?? (res.ok ? undefined : `HTTP ${res.status}`), code: j.error?.code };
  } catch (e) {
    return { ok: false, status: 0, data: {} as Record<string, unknown>, error: (e as Error).message, code: undefined };
  }
}

export interface MetaPage {
  id: string;
  name: string;
  token: string;
  instagram: { id: string; username: string | null } | null;
}

/** popup code → a user token → the Pages (with their own tokens) the business chose to share. */
export async function pagesFromLoginCode(code: string, redirectUri?: string): Promise<{ ok: boolean; error?: string; pages: MetaPage[] }> {
  if (!metaPagesConfigured()) return { ok: false, error: "not_configured", pages: [] };
  const qs = new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, code });
  // wave 25: the full-page (no popup) flow must repeat the exact redirect_uri it used
  if (redirectUri) qs.set("redirect_uri", redirectUri);
  const tok = await g(`/oauth/access_token?${qs.toString()}`);
  let userToken = tok.data.access_token as string | undefined;
  if (!tok.ok || !userToken) return { ok: false, error: tok.error ?? "token_failed", pages: [] };
  // a long-lived user token → long-lived Page tokens (Business Login tokens usually already are)
  const ll = await g(`/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: userToken }).toString()}`);
  if (ll.ok && typeof ll.data.access_token === "string") userToken = ll.data.access_token;
  const pages = await g(`/me/accounts?fields=id,name,access_token,instagram_business_account%7Bid,username%7D&limit=50`, { token: userToken });
  if (!pages.ok) return { ok: false, error: pages.error, pages: [] };
  const list = ((pages.data.data as { id: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } }[] | undefined) ?? [])
    .filter((p) => /^\d{3,40}$/.test(p.id) && p.access_token)
    .map((p) => ({ id: p.id, name: (p.name ?? "").slice(0, 160), token: p.access_token!, instagram: p.instagram_business_account?.id ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null } : null }));
  return { ok: true, pages: list };
}

/** The app receives this Page's messages, echoes and comments. */
export async function subscribePage(pageId: string, pageToken: string): Promise<{ ok: boolean; error?: string }> {
  const fields = "messages,messaging_postbacks,message_echoes,messaging_referrals,feed";
  const r = await g(`/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=${fields}`, { method: "POST", token: pageToken });
  return { ok: r.ok, error: r.error };
}

export async function unsubscribePage(pageId: string, pageToken: string): Promise<void> {
  await g(`/${encodeURIComponent(pageId)}/subscribed_apps`, { method: "DELETE", token: pageToken });
}

/** The customer's display name (Messenger: first/last name, Instagram: name / @username). */
export async function metaProfileName(platform: SocialPlatform, userId: string, pageToken: string): Promise<string | null> {
  const fields = platform === "instagram" ? "name,username" : "first_name,last_name";
  const r = await g(`/${encodeURIComponent(userId)}?fields=${fields}`, { token: pageToken });
  if (!r.ok) return null;
  const d = r.data as { name?: string; username?: string; first_name?: string; last_name?: string };
  const n = platform === "instagram" ? d.name || (d.username ? `@${d.username}` : "") : `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
  return n ? n.slice(0, 160) : null;
}

/**
 * Sends a text (split to Meta's limits) with optional quick-reply buttons on the last part.
 * messaging_type RESPONSE inside the 24-hour window; a person's reply outside it uses the
 * HUMAN_AGENT tag (7 days, Messenger) — Meta rejects everything else (the guard blocks automated ones).
 */
export async function metaSendText(platform: SocialPlatform, pageToken: string, recipientId: string, text: string, opts: { buttons?: string[]; humanAgent?: boolean } = {}): Promise<ProviderResult> {
  const parts = splitForMeta(text, platform);
  let last: ProviderResult = { ok: false, error: "empty", permanent: true };
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const qr = isLast ? quickReplies(opts.buttons) : undefined;
    const body = {
      recipient: { id: recipientId },
      ...(opts.humanAgent && platform === "messenger" ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" }),
      message: { text: parts[i], ...(qr ? { quick_replies: qr } : {}) },
    };
    let r = await g(`/me/messages`, { method: "POST", token: pageToken, body });
    // a temporary Meta / network hiccup (5xx, timeout, code 1 / 2 / 4 / 17 / 32 / 613): one more try before giving up
    if (!r.ok && (r.status === 0 || r.status >= 500 || [1, 2, 4, 17, 32, 613].includes(Number(r.code)))) {
      await new Promise((res) => setTimeout(res, 1200));
      r = await g(`/me/messages`, { method: "POST", token: pageToken, body });
    }
    if (!r.ok) {
      console.error("meta send failed", JSON.stringify({ platform, status: r.status, code: r.code, error: (r.error ?? "").slice(0, 300) }));
      // outside the window: one retry as a person's reply (Messenger only)
      if (!opts.humanAgent && platform === "messenger" && (r.code === 10 || /window|24 hour|outside/i.test(r.error ?? ""))) {
        return metaSendText(platform, pageToken, recipientId, parts.slice(i).join("\n\n"), { ...opts, humanAgent: true });
      }
      return { ok: false, status: r.status, error: r.error ?? "meta_send_failed", permanent: r.status === 400 || r.status === 403 };
    }
    last = { ok: true, status: r.status, externalId: (r.data.message_id as string | undefined) ?? undefined };
  }
  return last;
}

/** "seen" / "typing…" in the customer's Messenger / Instagram while the agent answers. Cosmetic: never throws. */
export async function metaSenderAction(pageToken: string, recipientId: string, action: "typing_on" | "typing_off" | "mark_seen"): Promise<void> {
  if (!pageToken) return;
  await g(`/me/messages`, { method: "POST", token: pageToken, body: { recipient: { id: recipientId }, sender_action: action } }).catch(() => undefined);
}

export async function metaSendImage(platform: SocialPlatform, pageToken: string, recipientId: string, url: string): Promise<ProviderResult> {
  const r = await g(`/me/messages`, { method: "POST", token: pageToken, body: { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { attachment: { type: "image", payload: { url, is_reusable: true } } } } });
  return r.ok ? { ok: true, status: r.status, externalId: (r.data.message_id as string | undefined) ?? undefined } : { ok: false, status: r.status, error: r.error, permanent: r.status === 400 };
}

/** Public reply under a comment. */
export async function replyToComment(platform: "facebook" | "instagram", commentId: string, pageToken: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const path = platform === "instagram" ? `/${encodeURIComponent(commentId)}/replies` : `/${encodeURIComponent(commentId)}/comments`;
  const r = await g(path, { method: "POST", token: pageToken, body: { message: text.slice(0, 2000) } });
  return { ok: r.ok, id: (r.data.id as string | undefined) ?? undefined, error: r.error };
}

/** Private reply: one DM to the person who commented (opens a conversation in the inbox). */
export async function privateReplyToComment(commentId: string, pageToken: string, text: string): Promise<{ ok: boolean; error?: string; recipientId?: string }> {
  const r = await g(`/me/messages`, { method: "POST", token: pageToken, body: { recipient: { comment_id: commentId }, message: { text: text.slice(0, 990) } } });
  return { ok: r.ok, error: r.error, recipientId: (r.data.recipient_id as string | undefined) ?? undefined };
}

export async function hideComment(platform: "facebook" | "instagram", commentId: string, pageToken: string, hide = true): Promise<{ ok: boolean; error?: string }> {
  const r = platform === "instagram"
    ? await g(`/${encodeURIComponent(commentId)}?hide=${hide ? "true" : "false"}`, { method: "POST", token: pageToken })
    : await g(`/${encodeURIComponent(commentId)}?is_hidden=${hide ? "true" : "false"}`, { method: "POST", token: pageToken });
  return { ok: r.ok, error: r.error };
}

/** Publishes a post: Facebook Page (text or photo) / Instagram (photo required). */
export async function publishPost(input: { platform: "facebook" | "instagram"; pageId: string; igId?: string | null; pageToken: string; text: string; imageUrl?: string | null }): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (input.platform === "facebook") {
    const r = input.imageUrl
      ? await g(`/${encodeURIComponent(input.pageId)}/photos`, { method: "POST", token: input.pageToken, body: { url: input.imageUrl, caption: input.text.slice(0, 5000) } })
      : await g(`/${encodeURIComponent(input.pageId)}/feed`, { method: "POST", token: input.pageToken, body: { message: input.text.slice(0, 5000) } });
    return { ok: r.ok, id: (r.data.post_id as string | undefined) ?? (r.data.id as string | undefined), error: r.error };
  }
  if (!input.igId) return { ok: false, error: "instagram_not_connected" };
  if (!input.imageUrl) return { ok: false, error: "instagram_needs_image" };
  const c = await g(`/${encodeURIComponent(input.igId)}/media`, { method: "POST", token: input.pageToken, body: { image_url: input.imageUrl, caption: input.text.slice(0, 2200) } });
  const creation = c.data.id as string | undefined;
  if (!c.ok || !creation) return { ok: false, error: c.error ?? "media_failed" };
  // the container is usually ready at once; give it a moment when it is not
  for (let i = 0; i < 4; i++) {
    const p = await g(`/${encodeURIComponent(input.igId)}/media_publish`, { method: "POST", token: input.pageToken, body: { creation_id: creation } });
    if (p.ok) return { ok: true, id: p.data.id as string | undefined };
    if (!/not ready|in progress|9007/i.test(`${p.error} ${p.code}`)) return { ok: false, error: p.error };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, error: "instagram_media_not_ready" };
}

/* ---------------------------------------------------------------- wave 51 — rich posts: link card, button, video, first comment (additive) */

export interface RichPostInput {
  platform: "facebook" | "instagram";
  pageId: string;
  igId?: string | null;
  igUsername?: string | null;
  pageToken: string;
  text: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  linkUrl?: string | null;
  cta?: { type: string; value?: string | null } | null;
  firstComment?: string | null;
  lang: string;
}

/**
 * Publishes a post with the extras. Facebook: video (/videos), photo (/photos) or a link post (/feed with link +
 * call_to_action — retried without the native button, then as plain text, so the post always goes out).
 * Instagram: Reels for video (waits for processing), photo otherwise. Then the first comment (best effort).
 */
export async function publishRichPost(input: RichPostInput): Promise<{ ok: boolean; id?: string; error?: string; comment?: { ok: boolean; error?: string }; mode?: string }> {
  const { composeCaption, fbCallToAction, isCtaType, ctaUrl } = await import("@/lib/social/post-core");
  const cta = input.cta && isCtaType(input.cta.type) ? { type: input.cta.type, value: input.cta.value ?? null } : null;
  const link = (input.linkUrl ?? "").trim() || null;
  const base = { body: input.text, link, cta, lang: input.lang, pageId: input.pageId, igUsername: input.igUsername ?? null };
  let result: { ok: boolean; id?: string; error?: string; mode?: string };

  if (input.platform === "facebook") {
    const page = encodeURIComponent(input.pageId);
    if (input.videoUrl) {
      const r = await g(`/${page}/videos`, { method: "POST", token: input.pageToken, body: { file_url: input.videoUrl, description: composeCaption({ ...base, platform: "facebook" }) } });
      result = { ok: r.ok, id: r.data.id as string | undefined, error: r.error, mode: "video" };
    } else if (input.imageUrl) {
      const r = await g(`/${page}/photos`, { method: "POST", token: input.pageToken, body: { url: input.imageUrl, caption: composeCaption({ ...base, platform: "facebook" }) } });
      result = { ok: r.ok, id: (r.data.post_id as string | undefined) ?? (r.data.id as string | undefined), error: r.error, mode: "photo" };
    } else {
      const ctaLink = cta ? ctaUrl(cta, { pageId: input.pageId, platform: "facebook" }) : null;
      const cardLink = link ?? (ctaLink && /^https?:/.test(ctaLink) ? ctaLink : null);
      const native = cta ? fbCallToAction(cta, cardLink, input.pageId) : null;
      // 1) link card + native button
      let r = cardLink && native
        ? await g(`/${page}/feed`, { method: "POST", token: input.pageToken, body: { message: composeCaption({ ...base, platform: "facebook", linkAttached: Boolean(link), ctaAttached: true }), link: cardLink, call_to_action: native } })
        : null;
      let mode = "link+cta";
      // 2) link card, button as text
      if (!r?.ok && cardLink) {
        mode = "link";
        r = await g(`/${page}/feed`, { method: "POST", token: input.pageToken, body: { message: composeCaption({ ...base, platform: "facebook", linkAttached: Boolean(link) }), link: cardLink } });
      }
      // 3) plain text with everything written in
      if (!r?.ok) {
        mode = "text";
        r = await g(`/${page}/feed`, { method: "POST", token: input.pageToken, body: { message: composeCaption({ ...base, platform: "facebook" }) } });
      }
      result = { ok: r.ok, id: (r.data.post_id as string | undefined) ?? (r.data.id as string | undefined), error: r.error, mode };
    }
  } else {
    if (!input.igId) return { ok: false, error: "instagram_not_connected" };
    const ig = encodeURIComponent(input.igId);
    const caption = composeCaption({ ...base, platform: "instagram" });
    if (input.videoUrl) {
      const c = await g(`/${ig}/media`, { method: "POST", token: input.pageToken, body: { media_type: "REELS", video_url: input.videoUrl, caption, share_to_feed: true } });
      const creation = c.data.id as string | undefined;
      if (!c.ok || !creation) return { ok: false, error: c.error ?? "media_failed" };
      // videos need processing on Meta's side: wait up to ~50s
      let status = "IN_PROGRESS";
      for (let i = 0; i < 17 && status === "IN_PROGRESS"; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await g(`/${encodeURIComponent(creation)}?fields=status_code`, { token: input.pageToken });
        status = String(s.data.status_code ?? (s.ok ? "IN_PROGRESS" : "ERROR"));
      }
      if (status !== "FINISHED") return { ok: false, error: status === "IN_PROGRESS" ? "instagram_media_not_ready" : `instagram_video_${status.toLowerCase()}` };
      const p = await g(`/${ig}/media_publish`, { method: "POST", token: input.pageToken, body: { creation_id: creation } });
      result = { ok: p.ok, id: p.data.id as string | undefined, error: p.error, mode: "reel" };
    } else if (input.imageUrl) {
      const r = await publishPost({ platform: "instagram", pageId: input.pageId, igId: input.igId, pageToken: input.pageToken, text: caption, imageUrl: input.imageUrl });
      result = { ...r, mode: "photo" };
    } else {
      return { ok: false, error: "instagram_needs_image" };
    }
  }

  // first comment (best effort — the post itself already succeeded)
  const comment = (input.firstComment ?? "").trim();
  if (result.ok && result.id && comment) {
    const c = await g(`/${encodeURIComponent(result.id)}/comments`, { method: "POST", token: input.pageToken, body: { message: comment.slice(0, input.platform === "instagram" ? 2200 : 8000) } });
    return { ...result, comment: { ok: c.ok, error: c.error } };
  }
  return result;
}
