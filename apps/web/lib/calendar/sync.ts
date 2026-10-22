import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { openSecrets, sealSecrets } from "@/lib/channels/secrets";

/**
 * Wave 16 — two-way calendar sync per team member (Google Calendar / Outlook):
 *   → every meeting in the system is written to the host's calendar (create / move / cancel)
 *   ← busy times from the calendar block online booking (calendar_busy, refreshed by cron)
 * OAuth apps: GOOGLE_CLIENT_ID/SECRET, MICROSOFT_CLIENT_ID/SECRET (the same apps as e-mail).
 * Redirect URIs to register: https://<app>/api/calendar/google/callback and /api/calendar/microsoft/callback
 * Bases overridable for tests: GOOGLE_OAUTH_TOKEN_URL, MICROSOFT_OAUTH_TOKEN_URL,
 * GOOGLE_CALENDAR_API_BASE, MS_GRAPH_API_BASE.
 */
export type CalProvider = "google" | "microsoft";

export function calendarConfigured(p: CalProvider): boolean {
  return p === "google" ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) : Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}
export function calendarRedirectUri(p: CalProvider): string {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/api/calendar/${p}/callback`;
}
const SCOPES: Record<CalProvider, string> = {
  google: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
  microsoft: "openid email offline_access User.Read Calendars.ReadWrite",
};
const gBase = () => (process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com/calendar/v3").replace(/\/$/, "");
const msBase = () => (process.env.MS_GRAPH_API_BASE || "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
const tokenUrl = (p: CalProvider) => (p === "google" ? process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token" : process.env.MICROSOFT_OAUTH_TOKEN_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/token");

export function calendarAuthorizeUrl(p: CalProvider, state: string): string {
  if (p === "google") {
    const u = new URL(process.env.GOOGLE_OAUTH_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: calendarRedirectUri(p), response_type: "code", scope: SCOPES.google, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
    return u.toString();
  }
  const u = new URL(process.env.MICROSOFT_OAUTH_AUTHORIZE_URL || "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  u.search = new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", redirect_uri: calendarRedirectUri(p), response_type: "code", response_mode: "query", scope: SCOPES.microsoft, prompt: "select_account", state }).toString();
  return u.toString();
}

async function tokenCall(p: CalProvider, params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; id_token?: string; error?: string; error_description?: string; ok: boolean }> {
  const body = new URLSearchParams({ ...params, client_id: (p === "google" ? process.env.GOOGLE_CLIENT_ID : process.env.MICROSOFT_CLIENT_ID) ?? "", client_secret: (p === "google" ? process.env.GOOGLE_CLIENT_SECRET : process.env.MICROSOFT_CLIENT_SECRET) ?? "" });
  if (p === "microsoft") body.set("scope", SCOPES.microsoft);
  const res = await fetch(tokenUrl(p), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; error?: string; error_description?: string };
  return { ...j, ok: res.ok };
}

export async function exchangeCalendarCode(p: CalProvider, code: string): Promise<{ ok: boolean; refreshToken?: string; email?: string | null; error?: string }> {
  try {
    const j = await tokenCall(p, { grant_type: "authorization_code", code, redirect_uri: calendarRedirectUri(p) });
    if (!j.ok || !j.refresh_token) return { ok: false, error: `${j.error ?? "token"}${j.error_description ? `: ${j.error_description}` : ""}`.slice(0, 300) };
    let email: string | null = null;
    try {
      const payload = JSON.parse(Buffer.from((j.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
      email = (payload.email || payload.preferred_username || "").toLowerCase() || null;
    } catch {
      email = null;
    }
    return { ok: true, refreshToken: j.refresh_token, email };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

interface Conn {
  id: string;
  organization_id: string;
  user_id: string;
  provider: CalProvider;
  calendar_id: string;
  secret_enc: string | null;
  push_events: boolean;
  block_busy: boolean;
  status: string;
}

async function accessToken(c: Conn): Promise<string> {
  const secrets = openSecrets(c.secret_enc);
  const j = await tokenCall(c.provider, { grant_type: "refresh_token", refresh_token: secrets.refresh_token ?? "" });
  if (!j.ok || !j.access_token) throw new Error(`calendar_auth:${j.error ?? "refresh_failed"}`);
  // Microsoft rotates refresh tokens — keep the newest
  if (j.refresh_token && j.refresh_token !== secrets.refresh_token) {
    await createAdminClient().from("calendar_connections").update({ secret_enc: sealSecrets({ refresh_token: j.refresh_token }) }).eq("id", c.id);
  }
  return j.access_token;
}

async function api(url: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const json = res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Record<string, unknown>);
  return { ok: res.ok, status: res.status, json };
}

async function markConn(id: string, error: string | null) {
  await createAdminClient().from("calendar_connections").update(error ? { last_error: error.slice(0, 500), status: /auth/.test(error) ? "error" : "active", updated_at: new Date().toISOString() } : { last_error: null, status: "active", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
}

/** Job "calendar": write one meeting to its host's calendar (create / update / cancel). */
export async function syncAppointmentToCalendar(appointmentId: string): Promise<{ ok: boolean; error?: string; permanent?: boolean }> {
  const admin = createAdminClient();
  const { data: a } = await admin.from("appointments").select("id, organization_id, host_id, title, starts_at, ends_at, status, location, notes, external_event, contacts(first_name, last_name, phone, email)").eq("id", appointmentId).maybeSingle();
  if (!a || !a.host_id) return { ok: false, error: "not_found", permanent: true };
  const { data: conns } = await admin.from("calendar_connections").select("id, organization_id, user_id, provider, calendar_id, secret_enc, push_events, block_busy, status").eq("organization_id", a.organization_id).eq("user_id", a.host_id).eq("push_events", true).eq("status", "active");
  const ext = ((a.external_event as Record<string, string> | null) ?? {}) as Record<string, string>;
  const contact = a.contacts as unknown as { first_name: string; last_name: string; phone: string | null; email: string | null } | null;
  const description = [contact ? `${contact.first_name} ${contact.last_name ?? ""}`.trim() : "", contact?.phone ?? "", contact?.email ?? "", (a.notes as string | null) ?? ""].filter(Boolean).join("\n");
  const canceled = a.status === "canceled";
  let lastError: string | undefined;
  for (const c of (conns ?? []) as Conn[]) {
    try {
      const token = await accessToken(c);
      const key = `${c.provider}:${c.id}`;
      const existing = ext[key];
      if (c.provider === "google") {
        const base = `${gBase()}/calendars/${encodeURIComponent(c.calendar_id)}/events`;
        if (canceled) {
          if (existing) await api(`${base}/${encodeURIComponent(existing)}`, token, { method: "DELETE" });
          delete ext[key];
        } else {
          const body = { summary: a.title, description, location: a.location ?? undefined, start: { dateTime: a.starts_at }, end: { dateTime: a.ends_at } };
          const r = existing ? await api(`${base}/${encodeURIComponent(existing)}`, token, { method: "PATCH", body }) : await api(base, token, { method: "POST", body });
          if (!r.ok) throw new Error(`google_${r.status}`);
          ext[key] = String(r.json.id ?? existing ?? "");
        }
      } else {
        const base = `${msBase()}/me/events`;
        if (canceled) {
          if (existing) await api(`${base}/${encodeURIComponent(existing)}`, token, { method: "DELETE" });
          delete ext[key];
        } else {
          const body = { subject: a.title, body: { contentType: "text", content: description }, location: a.location ? { displayName: a.location } : undefined, start: { dateTime: String(a.starts_at).replace(/\+00:00$|Z$/, ""), timeZone: "UTC" }, end: { dateTime: String(a.ends_at).replace(/\+00:00$|Z$/, ""), timeZone: "UTC" } };
          const r = existing ? await api(`${base}/${encodeURIComponent(existing)}`, token, { method: "PATCH", body }) : await api(base, token, { method: "POST", body });
          if (!r.ok) throw new Error(`microsoft_${r.status}`);
          ext[key] = String(r.json.id ?? existing ?? "");
        }
      }
      await markConn(c.id, null);
    } catch (e) {
      lastError = (e as Error).message;
      await markConn(c.id, lastError);
    }
  }
  await admin.from("appointments").update({ external_event: ext }).eq("id", a.id);
  return lastError ? { ok: false, error: lastError, permanent: /auth/.test(lastError) } : { ok: true };
}

/** Cron: refresh busy times (next 30 days) of connected calendars → online booking skips them. */
export async function refreshCalendarBusy(limit = 15): Promise<{ synced: number; failed: number }> {
  const admin = createAdminClient();
  const { data: conns } = await admin
    .from("calendar_connections")
    .select("id, organization_id, user_id, provider, calendar_id, secret_enc, push_events, block_busy, status")
    .eq("block_busy", true)
    .eq("status", "active")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  let synced = 0;
  let failed = 0;
  const from = new Date();
  const to = new Date(Date.now() + 30 * 86_400_000);
  for (const c of (conns ?? []) as Conn[]) {
    try {
      const token = await accessToken(c);
      let busy: { start: string; end: string }[] = [];
      if (c.provider === "google") {
        const r = await api(`${gBase()}/freeBusy`, token, { method: "POST", body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: c.calendar_id }] } });
        if (!r.ok) throw new Error(`google_${r.status}`);
        const cal = (r.json.calendars as Record<string, { busy?: { start: string; end: string }[] }> | undefined)?.[c.calendar_id];
        busy = cal?.busy ?? [];
      } else {
        const url = `${msBase()}/me/calendarView?startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$select=start,end,showAs&$top=200`;
        const r = await api(url, token);
        if (!r.ok) throw new Error(`microsoft_${r.status}`);
        busy = ((r.json.value as { start: { dateTime: string }; end: { dateTime: string }; showAs?: string }[] | undefined) ?? [])
          .filter((e) => e.showAs !== "free")
          .map((e) => ({ start: `${e.start.dateTime.replace(/Z$/, "")}Z`, end: `${e.end.dateTime.replace(/Z$/, "")}Z` }));
      }
      // our own meetings are already blocked by the system — keep only outside events
      const { data: own } = await admin.from("appointments").select("starts_at, ends_at").eq("host_id", c.user_id).in("status", ["scheduled", "confirmed"]).gte("ends_at", from.toISOString());
      const ownSet = new Set(((own ?? []) as { starts_at: string; ends_at: string }[]).map((x) => `${new Date(x.starts_at).getTime()}|${new Date(x.ends_at).getTime()}`));
      const rows = busy
        .map((b) => ({ s: new Date(b.start), e: new Date(b.end) }))
        .filter((b) => !Number.isNaN(b.s.getTime()) && !Number.isNaN(b.e.getTime()) && b.e > b.s && !ownSet.has(`${b.s.getTime()}|${b.e.getTime()}`))
        .slice(0, 500)
        .map((b) => ({ connection_id: c.id, organization_id: c.organization_id, user_id: c.user_id, starts_at: b.s.toISOString(), ends_at: b.e.toISOString() }));
      await admin.from("calendar_busy").delete().eq("connection_id", c.id);
      if (rows.length) await admin.from("calendar_busy").insert(rows);
      await markConn(c.id, null);
      synced++;
    } catch (e) {
      await markConn(c.id, (e as Error).message);
      failed++;
    }
  }
  return { synced, failed };
}
