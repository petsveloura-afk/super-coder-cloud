import "server-only";
import { integrationAvailability } from "@scc/shared/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadChannelHealth, type ChannelHealthRow } from "@/lib/channels/health";
import { JOB_CADENCE_MIN, jobHealth, type JobHealth } from "./job-runs-core";
import { opsItems, surveyAverage, worst, type OpsFacts, type OpsItem, type OpsLevel } from "./system-core";

/** Mission Control data for one business (+ platform jobs / errors for platform admins). Never throws. */
export interface DeliveryRow {
  id: number;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  to: string | null;
}
export interface JobRow {
  name: string;
  health: JobHealth;
  lastStatus: string | null;
  lastAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  durationMs: number | null;
  items: number | null;
}
export interface ErrorRow {
  id: string;
  source: string;
  route: string | null;
  message: string;
  count: number;
  last_seen: string;
}

export interface MissionControl {
  checkedAt: string;
  overall: OpsLevel;
  channels: ChannelHealthRow[];
  items: OpsItem[];
  deliveries: DeliveryRow[];
  survey: { enabled: boolean; kind: string; delay_minutes: number; cooldown_days: number; question: string | null; answered30d: number; avg: number | null; recent: { score: number | null; kind: string; comment: string | null; answered_at: string | null }[] };
  jobs: JobRow[] | null;
  errors: ErrorRow[] | null;
}

const maskTo = (v: unknown) => {
  const s = typeof v === "string" ? v : "";
  if (!s) return null;
  if (s.includes("@")) return `${s.slice(0, 2)}…@${s.split("@")[1]}`;
  return s.length > 4 ? `…${s.slice(-4)}` : s;
};

