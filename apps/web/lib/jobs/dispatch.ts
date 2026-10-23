import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, escapeHtml, sendEmail } from "@/lib/email/send";
import { assertPublicHttpsUrl } from "@/lib/net/safe-url";
import { sendViaChannel, type ChannelKind } from "@/lib/channels";
import "@/lib/channels/register";

/**
 * Job dispatcher — executes queued side effects created by the automation
 * engine and webhook subscriptions (migration 0016). At-least-once delivery:
 * claim (SKIP LOCKED) → run → complete_job() which retries with exponential
 * backoff and dead-letters after max_attempts. Safe to call concurrently from
 * Vercel Cron, the GitHub "jobs" workflow and after() hooks in server actions.
 */

interface JobRow {
  id: number;
  organization_id: string;
  kind: "email" | "webhook" | "http" | "whatsapp" | "telegram" | "sms" | "action" | "invoice" | "conversion" | "push" | "calendar" | "reminder" | "call";
  webhook_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts?: number;
  campaign_recipient_id?: string | null;
}

interface Outcome {
  ok: boolean;
  status?: number;
  error?: string;
  permanent?: boolean;
}

const TIMEOUT_MS = 10_000;

/** 4xx means "your request is wrong" — retrying will not help (except 408/409/425/429). */
function permanentHttp(status: number) {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

async function postJson(url: string, body: string, headers: Record<string, string>): Promise<Outcome> {
  try {
    await assertPublicHttpsUrl(url);
  } catch (e) {
    return { ok: false, error: (e as Error).message, permanent: true };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "SuperCoderCloud-Webhooks/1.0", ...headers },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}`, permanent: permanentHttp(res.status) };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message };
  }
}

/** Campaign messages: rendered per recipient, consent re-checked at send time, unsubscribe link added. */
async function runCampaignJob(admin: ReturnType<typeof createAdminClient>, job: JobRow): Promise<Outcome & { skipped?: boolean }> {
  const { data, error } = await admin.rpc("campaign_message", { p_recipient: job.campaign_recipient_id });
  if (error) return { ok: false, error: error.message };
  const m = data as { canceled?: boolean; skip?: boolean; channel: string; to: string | null; subject: string; body: string; contact_id: string; unsub_token: string; locale: string; wa_template?: { name: string; language: string; params: string[] } | null } | null;
  if (!m || m.canceled) return { ok: false, error: "campaign_canceled", permanent: true };
  if (m.skip) return { ok: false, error: "no_consent", permanent: true, skipped: true };
  // conversation guard: the customer opted out (STOP / הסר) on any channel
  {
    const { checkContact } = await import("@/lib/conversations/guard");
    const g = await checkContact(m.contact_id, "campaign");
    if (!g.allowed) return { ok: false, error: g.reason, permanent: true, skipped: true };
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const unsub = `${base}/${m.locale || "he"}/c/unsubscribe/${m.unsub_token}`;
  if (m.channel === "email") {
    if (!emailConfigured()) return { ok: false, error: "email_not_configured", permanent: true };
    if (!m.to) return { ok: false, error: "no_email", permanent: true };
    const dir = m.locale === "en" ? "ltr" : "rtl";
    const footer = { he: "להסרה מרשימת התפוצה", ar: "إلغاء الاشتراك", en: "Unsubscribe" }[m.locale as "he" | "ar" | "en"] ?? "Unsubscribe";
    const html = `<!doctype html><html dir="${dir}"><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.7;color:#111"><div style="max-width:600px;margin:0 auto;padding:24px;white-space:pre-wrap">${escapeHtml(m.body)}</div><div style="max-width:600px;margin:0 auto;padding:0 24px 24px;font-size:12px;color:#888"><a href="${escapeHtml(unsub)}" style="color:#888">${footer}</a></div></body></html>`;
    const r = await sendEmail({
      to: m.to,
      subject: m.subject || "—",
      html,
      text: `${m.body}\n\n${footer}: ${unsub}`,
      headers: { "List-Unsubscribe": `<${base}/api/unsubscribe/${m.unsub_token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    return r.sent ? { ok: true } : { ok: false, error: r.reason ?? "provider_error" };
  }
  // wave 17: WhatsApp approved template on the official API (outside the 24h window)
  if (m.channel === "whatsapp" && m.wa_template?.name) {
    const { sendWhatsAppTemplate } = await import("@/lib/channels/wa-template");
    const t = await sendWhatsAppTemplate(job.organization_id, m.contact_id, m.wa_template, m.body);
    if (t.usedTemplate) return { ok: t.ok, status: t.status, error: t.error, permanent: t.permanent };
  }
  const kind = m.channel as ChannelKind;
  const r = await sendViaChannel(kind, { organizationId: job.organization_id, contactId: m.contact_id, text: m.body });
  return { ok: r.ok, status: r.status, error: r.error, permanent: r.permanent };
}

async function runJob(admin: ReturnType<typeof createAdminClient>, job: JobRow): Promise<Outcome> {
  if (job.campaign_recipient_id) {
    const out = await runCampaignJob(admin, job);
    const final = out.ok || Boolean(out.permanent) || job.attempts >= (job.max_attempts ?? 6);
    await admin.rpc("campaign_recipient_result", { p_recipient: job.campaign_recipient_id, p_ok: out.ok, p_error: out.error ?? null, p_final: final });
    return out;
  }
  switch (job.kind) {
    case "email": {
      if (!emailConfigured()) return { ok: false, error: "email_not_configured", permanent: true };
      const p = job.payload as { to: string; subject: string; text: string };
      const html = `<div dir="auto" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(p.text ?? "")}</div>`;
      const r = await sendEmail({ to: p.to, subject: p.subject || "—", html, text: p.text ?? "" });
      return r.sent ? { ok: true } : { ok: false, error: r.reason ?? "provider_error", permanent: r.reason === "not_configured" };
    }
    case "webhook": {
      if (!job.webhook_id) return { ok: false, error: "webhook_missing", permanent: true };
      const { data: wh } = await admin.from("webhooks").select("url, secret, enabled").eq("id", job.webhook_id).eq("organization_id", job.organization_id).maybeSingle();
      if (!wh || !wh.enabled) return { ok: false, error: "webhook_disabled", permanent: true };
      const body = JSON.stringify(job.payload);
      const ts = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", wh.secret as string).update(`${ts}.${body}`).digest("hex");
      return postJson(wh.url as string, body, {
        "X-SCC-Event": String(job.payload.type ?? ""),
        "X-SCC-Delivery": String(job.id),
        "X-SCC-Timestamp": ts,
        "X-SCC-Signature": `sha256=${signature}`,
      });
    }
    case "http": {
      const p = job.payload as { url: string; body: unknown };
      return postJson(p.url, JSON.stringify(p.body ?? {}), { "X-SCC-Delivery": String(job.id) });
    }
    case "whatsapp":
    case "telegram":
    case "sms": {
      const p = job.payload as { contact_id: string; text: string };
      // conversation guard: automations never message a customer who opted out
      {
        const { checkContact } = await import("@/lib/conversations/guard");
        const g = await checkContact(p.contact_id, "automation");
        if (!g.allowed) return { ok: false, error: g.reason, permanent: true };
      }
      const r = await sendViaChannel(job.kind as ChannelKind, { organizationId: job.organization_id, contactId: p.contact_id, text: p.text });
      return { ok: r.ok, status: r.status, error: r.error, permanent: r.permanent };
    }
    case "action": {
      const { error } = await admin.rpc("run_delayed_action", { p_job: job.id });
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    // waves 15-18: tax documents, conversion APIs, push notifications, calendars, reminders, phone calls
    case "invoice":
    case "conversion":
    case "push":
    case "calendar":
    case "reminder":
    case "call": {
      const { runGrowthJob } = await import("./growth-jobs");
      return runGrowthJob(job.kind, job.organization_id, job.payload);
    }
    default:
      return { ok: false, error: "unknown_kind", permanent: true };
  }
}

export interface DispatchSummary {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  ms: number;
}

export async function dispatchJobs({ limit = 25, budgetMs = 20_000 }: { limit?: number; budgetMs?: number } = {}): Promise<DispatchSummary> {
  const started = Date.now();
  const summary: DispatchSummary = { claimed: 0, done: 0, retried: 0, dead: 0, ms: 0 };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return summary;
  const admin = createAdminClient();
  while (Date.now() - started < budgetMs) {
    const { data, error } = await admin.rpc("claim_jobs", { p_limit: limit });
    if (error) {
      console.error("claim_jobs failed", error.message);
      break;
    }
    const jobs = (data ?? []) as JobRow[];
    if (!jobs.length) break;
    summary.claimed += jobs.length;
    await Promise.all(
      jobs.map(async (job) => {
        let out: Outcome;
        try {
          out = await runJob(admin, job);
        } catch (e) {
          out = { ok: false, error: (e as Error).message };
        }
        const { data: state } = await admin.rpc("complete_job", {
          p_id: job.id,
          p_ok: out.ok,
          p_status: out.status ?? null,
          p_error: out.error ?? null,
          p_permanent: Boolean(out.permanent),
        });
        if (state === "done") summary.done++;
        else if (state === "dead") summary.dead++;
        else summary.retried++;
      }),
    );
    if (jobs.length < limit) break;
  }
  summary.ms = Date.now() - started;
  return summary;
}
