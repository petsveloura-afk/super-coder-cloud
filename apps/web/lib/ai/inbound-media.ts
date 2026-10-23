import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount, loadAccountByToken, type Kind } from "@/lib/channels/accounts";
import { describeImage, readDocument, telegramFile, transcribeAudio, whatsappMedia } from "./media";

/**
 * Wave 16 — a customer sent a voice note or a picture: get the file from the channel
 * (bridge data, Telegram getFile, WhatsApp Cloud media), turn it into text (transcript /
 * description), store it on the message (body + meta.transcript / meta.vision) so the
 * team sees it in the inbox, and return the text the AI agent answers. Metered as AI
 * credits ("transcribe" / "vision"). Never throws.
 */
export interface InboundMediaRef {
  type: string;
  data?: string;
  mime?: string;
  file_id?: string;
  media_id?: string;
  name?: string;
  /** wave 19: Messenger / Instagram attachments come as a short-lived https URL */
  url?: string;
}

export const isAudio = (t: string | undefined) => t === "audio" || t === "voice" || t === "ptt";
export const isImage = (t: string | undefined) => t === "image" || t === "photo" || t === "sticker_image";
/** Wave 16: a document the agent can read (PDF; plain text). Other files stay "attachment". */
export const isReadableDoc = (t: string | undefined, mime?: string, name?: string) =>
  t === "document" && (/^application\/pdf|^text\/plain/.test(mime ?? "") || /\.(pdf|txt)$/i.test(name ?? ""));

export function mediaUnderstandable(m: InboundMediaRef | null | undefined): boolean {
  if (!m) return false;
  if (!isAudio(m.type) && !isImage(m.type) && !isReadableDoc(m.type, m.mime, m.name)) return false;
  return Boolean(m.data || m.file_id || m.media_id || (m.url && /^https:\/\//.test(m.url)));
}

/** The DB copy of the media reference (never the file bytes). */
export function mediaForStorage(m: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!m) return null;
  const { data: _drop, ...rest } = m as Record<string, unknown> & { data?: unknown };
  void _drop;
  return rest;
}

export async function understandInboundMedia(input: { kind: Kind; token: string; conversationId: string; messageId: string; media: InboundMediaRef; caption: string }): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data: conv } = await admin.from("conversations").select("organization_id").eq("id", input.conversationId).maybeSingle();
    if (!conv) return null;
    const orgId = conv.organization_id as string;
    let file: { buf: Buffer; mime: string } | null = null;
    if (input.media.data) {
      const buf = Buffer.from(input.media.data, "base64");
      file = { buf, mime: input.media.mime ?? (isAudio(input.media.type) ? "audio/ogg" : isReadableDoc(input.media.type, input.media.mime, input.media.name) ? "application/pdf" : "image/jpeg") };
    } else if (input.media.file_id && (input.kind === "telegram" || input.kind === "telegram_user")) {
      const acc = (await loadAccountByToken("telegram", input.token).catch(() => null)) ?? (await loadAccount(orgId, "telegram"));
      if (acc?.secrets.bot_token) file = await telegramFile(acc.secrets.bot_token, input.media.file_id);
    } else if (input.media.media_id && input.kind === "whatsapp") {
      const acc = await loadAccount(orgId, "whatsapp");
      if (acc?.secrets.access_token) file = await whatsappMedia(acc.secrets.access_token, input.media.media_id);
    }
    if (!file && input.media.url && /^https:\/\//.test(input.media.url)) {
      // wave 19: Meta CDN attachment (Messenger / Instagram) — downloaded once, never stored
      file = await fetchMediaUrl(input.media.url, input.media.mime);
    }
    if (!file) return null;
    const isDoc = isReadableDoc(input.media.type, input.media.mime ?? file.mime, input.media.name);
    if (isDoc && file.mime === "application/octet-stream") file = { ...file, mime: /\.txt$/i.test(input.media.name ?? "") ? "text/plain" : "application/pdf" };
    const feature = isAudio(input.media.type) ? "transcribe" : "vision";
    const { data: usageId, error: reserveError } = await admin.rpc("reserve_ai_credits_system", { p_org: orgId, p_feature: feature, p_agent: null });
    if (reserveError || usageId == null) return null;
    const { data: agent } = await admin.from("ai_agents").select("language").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle();
    const locale = (agent?.language as string | undefined) ?? "he";
    const r = feature === "transcribe" ? await transcribeAudio(file.buf, file.mime, locale) : isDoc ? await readDocument(file.buf, file.mime, locale, input.media.name) : await describeImage(file.buf, file.mime, locale);
    await admin.rpc("finalize_ai_usage_system", { p_usage_id: usageId, p_provider: r?.provider ?? "none", p_model: r?.model ?? "none", p_input: Math.ceil(file.buf.length / 4000), p_output: Math.ceil((r?.text.length ?? 0) / 4), p_ok: Boolean(r) });
    if (!r?.text) return null;
    const text = r.text.slice(0, 3000);
    const { data: msg } = await admin.from("messages").select("body, meta").eq("id", input.messageId).maybeSingle();
    const meta = { ...((msg?.meta as Record<string, unknown> | null) ?? {}), ...(feature === "transcribe" ? { transcript: text } : isDoc ? { document_text: text } : { vision: text }) };
    const icon = feature === "transcribe" ? "🎙️" : isDoc ? "📄" : "🖼️";
    const body = feature === "transcribe" ? (input.caption ? `${input.caption}\n🎙️ ${text}` : text) : input.caption ? `${input.caption}\n[${icon} ${text}]` : `[${icon} ${text}]`;
    await admin.from("messages").update({ body: body.slice(0, 8000), meta }).eq("id", input.messageId);
    await admin.from("conversations").update({ last_message_preview: `${icon} ${text}`.slice(0, 200) }).eq("id", input.conversationId);
    return body;
  } catch (e) {
    console.error("inbound media failed", (e as Error).message);
    return null;
  }
}

/** wave 19: downloads an https attachment (≤ 6 MB). */
async function fetchMediaUrl(url: string, mime?: string): Promise<{ buf: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 6 * 1024 * 1024) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 6 * 1024 * 1024) return null;
    return { buf, mime: mime ?? res.headers.get("content-type") ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
