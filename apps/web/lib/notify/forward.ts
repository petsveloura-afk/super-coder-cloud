import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { notifyEmailHtml, notifySubject, notifyTelegramHtml, notifyText, type NotifyEvent, type NotifyPayload } from "./format";
import { CATCHUP_GRACE_MS, CATCHUP_WINDOW_MS, MAX_ATTEMPTS, STUCK_PENDING_MS, catchUpAction, isUuid, nextRetryAt } from "./deliveries-core";

/**
 * Sends a team update (conversation the agent handled, new lead, handoff) to
 * every recipient the business invited: e-mail, Telegram (the business's own
 * bot), WhatsApp (QR bridge or official API) or SMS (Twilio). Never throws.
 */
export interface RecipientRow {
  id: string;
  /** wave 60: "call" = the phone agent's transfer number (urgent calls job) — never a text update */
  kind: "email" | "telegram" | "whatsapp" | "sms" | "call";
  target: string | null;
  label: string | null;
  events: string[];
}

export function inboxLink(conversationId?: string | null) {
  const base = publicEnv.appUrl.replace(/\/$/, "");
  return conversationId ? `${base}/he/inbox?c=${conversationId}` : `${base}/he/inbox`;
}

export async function sendToRecipient(orgId: string, r: RecipientRow, event: NotifyEvent, payload: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
  if (!r.target) return { ok: false, error: "not_linked" };
  if (r.kind === "call") return { ok: true }; // wave 60: handled by the urgent-calls job, not a text message
  try {
    if (r.kind === "email") {
      const { sendEmail } = await import("@/lib/email/send");
      const res = await sendEmail({ to: r.target, subject: notifySubject(event, payload), html: notifyEmailHtml(event, payload), text: notifyText(event, payload), orgId });
      if (res.sent) return { ok: true };
      // wave 61: the platform's email service could not deliver → send from the business's own connected mailbox
      try {
        const { loadAccount: loadMailbox } = await import("@/lib/channels/accounts");
        const box = await loadMailbox(orgId, "email");
        if (box && box.status !== "disabled") {
          const { sendMailboxEmail } = await import("@/lib/channels/email");
          const viaBox = await sendMailboxEmail(box, r.target, notifySubject(event, payload), notifyText(event, payload), notifyEmailHtml(event, payload));
          if (viaBox.ok) return { ok: true };
        }
      } catch {
        /* keep the original error below */
      }
      return { ok: false, error: res.reason === "not_configured" ? "email_not_configured" : "email_failed" };
    }
    const { loadAccount } = await import("@/lib/channels/accounts");
    if (r.kind === "telegram") {
      const acc = await loadAccount(orgId, "telegram");
      if (!acc?.secrets.bot_token) return { ok: false, error: "telegram_bot_not_connected" };
      const { telegramCall } = await import("@/lib/channels/providers");
      const res = await telegramCall(acc.secrets.bot_token, "sendMessage", { chat_id: r.target, text: notifyTelegramHtml(event, payload), parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? "telegram_failed" };
    }
    if (r.kind === "whatsapp") {
      const qr = await loadAccount(orgId, "whatsapp_qr");
      let qrError = "";
      if (qr) {
        const { bridgeSend } = await import("@/lib/channels/wa-bridge");
        const res = await bridgeSend(qr, r.target, notifyText(event, payload));
        if (res.ok) return { ok: true };
        qrError = String(res.error ?? "qr_failed");
      }
      const wa = await loadAccount(orgId, "whatsapp");
      if (!wa) return { ok: false, error: qrError ? `qr: ${qrError}`.slice(0, 300) : "whatsapp_not_connected" };
      const { whatsappSendText } = await import("@/lib/channels/providers");
      let res = await whatsappSendText(wa.secrets.access_token ?? "", wa.config.phone_number_id ?? "", r.target, notifyText(event, payload));
      // wave 60: the number was never registered on WhatsApp Cloud API → register once and retry
      const { isNotRegistered, ensureRegistered } = await import("@/lib/channels/wa-register");
      if (!res.ok && isNotRegistered(res.error) && (await ensureRegistered(wa)).ok) res = await whatsappSendText(wa.secrets.access_token ?? "", wa.config.phone_number_id ?? "", r.target, notifyText(event, payload));
      // wave 61: keep BOTH reasons (QR + official) so the screen can say exactly what to fix
      return res.ok ? { ok: true } : { ok: false, error: `${res.error ?? "whatsapp_failed"}${qrError ? ` | qr: ${qrError}` : ""}`.slice(0, 300) };
    }
    const sms = await loadAccount(orgId, "sms");
    if (!sms) {
      // wave 60: no own SMS account → the platform phone number sends the SMS (zero setup)
      const { twilioCredsForOrg } = await import("@/lib/voice/platform-phone");
      const cr = await twilioCredsForOrg(orgId).catch(() => null);
      if (!cr) return { ok: false, error: "sms_not_connected" };
      const { twilioSendSms } = await import("@/lib/channels/providers");
      const res = await twilioSendSms(cr.sid, cr.token, cr.from, r.target, notifyText(event, payload, { short: true }));
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? "sms_failed" };
    }
    const { twilioSendSms } = await import("@/lib/channels/providers");
    const res = await twilioSendSms(sms.config.account_sid ?? "", sms.secrets.auth_token ?? "", sms.config.from_number ?? "", r.target, notifyText(event, payload, { short: true }));
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? "sms_failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message?.slice(0, 200) ?? "failed" };
  }
}

