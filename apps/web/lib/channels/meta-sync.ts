import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccountById } from "@/lib/social/accounts";
import { graphVersion } from "./meta";
import {
  POLL_COMMENT_WINDOW_MS,
  POLL_MESSAGE_WINDOW_MS,
  commentsFromIgMedia,
  commentsFromPosts,
  messagesFromConversations,
  missingPageFields,
  type PolledMessage,
} from "./meta-sync-core";
import type { PageComment } from "./meta-pages-core";

/**
 * Wave 41 — Facebook / Instagram inbound safety net.
 *
 * Posting works with the Page token, but customers' comments and messages only arrive when Meta
 * DELIVERS them (webhook configured in the Meta app, app live, Page subscribed). When any link
 * of that chain is missing nothing reaches the inbox and nothing is logged. Every few minutes this:
 *   1. checks the Page is subscribed to messages + feed and re-subscribes when it is not (idempotent)
 *   2. reads the latest comments of the Page / Instagram posts   → the same pipeline as the webhook
 *   3. reads the latest unanswered direct messages               → the same pipeline as the webhook
 * Everything is de-duplicated by Meta's own ids, so a message that DID arrive by webhook is never
 * stored or answered twice, and a thread somebody already answered is skipped.
 */
interface GraphResult {
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
  code?: number;
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}): Promise<GraphResult> {
  try {
    const base = (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${base}${path}${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
    return { ok: res.ok, data: j, error: j.error?.message ?? (res.ok ? undefined : `HTTP ${res.status}`), code: j.error?.code };
  } catch (e) {
    return { ok: false, data: {}, error: (e as Error).message };
  }
}

export interface MetaSyncResult {
  accounts: number;
  resubscribed: number;
  comments: number;
  messages: number;
  errors: number;
}

type AccRow = { id: string; organization_id: string; kind: "messenger" | "instagram"; config: Record<string, string> | null; webhook_token: string; last_error: string | null };

/** was this customer message already stored (by Meta's id — or, as a second guard, the same text recently)? */
async function alreadyStored(orgId: string, m: PolledMessage): Promise<boolean> {
  const admin = createAdminClient();
  const { data: conv } = await admin.from("conversations").select("id").eq("organization_id", orgId).eq("channel", m.platform).eq("external_id", m.senderId).maybeSingle();
  if (!conv) return false;
  const since = new Date(m.createdAt - 10 * 60_000).toISOString();
  const { data: byId } = await admin.from("messages").select("id").eq("conversation_id", conv.id as string).eq("external_id", m.mid.slice(0, 200)).limit(1).maybeSingle();
  if (byId) return true;
  const { data: byText } = await admin.from("messages").select("id").eq("conversation_id", conv.id as string).eq("direction", "in").eq("body", m.text.slice(0, 8000)).gte("created_at", since).limit(1).maybeSingle();
  return Boolean(byText);
}

/**
 * opts.orgId — only this business (the inbox asks for its own, every ~20s while it is open);
 * opts.fast  — direct messages only (1 Graph call per account): comments and the subscription check stay on the 5-minute sweep.
 */
export async function syncMetaInbound(budgetMs = 25_000, opts: { orgId?: string; fast?: boolean } = {}): Promise<MetaSyncResult> {
  const started = Date.now();
  const result: MetaSyncResult = { accounts: 0, resubscribed: 0, comments: 0, messages: 0, errors: 0 };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return result;
  const admin = createAdminClient();
  const accQuery = admin.from("channel_accounts").select("id, organization_id, kind, config, webhook_token, last_error").in("kind", ["messenger", "instagram"]).neq("status", "disabled");
  const { data } = await (opts.orgId ? accQuery.eq("organization_id", opts.orgId) : accQuery).order("updated_at", { ascending: true }).limit(60);
  const rows = (data ?? []) as AccRow[];
  const appId = process.env.META_APP_ID ?? "";
  const { handleSocialComment } = await import("@/lib/social/comments");
  const { ingest } = await import("./ingest");
  const { subscribePage } = await import("./meta-pages");

  const handleComments = async (acc: AccRow, list: PageComment[]) => {
    for (const c of list) {
      await handleSocialComment(acc.organization_id, acc.id, c).catch((e) => {
        result.errors++;
        console.error("meta sync comment failed", (e as Error).message);
      });
      result.comments++;
    }
  };
  const handleMessages = async (acc: AccRow, list: PolledMessage[]) => {
    for (const m of list) {
      try {
        if (await alreadyStored(acc.organization_id, m)) continue;
        await ingest({ kind: m.platform, token: acc.webhook_token, chatId: m.senderId, senderName: m.senderName ?? (m.platform === "instagram" ? "Instagram" : "Messenger"), text: m.text, externalMessageId: m.mid, media: null, meta: { polled: true } });
        result.messages++;
      } catch (e) {
        result.errors++;
        console.error("meta sync message failed", (e as Error).message);
      }
    }
  };

  for (const acc of rows) {
    if (Date.now() - started > budgetMs) break;
    const full = await loadAccountById(acc.id).catch(() => null);
    const token = full?.secrets.page_token ?? "";
    const cfg = acc.config ?? {};
    const pageId = cfg.page_id ?? "";
    const igId = cfg.ig_id ?? "";
    if (!token || !/^\d{3,40}$/.test(pageId)) continue;
    result.accounts++;
    const state: { problem: string | null } = { problem: null };
    const note = (what: string, r: GraphResult) => {
      result.errors++;
      state.problem ??= `sync: ${what} ${r.code ?? ""} ${r.error ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 480);
    };

    try {
      if (acc.kind === "messenger") {
        if (!opts.fast) {
        // 1. the Page must be subscribed to messages + feed — heal it when it is not
        const subs = await graphGet(`/${encodeURIComponent(pageId)}/subscribed_apps`, token);
        if (!subs.ok) note("subscribed_apps", subs);
        else if (appId && missingPageFields(subs.data, appId).length) {
          const fix = await subscribePage(pageId, token);
          if (fix.ok) result.resubscribed++;
          else state.problem ??= `subscribe: ${fix.error ?? ""}`.slice(0, 480);
        }
        // 2. comments under the Page's posts
        const posts = await graphGet(`/${encodeURIComponent(pageId)}/posts`, token, { fields: "id,created_time,comments.filter(stream).order(reverse_chronological).limit(40){id,message,created_time,from,parent}", limit: "10" });
        if (!posts.ok) note("comments", posts);
        else await handleComments(acc, commentsFromPosts(pageId, posts.data, Date.now() - POLL_COMMENT_WINDOW_MS));
        }
        // 3. unanswered Messenger messages
        const convs = await graphGet(`/${encodeURIComponent(pageId)}/conversations`, token, { platform: "messenger", fields: "id,updated_time,messages.limit(8){id,message,created_time,from}", limit: "15" });
        if (!convs.ok) note("messages", convs);
        else await handleMessages(acc, messagesFromConversations("messenger", pageId, [], convs.data, Date.now() - POLL_MESSAGE_WINDOW_MS));
      } else if (igId) {
        if (!opts.fast) {
        const media = await graphGet(`/${encodeURIComponent(igId)}/media`, token, { fields: "id,timestamp,comments.limit(40){id,text,timestamp,username,parent_id}", limit: "10" });
        if (!media.ok) note("instagram comments", media);
        else await handleComments(acc, commentsFromIgMedia(igId, cfg.username, media.data, Date.now() - POLL_COMMENT_WINDOW_MS));
        }
        const convs = await graphGet(`/${encodeURIComponent(pageId)}/conversations`, token, { platform: "instagram", fields: "id,updated_time,messages.limit(8){id,message,created_time,from}", limit: "15" });
        if (!convs.ok) note("instagram messages", convs);
        else await handleMessages(acc, messagesFromConversations("instagram", igId, [pageId], convs.data, Date.now() - POLL_MESSAGE_WINDOW_MS));
      }
    } catch (e) {
      result.errors++;
      state.problem ??= `sync: ${(e as Error).message}`.slice(0, 480);
    }

    // show what is wrong on the integration (and clear our own notes once everything works again)
    const prev = acc.last_error ?? "";
    const problem = state.problem;
    if (problem) {
      if (prev !== problem) await admin.from("channel_accounts").update({ last_error: problem, updated_at: new Date().toISOString() }).eq("id", acc.id);
    } else if (/^(sync|subscribe):/.test(prev)) {
      await admin.from("channel_accounts").update({ last_error: null, updated_at: new Date().toISOString() }).eq("id", acc.id);
    }
  }
  return result;
}
