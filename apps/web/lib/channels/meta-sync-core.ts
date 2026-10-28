import type { PageComment, PageMessage, SocialPlatform } from "./meta-pages-core";

/**
 * Wave 41 — Meta inbound safety net (pure, unit-tested).
 * Webhooks are the fast path. When Meta does not deliver them (app in development mode, webhook not
 * configured, a dropped Page subscription) this turns Graph API "read" responses into the same
 * PageMessage / PageComment shapes the webhook produces, so ONE pipeline handles both.
 */

/** the webhook fields a Page must be subscribed to for messages + comments */
export const REQUIRED_PAGE_FIELDS = ["messages", "feed"] as const;

/** comments / messages older than this are never picked up by the poller (avoids answering stale threads) */
export const POLL_COMMENT_WINDOW_MS = 12 * 3_600_000;
export const POLL_MESSAGE_WINDOW_MS = 3 * 3_600_000;

interface RawSubscribedApps {
  data?: { id?: string | number; subscribed_fields?: string[] }[];
}

/** Which required fields this app is NOT subscribed to on the Page (everything when the app is absent). */
export function missingPageFields(json: unknown, appId: string, required: readonly string[] = REQUIRED_PAGE_FIELDS): string[] {
  const list = (json as RawSubscribedApps | null)?.data ?? [];
  const mine = list.find((a) => String(a.id ?? "") === appId);
  if (!mine) return [...required];
  const have = new Set((mine.subscribed_fields ?? []).map(String));
  return required.filter((f) => !have.has(f));
}

const ts = (v: unknown): number => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

interface RawFrom {
  id?: string;
  name?: string;
  username?: string;
}

/* ---------------------------------------------------------------- Facebook comments */
interface RawFbComment {
  id?: string;
  message?: string;
  created_time?: string;
  from?: RawFrom;
  parent?: { id?: string };
}
interface RawFbPosts {
  data?: { id?: string; comments?: { data?: RawFbComment[] } }[];
}

export function commentsFromPosts(pageId: string, json: unknown, sinceMs: number): PageComment[] {
  const out: PageComment[] = [];
  for (const post of (json as RawFbPosts | null)?.data ?? []) {
    for (const c of post.comments?.data ?? []) {
      if (!c.id || !c.message?.trim()) continue;
      if (ts(c.created_time) < sinceMs) continue;
      if (c.from?.id === pageId) continue; // the page's own replies
      out.push({
        platform: "facebook",
        accountId: pageId,
        commentId: String(c.id).slice(0, 120),
        postId: post.id ? String(post.id).slice(0, 120) : null,
        parentId: c.parent?.id && c.parent.id !== post.id ? String(c.parent.id).slice(0, 120) : null,
        authorId: c.from?.id ?? null,
        authorName: c.from?.name ? c.from.name.slice(0, 160) : null,
        text: c.message.slice(0, 8000),
        verb: "add",
      });
    }
  }
  return out.sort((a, b) => a.commentId.localeCompare(b.commentId));
}

/* ---------------------------------------------------------------- Instagram comments */
interface RawIgComment {
  id?: string;
  text?: string;
  timestamp?: string;
  username?: string;
  parent_id?: string;
}
interface RawIgMedia {
  data?: { id?: string; comments?: { data?: RawIgComment[] } }[];
}

export function commentsFromIgMedia(igId: string, ownUsername: string | null | undefined, json: unknown, sinceMs: number): PageComment[] {
  const own = (ownUsername ?? "").replace(/^@/, "").toLowerCase();
  const out: PageComment[] = [];
  for (const media of (json as RawIgMedia | null)?.data ?? []) {
    for (const c of media.comments?.data ?? []) {
      if (!c.id || !c.text?.trim()) continue;
      if (ts(c.timestamp) < sinceMs) continue;
      if (own && (c.username ?? "").toLowerCase() === own) continue; // the account's own replies
      out.push({
        platform: "instagram",
        accountId: igId,
        commentId: String(c.id).slice(0, 120),
        postId: media.id ? String(media.id).slice(0, 120) : null,
        parentId: c.parent_id ? String(c.parent_id).slice(0, 120) : null,
        authorId: null,
        authorName: c.username ? c.username.slice(0, 160) : null,
        text: c.text.slice(0, 8000),
        verb: "add",
      });
    }
  }
  return out.sort((a, b) => a.commentId.localeCompare(b.commentId));
}

/* ---------------------------------------------------------------- direct messages */
interface RawConvMessage {
  id?: string;
  message?: string;
  created_time?: string;
  from?: RawFrom;
}
interface RawConversations {
  data?: { id?: string; messages?: { data?: RawConvMessage[] } }[];
}

export interface PolledMessage extends PageMessage {
  /** display name of the customer when Meta gave one */
  senderName: string | null;
  createdAt: number;
}

/**
 * Customer messages that are still UNANSWERED: from the newest message back to the first one the
 * business sent (the owner, the agent or the phone). A thread whose last message is ours yields
 * nothing — so a message somebody already answered is never answered a second time.
 * Oldest first, so the conversation is rebuilt in order.
 */
export function messagesFromConversations(platform: SocialPlatform, accountId: string, selfIds: string[], json: unknown, sinceMs: number): PolledMessage[] {
  const self = new Set([accountId, ...selfIds].filter(Boolean));
  const out: PolledMessage[] = [];
  for (const conv of (json as RawConversations | null)?.data ?? []) {
    const msgs = [...(conv.messages?.data ?? [])].sort((a, b) => ts(b.created_time) - ts(a.created_time));
    for (const m of msgs) {
      const fromId = m.from?.id ?? "";
      if (!fromId || self.has(fromId)) break; // reached something the business sent → everything older is answered
      const created = ts(m.created_time);
      const text = (m.message ?? "").trim();
      if (!m.id || !text) continue;
      if (created < sinceMs) break;
      out.push({
        platform,
        accountId,
        senderId: fromId,
        mid: String(m.id).slice(0, 200),
        text: text.slice(0, 8000),
        echo: false,
        echoAppId: null,
        media: null,
        postback: null,
        referral: null,
        senderName: (m.from?.name ?? m.from?.username ?? "").slice(0, 160) || null,
        createdAt: created,
      });
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}