export async function forwardToTeam(orgId: string, event: NotifyEvent, payload: Omit<NotifyPayload, "orgName"> & { orgName?: string; conversationId?: string | null; excludeTarget?: string | null; messageId?: string | null }): Promise<number> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 0;
    const admin = createAdminClient();
    const { data } = await admin
      .from("notify_recipients")
      .select("id, kind, target, label, events")
      .eq("organization_id", orgId)
      .eq("enabled", true)
      .not("target", "is", null)
      .neq("kind", "call") // wave 60: transfer numbers get urgent calls, not text updates
      .contains("events", [event])
      .limit(20);
    const rows = (data ?? []) as RecipientRow[];
    if (!rows.length) return 0;
    let orgName = payload.orgName;
    if (!orgName) {
      const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
      orgName = (org?.name as string | undefined) ?? "";
    }
    const full: NotifyPayload = { ...payload, orgName, link: payload.link ?? inboxLink(payload.conversationId) };
    let sent = 0;
    await Promise.all(
      rows
        .filter((r) => !payload.excludeTarget || r.target !== payload.excludeTarget)
        .map(async (r) => {
          // never-lost alerts (additive): about a customer message, every recipient gets ONE delivery record — a duplicate
          // (the normal path and the catch-up sweep) is skipped, a failure is retried later by the sweep
          const ledger = isUuid(payload.messageId) ? await openDelivery(admin, orgId, r.id, event, payload.messageId, payload.conversationId ?? null, full) : null;
          if (ledger === "duplicate") return;
          const res = await sendToRecipient(orgId, r, event, full);
          if (ledger) await closeDelivery(admin, ledger, res, 1);
          if (res.ok) sent++;
          await admin
            .from("notify_recipients")
            .update(res.ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: (res.error ?? "failed").slice(0, 300) })
            .eq("id", r.id);
          if (res.ok) await admin.rpc("notify_recipient_sent", { p_id: r.id }).then(() => undefined, () => undefined);
        }),
    );
    return sent;
  } catch (e) {
    console.error("team update failed", (e as Error).message);
    return 0;
  }
}

/** Fire-and-forget after the response (never delays the customer's answer). */
export function forwardLater(orgId: string, event: NotifyEvent, payload: Parameters<typeof forwardToTeam>[2]) {
  void forwardToTeam(orgId, event, payload);
}

/* ------------------------------------------------------------------ never-lost alerts (additive) */

type Admin = ReturnType<typeof createAdminClient>;

/** records the delivery before sending; "duplicate" when this recipient already has it; null when the ledger is unavailable (old behaviour) */
async function openDelivery(admin: Admin, orgId: string, recipientId: string, event: NotifyEvent, messageId: string, conversationId: string | null, payload: NotifyPayload): Promise<string | "duplicate" | null> {
  try {
    const { data, error } = await admin
      .from("notify_deliveries")
      .insert({ organization_id: orgId, recipient_id: recipientId, event, message_id: messageId, conversation_id: isUuid(conversationId) ? conversationId : null, payload, status: "pending" })
      .select("id")
      .maybeSingle();
    if (error) return error.code === "23505" ? "duplicate" : null;
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function closeDelivery(admin: Admin, id: string, res: { ok: boolean; error?: string }, attempts: number) {
  const next = res.ok ? null : nextRetryAt(attempts);
  await admin
    .from("notify_deliveries")
    .update(
      res.ok
        ? { status: "sent", attempts, sent_at: new Date().toISOString(), last_error: null }
        : { status: next ? "failed" : "gave_up", attempts, last_error: (res.error ?? "failed").slice(0, 300), next_at: (next ?? new Date()).toISOString() },
    )
    .eq("id", id)
    .then(() => undefined, () => undefined);
}

/** failed (or interrupted) deliveries that are due → sent again; never throws */
export async function retryNotifyDeliveries(budgetMs = 10_000): Promise<{ retried: number; sent: number }> {
  const started = Date.now();
  let retried = 0;
  let sent = 0;
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { retried, sent };
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const [{ data: failed }, { data: stuck }] = await Promise.all([
      admin.from("notify_deliveries").select("id, organization_id, recipient_id, event, payload, attempts, status").eq("status", "failed").lte("next_at", now).lt("attempts", MAX_ATTEMPTS).order("next_at").limit(20),
      admin.from("notify_deliveries").select("id, organization_id, recipient_id, event, payload, attempts, status").eq("status", "pending").lt("created_at", new Date(Date.now() - STUCK_PENDING_MS).toISOString()).limit(10),
    ]);
    for (const d of [...((failed ?? []) as DeliveryRow[]), ...((stuck ?? []) as DeliveryRow[])]) {
      if (Date.now() - started > budgetMs) break;
      // one runner per delivery (another instance may pick the same row)
      const { data: claimed } = await admin.from("notify_deliveries").update({ status: "pending", next_at: new Date(Date.now() + STUCK_PENDING_MS).toISOString() }).eq("id", d.id).eq("status", d.status).select("id").maybeSingle();
      if (!claimed) continue;
      const { data: r } = await admin.from("notify_recipients").select("id, kind, target, label, events, enabled").eq("id", d.recipient_id).maybeSingle();
      if (!r || !r.enabled || !r.target) {
        await admin.from("notify_deliveries").update({ status: "gave_up", last_error: "recipient_removed" }).eq("id", d.id);
        continue;
      }
      retried++;
      const res = await sendToRecipient(d.organization_id, r as RecipientRow, d.event as NotifyEvent, d.payload as unknown as NotifyPayload);
      await closeDelivery(admin, d.id, res, (d.attempts ?? 0) + 1);
      await admin
        .from("notify_recipients")
        .update(res.ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: (res.error ?? "failed").slice(0, 300) })
        .eq("id", r.id as string);
      if (res.ok) {
        sent++;
        await admin.rpc("notify_recipient_sent", { p_id: r.id }).then(() => undefined, () => undefined);
      }
    }
  } catch (e) {
    console.error("notify retry failed", (e as Error).message);
  }
  return { retried, sent };
}