export async function loadMissionControl(orgId: string, platformAdmin: boolean): Promise<MissionControl> {
  const admin = createAdminClient();
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const late = new Date(Date.now() - 15 * 60_000).toISOString();
  const avail = integrationAvailability(process.env);
  const safe = <T,>(p: PromiseLike<{ data: T | null }>) => Promise.resolve(p).then((r) => r.data).catch(() => null);
  const [health, mailbox, accs, failedPosts, autopilot, jobsFailed, jobsDead, jobsLate, recentJobs, sites, survey, answers] = await Promise.all([
    loadChannelHealth(orgId),
    safe(admin.from("channel_accounts").select("status").eq("organization_id", orgId).eq("kind", "email").maybeSingle()),
    safe(admin.from("channel_accounts").select("kind").eq("organization_id", orgId).in("kind", ["messenger", "instagram"])),
    admin.from("social_posts").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "failed").gte("scheduled_at", since7).then((r) => r.count ?? 0, () => 0),
    safe(admin.from("social_autopilot").select("enabled, last_error").eq("organization_id", orgId).maybeSingle()),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "failed").gte("created_at", since7).then((r) => r.count ?? 0, () => 0),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "dead").gte("created_at", since7).then((r) => r.count ?? 0, () => 0),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "queued").lt("run_after", late).then((r) => r.count ?? 0, () => 0),
    safe(admin.from("jobs").select("id, kind, status, attempts, last_error, created_at, payload").eq("organization_id", orgId).in("status", ["failed", "dead"]).gte("created_at", since7).order("created_at", { ascending: false }).limit(20)),
    safe(admin.from("sites").select("status, custom_domain, domain_status").eq("organization_id", orgId).limit(200)),
    safe(admin.from("survey_settings").select("enabled, kind, delay_minutes, cooldown_days, question").eq("organization_id", orgId).maybeSingle()),
    safe(admin.from("survey_responses").select("kind, score, comment, answered_at").eq("organization_id", orgId).eq("status", "answered").gte("answered_at", since30).order("answered_at", { ascending: false }).limit(200)),
  ]);
  const emailFailed = ((recentJobs ?? []) as { kind: string }[]).filter((j) => j.kind === "email").length;
  const kinds = new Set(((accs ?? []) as { kind: string }[]).map((a) => a.kind));
  const siteRows = (sites ?? []) as { status: string; custom_domain: string | null; domain_status: string | null }[];
  const ans = (answers ?? []) as { kind: string; score: number | null; comment: string | null; answered_at: string | null }[];
  const s = survey as { enabled: boolean; kind: string; delay_minutes: number; cooldown_days: number; question: string | null } | null;
  const facts: OpsFacts = {
    email: { provider: avail.email, mailbox: mailbox ? ((mailbox as { status: string }).status === "error" ? "error" : (mailbox as { status: string }).status === "disabled" ? "none" : "active") : "none", failed7d: emailFailed },
    social: { facebook: kinds.has("messenger"), instagram: kinds.has("instagram"), failed7d: failedPosts, autopilotOn: Boolean((autopilot as { enabled?: boolean } | null)?.enabled), autopilotError: ((autopilot as { last_error?: string | null } | null)?.last_error ?? null) },
    payments: { platform: avail.payments || Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) || Boolean(process.env.LEMONSQUEEZY_API_KEY) || Boolean(process.env.NOWPAYMENTS_API_KEY) },
    deliveries: { failed: jobsFailed, dead: jobsDead, queuedLate: jobsLate },
    sites: { published: siteRows.filter((r) => r.status === "published").length, domainsPending: siteRows.filter((r) => r.custom_domain && r.domain_status !== "active").length },
    surveys: { enabled: Boolean(s?.enabled), answered30d: ans.length, avg: surveyAverage(ans) },
  };
  const items = opsItems(facts);
  // the official WhatsApp number waiting for Meta is not an outage while WhatsApp works through QR
  const qrOk = health.rows.some((r) => r.kind === "whatsapp_qr" && r.level !== "error");
  const channelLevels: OpsLevel[] = health.rows.map((r) => (r.level === "error" ? (r.kind === "whatsapp" && qrOk ? "warn" : "error") : r.level === "warning" ? "warn" : "ok"));
  let jobs: JobRow[] | null = null;
  let errors: ErrorRow[] | null = null;
  if (platformAdmin) {
    const { data: runs } = await admin.from("job_runs").select("name, status, started_at, duration_ms, items, error").gte("started_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("started_at", { ascending: false }).limit(600).then((r) => r, () => ({ data: null }));
    const all = (runs ?? []) as { name: string; status: string; started_at: string; duration_ms: number | null; items: number | null; error: string | null }[];
    jobs = Object.keys(JOB_CADENCE_MIN).map((name) => {
      const mine = all.filter((r) => r.name === name);
      const last = mine[0] ?? null;
      const lastOk = mine.find((r) => r.status === "ok")?.started_at ?? null;
      return { name, health: jobHealth(last, lastOk, JOB_CADENCE_MIN[name]!), lastStatus: last?.status ?? null, lastAt: last?.started_at ?? null, lastOkAt: lastOk, lastError: last?.error ?? null, durationMs: last?.duration_ms ?? null, items: last?.items ?? null };
    });
    const { data: errs } = await admin.from("app_errors").select("id, source, route, message, count, last_seen").eq("resolved", false).order("last_seen", { ascending: false }).limit(15).then((r) => r, () => ({ data: null }));
    errors = (errs ?? []) as ErrorRow[];
  }
  return {
    checkedAt: new Date().toISOString(),
    overall: worst([...items.map((i) => i.level), ...channelLevels]),
    channels: health.rows,
    items,
    deliveries: ((recentJobs ?? []) as { id: number; kind: string; status: string; attempts: number; last_error: string | null; created_at: string; payload: Record<string, unknown> }[]).map((j) => ({ id: j.id, kind: j.kind, status: j.status, attempts: j.attempts, last_error: j.last_error ? String(j.last_error).slice(0, 200) : null, created_at: j.created_at, to: maskTo(j.payload?.to) })),
    survey: { enabled: Boolean(s?.enabled), kind: s?.kind ?? "csat", delay_minutes: s?.delay_minutes ?? 30, cooldown_days: s?.cooldown_days ?? 30, question: s?.question ?? null, answered30d: ans.length, avg: surveyAverage(ans), recent: ans.slice(0, 8) },
    jobs,
    errors,
  };
}
