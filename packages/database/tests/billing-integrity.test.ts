import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Billing integrity (real Postgres): payers keep access, ended plans end, the admin sees a client file per business. */
d("billing integrity (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let admin: string;
  let paying: string;
  let manual: string;
  let pastDue: string;
  let periodEnded: string;
  let healthy: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@bi.test", "Owner Billing");
    admin = await db.createUser("admin@bi.test", "Platform Admin");
    await db.q(`insert into platform_admins (user_id) values ($1)`, [admin]);
    const mk = async (name: string, slug: string) => db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization($1, $2) as id`, [name, slug]))[0]!.id, true);
    paying = await mk("Paying Biz", "bi-paying");
    manual = await mk("Manual Biz", "bi-manual");
    pastDue = await mk("Past Due Biz", "bi-pastdue");
    periodEnded = await mk("Ended Biz", "bi-ended");
    healthy = await mk("Healthy Biz", "bi-healthy");
    // a paying subscription whose organization lost its plan (e.g. a failed write) — must be restored
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'manual', null, null, 'month', now() + interval '20 days', false)`, [paying]);
    await db.q(`update public.organizations set plan = 'free' where id = $1`, [paying]);
    // a hand-granted plan whose end date passed
    await db.q(`select public.apply_subscription($1, 'business', 'active', 'manual', null, null, null, now() - interval '1 hour', false)`, [manual]);
    // a failed payment, 8 days after the period ended
    await db.q(`select public.apply_subscription($1, 'pro', 'past_due', 'manual', null, null, 'month', now() - interval '8 days', false)`, [pastDue]);
    // cancelled at the end of the period, period ended 2 days ago, no expiry event
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'lemonsqueezy', null, 'sub-ended', 'month', now() - interval '2 days', true)`, [periodEnded]);
    // healthy: active in its period
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'manual', null, null, 'month', now() + interval '10 days', false)`, [healthy]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  const plan = async (org: string) => (await db.q<{ plan: string }>(`select plan from public.organizations where id = $1`, [org]))[0]!.plan;

  it("only the platform admin can run it from the app, see the overview or open a client file", async () => {
    await expect(db.as(owner, (q) => q(`select public.admin_billing_integrity_sweep()`))).rejects.toThrow(/forbidden/);
    await expect(db.as(owner, (q) => q(`select * from public.platform_billing_health()`))).rejects.toThrow(/forbidden/);
    await expect(db.as(owner, (q) => q(`select public.platform_billing_file($1)`, [paying]))).rejects.toThrow(/forbidden/);
  });

  it("the overview lists every business with its subscription and credits", async () => {
    const rows = await db.as(admin, (q) => q<{ organization_id: string; plan: string; sub_status: string; monthly_limit: string | null }>(`select * from public.platform_billing_health()`));
    const byId = new Map(rows.map((r) => [r.organization_id, r]));
    expect(byId.get(paying)).toMatchObject({ plan: "free", sub_status: "active" });
    expect(byId.get(healthy)).toMatchObject({ plan: "pro", sub_status: "active" });
  });

  it("the sweep restores the payer, ends the ended plans and leaves the healthy one alone", async () => {
    const r = await db.as(admin, async (q) => (await q<{ r: Record<string, number> }>(`select public.admin_billing_integrity_sweep() as r`))[0]!.r, true);
    expect(r).toEqual({ restored: 1, manual_expired: 1, past_due_expired: 1, period_ended: 1 });
    expect(await plan(paying)).toBe("pro");
    expect(await plan(manual)).toBe("free");
    expect(await plan(pastDue)).toBe("free");
    expect(await plan(periodEnded)).toBe("free");
    expect(await plan(healthy)).toBe("pro");
    // a second run changes nothing
    const again = (await db.q<{ r: Record<string, number> }>(`select public.billing_integrity_sweep() as r`))[0]!.r;
    expect(again).toEqual({ restored: 0, manual_expired: 0, past_due_expired: 0, period_ended: 0 });
  });

  it("the client file has the subscription, payments with receipt numbers and the plan history", async () => {
    await db.q(`select public.record_billing_payment($1, 'manual', 'bi-pay-1', 'pro', 'month', 149, 'ILS')`, [paying]);
    const f = await db.as(admin, async (q) => (await q<{ f: Record<string, unknown> }>(`select public.platform_billing_file($1) as f`, [paying]))[0]!.f);
    expect((f.subscription as { plan_key: string }).plan_key).toBe("pro");
    const pays = f.payments as { amount: number; receipt_number: number }[];
    expect(pays).toHaveLength(1);
    expect(Number(pays[0]!.amount)).toBe(149);
    expect(Number(pays[0]!.receipt_number)).toBeGreaterThan(0);
    expect((f.history as { action: string }[]).map((h) => h.action)).toEqual(expect.arrayContaining(["billing.plan_restored", "billing.plan_changed", "billing.payment"]));
  });
});