interface DeliveryRow {
  id: string;
  organization_id: string;
  recipient_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  status: string;
}

/** customer messages whose alert was never attempted (the server ran out of time after the agent replied) → sent now; never throws */
export async function catchUpMissedAlerts(budgetMs = 10_000): Promise<{ checked: number; forwarded: number }> {
  const started = Date.now();
  let checked = 0;
  let forwarded = 0;
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { checked, forwarded };
    const admin = createAdminClient();
    const { data: recips } = await admin.from("notify_recipients").select("organization_id").eq("enabled", true).not("target", "is", null).contains("events", ["messages"]).limit(500);
    const orgs = [...new Set(((recips ?? []) as { organization_id: string }[]).map((r) => r.organization_id))].slice(0, 30);
    const now = Date.now();
    for (const orgId of orgs) {
      if (Date.now() - started > budgetMs) break;
      const { data: first } = await admin.from("notify_deliveries").select("created_at").eq("organization_id", orgId).order("created_at").limit(1).maybeSingle();
      if (!first) continue;
      const firstAt = Date.parse(first.created_at as string);
      const since = new Date(Math.max(now - CATCHUP_WINDOW_MS, firstAt)).toISOString();
      const until = new Date(now - CATCHUP_GRACE_MS).toISOString();
      const { data: ins } = await admin.from("messages").select("id, conversation_id, body, created_at").eq("organization_id", orgId).eq("direction", "in").gt("created_at", since).lt("created_at", until).order("created_at", { ascending: false }).limit(60);
      // the latest customer message of each conversation (earlier ones were folded into the same answer)
      const latest = new Map<string, { id: string; conversation_id: string; body: string; created_at: string }>();
      for (const m of (ins ?? []) as { id: string; conversation_id: string; body: string; created_at: string }[]) if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, m);
      for (const m of latest.values()) {
        if (Date.now() - started > budgetMs) break;
        checked++;
        const { data: had } = await admin.from("notify_deliveries").select("id").eq("organization_id", orgId).eq("message_id", m.id).eq("event", "messages").limit(1).maybeSingle();
        if (had) continue;
        const [{ data: conv }, { data: reply }, { data: later }] = await Promise.all([
          admin.from("conversations").select("id, channel, title, external_id, ai_mode").eq("id", m.conversation_id).maybeSingle(),
          admin.from("messages").select("body").eq("conversation_id", m.conversation_id).eq("direction", "out").not("ai_agent_id", "is", null).gt("created_at", m.created_at).order("created_at").limit(1).maybeSingle(),
          admin.from("messages").select("id").eq("conversation_id", m.conversation_id).eq("direction", "in").gt("created_at", m.created_at).limit(1).maybeSingle(),
        ]);
        if (!conv || later) continue;
        const act = catchUpAction({ messageAt: Date.parse(m.created_at), now, firstDeliveryAt: firstAt, hasDelivery: false, agentReplied: Boolean(reply?.body), aiMode: (conv.ai_mode as string | null) ?? null });
        if (act === "skip") continue;
        // counted once it is in the delivery ledger: a failed send is retried by retryNotifyDeliveries
        await forwardToTeam(orgId, "messages", {
          conversationId: m.conversation_id,
          customer: (conv.title as string | null) ?? null,
          channel: conv.channel as string,
          customerText: m.body,
          ...(act === "forward_reply" ? { agentText: reply?.body as string } : {}),
          excludeTarget: conv.channel === "telegram" ? String(conv.external_id).replace(/^biz:/, "") : null,
          messageId: m.id,
        });
        forwarded++;
      }
    }
  } catch (e) {
    console.error("notify catch-up failed", (e as Error).message);
  }
  return { checked, forwarded };
}
