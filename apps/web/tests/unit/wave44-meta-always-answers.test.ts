import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/lib/format";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("wave 44 — the agent answers on a server clock, with a visible delivery log (additive)", () => {
  it("message times are shown in the platform's time zone, not UTC", () => {
    // 05:50 UTC is 07:50 in Israel (UTC+2 on 29 Oct 2026)
    expect(formatDateTime("en", "2026-10-29T05:50:00Z")).toMatch(/7:50/);
    expect(formatDateTime("en", "2026-10-29T05:50:00Z", "UTC")).toMatch(/5:50/);
  });

  it("the cron endpoint is protected and fetches messages through the same pipeline", () => {
    const src = read("../../app/api/cron/meta-sync/route.ts");
    expect(src).toMatch(/Bearer/);
    expect(src).toMatch(/status: 401/);
    expect(src).toMatch(/syncMetaInbound\(40_000/);
    expect(src).toMatch(/public_rate_limit/);
  });

  it("the migration only adds (table, index, helper functions) and never drops", () => {
    const sql = readFileSync(new URL("../../../../supabase/migrations/20261029000002_meta_webhook_log_scheduler.sql", import.meta.url), "utf8");
    expect(sql).not.toMatch(/drop\s+(table|column|function|policy)/i);
    expect(sql).toMatch(/create table if not exists public\.meta_webhook_events/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/schedule_meta_inbound_sync/);
    expect(sql).toMatch(/revoke execute on function public\.schedule_meta_inbound_sync/);
  });

  it("the webhook logs what it receives / rejects, without message text", () => {
    const src = read("../../app/api/channels/meta/pages/route.ts");
    for (const s of ["received", "bad_signature", "no_account", "error"]) expect(src).toContain(`logMetaWebhook("${s}"`);
    const log = read("../../lib/channels/meta-webhook-log.ts");
    expect(log).not.toMatch(/\.text\b|body:/);
  });

  it("the diagnose page is for signed-in owners / admins only and shows no secrets", () => {
    const src = read("../../app/api/channels/meta/diagnose/route.ts");
    expect(src).toMatch(/integrations\.manage/);
    expect(src).toMatch(/status: 401/);
  });
});
