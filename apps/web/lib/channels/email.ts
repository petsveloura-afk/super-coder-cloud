import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type AddressObject } from "mailparser";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAutomatedEmail } from "@/lib/ai/autopilot-core";
import { loadAccount, markAccountError, type LoadedAccount } from "./accounts";
import { ingest } from "./ingest";
import type { ProviderResult } from "./providers";
import { renderEmailHtml, replySubject, stripQuotedReply, threadHeaders } from "./email-core";

/**
 * E-mail channel: the business connects its own mailbox (Gmail / Outlook with
 * one click via OAuth, or any provider with an app password). New e-mails are
 * read over IMAP every minute or few (cron) and land in the inbox; answers —
 * by the team or by the AI agent — are sent over SMTP from the same address,
 * threaded under the customer's e-mail.
 *
 * config:  address, display_name, auth (password|google|microsoft), imap_host, imap_port,
 *          smtp_host, smtp_port, uid_validity, last_uid, last_poll_at
 * secrets: password | refresh_token
 */

export interface MailboxConfig {
  address: string;
  display_name?: string;
  auth: "password" | "google" | "microsoft";
  imap_host: string;
  imap_port: number | string;
  smtp_host: string;
  smtp_port: number | string;
}

const TIMEOUT = 20_000;

/* ------------------------------------------------------------ OAuth tokens */

export async function refreshAccessToken(auth: "google" | "microsoft", refreshToken: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  const google = auth === "google";
  const url = google
    ? (process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token")
    : (process.env.MICROSOFT_OAUTH_TOKEN_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: (google ? process.env.GOOGLE_CLIENT_ID : process.env.MICROSOFT_CLIENT_ID) ?? "",
    client_secret: (google ? process.env.GOOGLE_CLIENT_SECRET : process.env.MICROSOFT_CLIENT_SECRET) ?? "",
  });
  if (!google) body.set("scope", "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access");
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(TIMEOUT) });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !j.access_token) return { ok: false, error: `${j.error ?? res.status}${j.error_description ? `: ${j.error_description}` : ""}`.slice(0, 300) };
    return { ok: true, token: j.access_token };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function authFor(cfg: MailboxConfig, secrets: Record<string, string>): Promise<{ user: string; pass?: string; accessToken?: string }> {
  if (cfg.auth === "google" || cfg.auth === "microsoft") {
    const t = await refreshAccessToken(cfg.auth, secrets.refresh_token ?? "");
    if (!t.ok || !t.token) throw new Error(`oauth_refresh_failed: ${t.error ?? ""}`);
    return { user: cfg.address, accessToken: t.token };
  }
  return { user: cfg.address, pass: secrets.password ?? "" };
}

function imapClient(cfg: MailboxConfig, auth: { user: string; pass?: string; accessToken?: string }) {
  const port = Number(cfg.imap_port) || 993;
  return new ImapFlow({
    host: cfg.imap_host,
    port,
    secure: port === 993,
    auth,
    logger: false,
    socketTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    connectionTimeout: TIMEOUT,
  });
}

function smtpTransport(cfg: MailboxConfig, auth: { user: string; pass?: string; accessToken?: string }) {
  const port = Number(cfg.smtp_port) || 465;
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: auth.accessToken ? { type: "OAuth2", user: auth.user, accessToken: auth.accessToken } : { user: auth.user, pass: auth.pass ?? "" },
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: TIMEOUT,
  });
}

/** Verifies IMAP + SMTP before the mailbox is saved. Returns the current UID state (only new mail is read). */
export async function verifyMailbox(cfg: MailboxConfig, secrets: Record<string, string>): Promise<{ ok: boolean; error?: string; step?: "imap" | "smtp"; uid_validity?: string; last_uid?: number }> {
  let auth: Awaited<ReturnType<typeof authFor>>;
  try {
    auth = await authFor(cfg, secrets);
  } catch (e) {
    return { ok: false, step: "imap", error: (e as Error).message };
  }
  const client = imapClient(cfg, auth);
  let uid_validity: string | undefined;
  let last_uid: number | undefined;
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    uid_validity = String(box.uidValidity);
    last_uid = Math.max(0, (box.uidNext ?? 1) - 1);
    await client.logout();
  } catch (e) {
    client.close();
    return { ok: false, step: "imap", error: ((e as { responseText?: string }).responseText || (e as Error).message || "imap_failed").slice(0, 300) };
  }
  try {
    await smtpTransport(cfg, auth).verify();
  } catch (e) {
    return { ok: false, step: "smtp", error: ((e as Error).message || "smtp_failed").slice(0, 300) };
  }
  return { ok: true, uid_validity, last_uid };
}

function firstAddress(a: AddressObject | AddressObject[] | undefined): { address: string; name: string } | null {
  const obj = Array.isArray(a) ? a[0] : a;
  const v = obj?.value?.[0];
  if (!v?.address) return null;
  return { address: v.address.toLowerCase(), name: v.name ?? "" };
}

