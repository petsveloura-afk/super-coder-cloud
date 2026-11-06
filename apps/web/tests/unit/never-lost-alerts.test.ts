import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATCHUP_GRACE_MS, CATCHUP_WINDOW_MS, MAX_ATTEMPTS, RETRY_MINUTES, catchUpAction, isUuid, nextRetryAt } from "@/lib/notify/deliveries-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("team alerts (Telegram lead → WhatsApp alert) are never lost", () => {
  it("retries after 1, 3, 10, 30 and 120 minutes, then gives up", () => {
    const now = 1_000_000;
    expect(RETRY_MINUTES).toEqual([1, 3, 10, 30, 120]);
    expect(MAX_ATTEMPTS).toBe(6);
    expect(nextRetryAt(1, now)!.getTime()).toBe(now + 60_000);
    expect(nextRetryAt(2, now)!.getTime()).toBe(now + 3 * 60_000);
    expect(nextRetryAt(5, now)!.getTime()).toBe(now + 120 * 60_000);
    expect(nextRetryAt(6, now)).toBeNull();
  });

  it("catch-up only for messages the normal path would have alerted, inside the window, never twice, never old history", () => {
    const now = Date.parse("2026-11-07T10:00:00Z");
    const base = { now, messageAt: now - 5 * 60_000, firstDeliveryAt: now - 3600_000, hasDelivery: false, agentReplied: true, aiMode: "auto" };
    expect(catchUpAction(base)).toBe("forward_reply");
    expect(catchUpAction({ ...base, agentReplied: false, aiMode: "human" })).toBe("forward_human");
    expect(catchUpAction({ ...base, agentReplied: false })).toBe("skip"); // the reply is still on its way
    expect(catchUpAction({ ...base, hasDelivery: true })).toBe("skip");
    expect(catchUpAction({ ...base, firstDeliveryAt: null })).toBe("skip");
    expect(catchUpAction({ ...base, firstDeliveryAt: now - 60_000 })).toBe("skip"); // before the feature started
    expect(catchUpAction({ ...base, messageAt: now - CATCHUP_GRACE_MS + 1000 })).toBe("skip");
    expect(catchUpAction({ ...base, messageAt: now - CATCHUP_WINDOW_MS - 1000, firstDeliveryAt: now - 5 * 3600_000 })).toBe("skip");
    expect(isUuid("19d3e213-e185-41b5-9ac5-4fba4d4e49eb")).toBe(true);
    expect(isUuid("x")).toBe(false);
  });

  it("wiring: one delivery per recipient + message, retries + catch-up on the heartbeat and on the scheduled sweep", () => {
    const f = read("lib/notify/forward.ts");
    expect(f).toContain('if (ledger === "duplicate") return;');
    expect(f).toContain("if (ledger) await closeDelivery(admin, ledger, res, 1);");
    expect(f).toContain("export async function retryNotifyDeliveries(");
    expect(f).toContain("export async function catchUpMissedAlerts(");
    expect(read("lib/ai/autopilot.ts")).toContain("messageId: (lastIn?.id as string | undefined) ?? null,");
    expect(read("app/api/bridge/tick/route.ts")).toContain("m.retryNotifyDeliveries(6_000)");
    expect(read("app/api/jobs/dispatch/route.ts")).toContain("catchUp: await m.catchUpMissedAlerts(6_000)");
    const sql = readFileSync(join(root, "../../supabase/migrations/20261106000005_notify_deliveries.sql"), "utf8");
    expect(sql).toContain("unique (recipient_id, event, message_id)");
  });
});
