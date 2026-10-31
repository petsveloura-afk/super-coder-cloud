import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountHealth, overallHealth, shouldAlert, type AccountHealth, type HealthLevel } from "./health-core";

/**
 * Wave 59 — connection health center: every connected channel with its real state (status, last customer
 * message, failed sends in the last 24h), and ONE alert to the owners when a connection breaks (cron), with
 * a link straight to "reconnect". Never throws.
 */
export interface ChannelHealthRow extends AccountHealth {
  id: string;
  kind: string;
  name: string;
  lastInboundAt: string | null;
  lastError: string | null;
  failed24h: number;
  sent24h: number;
}

export async function loadChannelHealth(orgId: string): Promise<{ rows: ChannelHealthRow[]; overall: HealthLevel }> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [{ data: accounts }, { data: outs }] = await Promise.all([
      admin.from("channel_accounts").select("id, kind, name, status, last_error, last_inbound_at, created_at").eq("organization_id", orgId).order("created_at"),
      admin.from("messages").select("status, conversation_id").eq("organization_id", orgId).eq("direction", "out").gte("created_at", since).limit(3000),
    ]);
    const msgs = (outs ?? []) as { status: string; conversation_id: string }[];
    const convIds = [...new Set(msgs.map((m) => m.conversation_id))].slice(0, 800);
    const { data: convs } = convIds.length ? await admin.from("conversations").select("id, channel").in("id", convIds) : { data: [] };
    const chan = new Map(((convs ?? []) as { id: string; channel: string }[]).map((c) => [c.id, c.channel]));
    const per = new Map<string, { sent: number; failed: number }>();
    for (const m of msgs) {
      const k = chan.get(m.conversation_id);
      if (!k) continue;
      const x = per.get(k) ?? { sent: 0, failed: 0 };
      x.sent++;
      if (m.status === "failed") x.failed++;
      per.set(k, x);
    }
    const rows: ChannelHealthRow[] = ((accounts ?? []) as { id: string; kind: string; name: string; status: string; last_error: string | null; last_inbound_at: string | null; created_at: string }[]).map((a) => {
      const st = per.get(a.kind) ?? { sent: 0, failed: 0 };
      const h = accountHealth({ kind: a.kind, status: a.status, lastError: a.last_error, lastInboundAt: a.last_inbound_at, createdAt: a.created_at, failed24h: st.failed, sent24h: st.sent });
      return { ...h, id: a.id, kind: a.kind, name: a.name, lastInboundAt: a.last_inbound_at, lastError: a.last_error, failed24h: st.failed, sent24h: st.sent };
    });
    return { rows, overall: overallHealth(rows.map((r) => r.level)) };
  } catch {
    return { rows: [], overall: "ok" };
  }
}

/** Cron: alert the owners once per broken connection (max every 12h). */
export async function runChannelHealthAlerts(limit = 40, budgetMs = 15_000): Promise<{ checked: number; alerts: number }> {
  const t0 = Date.now();
  const admin = createAdminClient();
  const { data: bad } = await admin.from("channel_accounts").select("organization_id").eq("status", "error").limit(200);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data: failing } = await admin.from("messages").select("organization_id").eq("direction", "out").eq("status", "failed").gte("created_at", since).limit(500);
  const orgs = [...new Set([...((bad ?? []) as { organization_id: string }[]), ...((failing ?? []) as { organization_id: string }[])].map((r) => r.organization_id))].slice(0, limit);
  let alerts = 0;
  for (const orgId of orgs) {
    if (Date.now() - t0 > budgetMs) break;
    const { rows } = await loadChannelHealth(orgId);
    for (const r of rows) {
      const { data: last, error } = await admin.from("channel_alerts").select("created_at").eq("organization_id", orgId).eq("account_id", r.id).eq("kind", r.reason).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return { checked: orgs.length, alerts }; // before the migration ran
      if (!shouldAlert(r, (last?.created_at as string | undefined) ?? null)) continue;
      await admin.from("channel_alerts").insert({ organization_id: orgId, account_id: r.id, kind: r.reason });
      const { notifyOwners } = await import("@/lib/agents/run");
      await notifyOwners(orgId, "health.alertNotification", { channel: r.kind, name: r.name || r.kind }, "/integrations#health").catch(() => undefined);
      alerts++;
    }
  }
  return { checked: orgs.length, alerts };
}