/** Reads new e-mails of one mailbox (UID > last_uid) and stores them in the inbox. */
export async function pollMailbox(acc: LoadedAccount, maxMessages = 15): Promise<{ ingested: number; error?: string }> {
  const cfg = acc.config as unknown as MailboxConfig & { uid_validity?: string; last_uid?: string | number };
  const admin = createAdminClient();
  let auth: Awaited<ReturnType<typeof authFor>>;
  try {
    auth = await authFor(cfg, acc.secrets);
  } catch (e) {
    await markAccountError(acc.id, (e as Error).message.slice(0, 300));
    return { ingested: 0, error: (e as Error).message };
  }
  const client = imapClient(cfg, auth);
  let ingested = 0;
  let lastUid = Number(cfg.last_uid ?? 0) || 0;
  let uidValidity = cfg.uid_validity ?? "";
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    const currentValidity = String(box.uidValidity);
    if (uidValidity && uidValidity !== currentValidity) {
      // mailbox was rebuilt: start from "now" again instead of re-importing everything
      lastUid = Math.max(0, (box.uidNext ?? 1) - 1);
    }
    uidValidity = currentValidity;
    const next = box.uidNext ?? 1;
    if (next - 1 > lastUid) {
      const from = Math.max(lastUid + 1, next - maxMessages);
      for await (const msg of client.fetch(`${from}:*`, { uid: true, source: true }, { uid: true })) {
        if (!msg.uid || msg.uid <= lastUid || !msg.source) continue;
        lastUid = Math.max(lastUid, msg.uid);
        const parsed = await simpleParser(msg.source);
        const sender = firstAddress(parsed.from);
        if (!sender || sender.address === cfg.address.toLowerCase()) continue;
        const headers: Record<string, string> = {};
        for (const [k, v] of parsed.headers) headers[k] = typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : JSON.stringify(v);
        const automated = isAutomatedEmail({ from: sender.address, headers });
        const body = stripQuotedReply(parsed.text || (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "") || "");
        const references = Array.isArray(parsed.references) ? parsed.references.join(" ") : (parsed.references ?? "");
        await ingest({
          kind: "email",
          token: acc.webhook_token,
          chatId: sender.address,
          senderName: sender.name || null,
          email: sender.address,
          text: body,
          subject: parsed.subject ?? null,
          externalMessageId: parsed.messageId ?? `uid:${uidValidity}:${msg.uid}`,
          media: parsed.attachments?.length ? { type: "attachments", count: parsed.attachments.length, names: parsed.attachments.slice(0, 5).map((a) => a.filename ?? "") } : null,
          meta: { message_id: parsed.messageId ?? null, references: references || null, in_reply_to: parsed.inReplyTo ?? null, automated },
          autoReply: !automated,
        });
        ingested++;
      }
    }
    await client.logout();
  } catch (e) {
    client.close();
    const message = ((e as { responseText?: string }).responseText || (e as Error).message || "imap_failed").slice(0, 300);
    if (/auth|credential|login|invalid/i.test(message)) await markAccountError(acc.id, message);
    return { ingested, error: message };
  } finally {
    await admin
      .from("channel_accounts")
      .update({ config: { ...acc.config, uid_validity: uidValidity, last_uid: String(lastUid), last_poll_at: new Date().toISOString() } })
      .eq("id", acc.id);
  }
  return { ingested };
}

/** Cron: polls every connected mailbox (sequentially, within a time budget). */
export async function pollAllMailboxes(budgetMs = 45_000): Promise<{ mailboxes: number; ingested: number; errors: number }> {
  const admin = createAdminClient();
  const started = Date.now();
  const { data } = await admin.from("channel_accounts").select("organization_id, config").eq("kind", "email").neq("status", "disabled").limit(500);
  const rows = ((data ?? []) as { organization_id: string; config: Record<string, string> }[]).sort((a, b) => String(a.config.last_poll_at ?? "").localeCompare(String(b.config.last_poll_at ?? "")));
  let ingested = 0;
  let errors = 0;
  let mailboxes = 0;
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break;
    const acc = await loadAccount(r.organization_id, "email").catch(() => null);
    if (!acc) continue;
    mailboxes++;
    const res = await pollMailbox(acc);
    ingested += res.ingested;
    if (res.error) errors++;
  }
  return { mailboxes, ingested, errors };
}

/** Sends an answer from the business's own mailbox, threaded under the customer's last e-mail. */
export async function sendEmailReply(acc: LoadedAccount, toAddress: string, text: string, conversationId?: string): Promise<ProviderResult> {
  const cfg = acc.config as unknown as MailboxConfig;
  const admin = createAdminClient();
  let subject: string | null = null;
  let meta: { message_id?: string | null; references?: string | null } = {};
  if (conversationId) {
    const [{ data: conv }, { data: last }] = await Promise.all([
      admin.from("conversations").select("subject").eq("id", conversationId).maybeSingle(),
      admin.from("messages").select("meta").eq("conversation_id", conversationId).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    subject = (conv?.subject as string | null) ?? null;
    meta = (last?.meta as typeof meta | null) ?? {};
  }
  try {
    const auth = await authFor(cfg, acc.secrets);
    const info = await smtpTransport(cfg, auth).sendMail({
      from: cfg.display_name ? { name: cfg.display_name, address: cfg.address } : cfg.address,
      to: toAddress,
      subject: replySubject(subject),
      text,
      html: renderEmailHtml(text, { brand: cfg.display_name || undefined }),
      headers: threadHeaders(meta),
    });
    return { ok: true, externalId: (info.messageId as string | undefined) ?? undefined };
  } catch (e) {
    const message = ((e as Error).message || "smtp_failed").slice(0, 300);
    return { ok: false, error: message, permanent: /auth|invalid|535|534/i.test(message) };
  }
}
