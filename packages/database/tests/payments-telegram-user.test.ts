import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0025: personal Telegram account, payments with receipts, prepaid sweep, AI safety net. */
d("payments, receipts, Telegram personal account and AI safety net (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let stranger: string;
  let org: string;
  let tgUserToken: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@pay.test", "Pay Owner");
    stranger = await db.createUser("stranger@pay.test", "Stranger");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Pay Org', 'pay-org') as id`))[0]!.id, true);
    await db.as(stranger, async (q) => q(`select public.create_organization('Other', 'other-org')`), true);
    tgUserToken = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'telegram_user', 'הטלגרם שלי') returning webhook_token`, [org]))[0]!.webhook_token;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("accepts the telegram_user channel everywhere and adds it to Telegram agents", async () => {
    const a = (await db.q<{ autopilot_channels: string[] }>(`insert into ai_agents (organization_id, name, model, autopilot_channels) values ($1, 'נועה', 'gemini-flash-latest', array['telegram_user','web']) returning autopilot_channels`, [org]))[0]!;
    expect(a.autopilot_channels).toContain("telegram_user");
    await expect(db.q(`insert into channel_accounts (organization_id, kind, name) values ($1, 'fax', 'x')`, [org])).rejects.toThrow();
    const r = (await db.q<{ r: { conversation_id: string } }>(
      `select public.ingest_channel_message_v2($1, 'telegram_user', '5551234', 'דנה', null, null, 'היי', 'm1') as r`,
      [tgUserToken],
    ))[0]!.r;
    const c = (await db.q<{ channel: string }>(`select channel from conversations where id = $1`, [r.conversation_id]))[0]!;
    expect(c.channel).toBe("telegram_user");
  });

  it("records a payment once with a sequential receipt number (idempotent per provider + id)", async () => {
    const first = (await db.q<{ r: { id: string; receipt_number: number; new: boolean } }>(
      `select public.record_billing_payment($1, 'paypal', 'I-SUB-1:pay-1', 'pro', 'month', 149, 'ils', 'payer@x.com', 'Payer') as r`,
      [org],
    ))[0]!.r;
    expect(first.new).toBe(true);
    expect(Number(first.receipt_number)).toBeGreaterThanOrEqual(1001);
    const again = (await db.q<{ r: { id: string; receipt_number: number; new: boolean } }>(
      `select public.record_billing_payment($1, 'paypal', 'I-SUB-1:pay-1', 'pro', 'month', 149, 'ILS') as r`,
      [org],
    ))[0]!.r;
    expect(again).toEqual({ ...first, new: false });
    const second = (await db.q<{ r: { receipt_number: number } }>(`select public.record_billing_payment($1, 'nowpayments', 'np-1', 'business', 'year', 1077, 'USD') as r`, [org]))[0]!.r;
    expect(Number(second.receipt_number)).toBe(Number(first.receipt_number) + 1);
    const row = (await db.q<{ currency: string; amount: number }>(`select currency, amount::float8 as amount from billing_payments where id = $1`, [first.id]))[0]!;
    expect(row).toEqual({ currency: "ILS", amount: 149 });
    expect(await db.q(`select 1 from audit_logs where organization_id = $1 and action = 'billing.payment'`, [org])).toHaveLength(2);
  });

  it("payments are visible to the org's billing managers only, and nobody can write them directly", async () => {
    const mine = await db.as(owner, (q) => q(`select id from billing_payments`));
    expect(mine).toHaveLength(2);
    const theirs = await db.as(stranger, (q) => q(`select id from billing_payments`));
    expect(theirs).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`insert into billing_payments (organization_id, provider, external_id) values ($1, 'manual', 'x')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`select public.record_billing_payment($1, 'manual', 'y', null, null, 1, 'ILS')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`select * from billing_provider_plans`))).rejects.toThrow();
  });

  it("sweeps prepaid (crypto) plans: reminds 3 days before the end, cancels after the grace period", async () => {
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'nowpayments', null, null, 'month', now() + interval '2 days', false)`, [org]);
    const remind = await db.q<{ organization_id: string }>(`select * from public.sweep_prepaid_subscriptions()`);
    expect(remind.map((r) => r.organization_id)).toEqual([org]);
    // only once per period
    expect(await db.q(`select * from public.sweep_prepaid_subscriptions()`)).toHaveLength(0);
    await db.q(`update subscriptions set current_period_end = now() - interval '4 days' where organization_id = $1`, [org]);
    await db.q(`select * from public.sweep_prepaid_subscriptions()`);
    const s = (await db.q<{ status: string }>(`select status from subscriptions where organization_id = $1`, [org]))[0]!;
    expect(s.status).toBe("canceled");
  });

  it("ai_pending_replies finds unanswered customer messages and busy holds, but never groups or automated mail", async () => {
    const bot = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'telegram', 'bot') returning webhook_token`, [org]))[0]!.webhook_token;
    await db.q(`update ai_agents set autopilot_channels = array['telegram','telegram_user','web'], enabled = true where organization_id = $1`, [org]);
    const ingest = async (chat: string, text: string, id: string) =>
      (await db.q<{ r: { conversation_id: string } }>(`select public.ingest_channel_message($1, 'telegram', $2, 'לקוח', null, $3, $4) as r`, [bot, chat, text, id]))[0]!.r.conversation_id;
    const unanswered = await ingest("1001", "כמה עולה?", "a1");
    const group = await ingest("-100200", "שלום לכולם", "a2");
    const fresh = await ingest("1003", "היי", "a3");
    const held = await ingest("1004", "יש מקום מחר?", "a4");
    await db.q(`update messages set created_at = now() - interval '5 minutes' where conversation_id = any($1::uuid[])`, [[unanswered, group, held]]);
    await db.q(`insert into messages (organization_id, conversation_id, direction, body, meta, created_at) values ($1, $2, 'out', 'קיבלתי!', '{"fallback":true}', now() - interval '3 minutes')`, [org, held]);
    const ids = (await db.q<{ conversation_id: string }>(`select conversation_id from public.ai_pending_replies(50)`)).map((r) => r.conversation_id);
    expect(ids).toContain(unanswered);
    expect(ids).toContain(held);
    expect(ids).not.toContain(group);
    expect(ids).not.toContain(fresh);
    // a person took over → no automatic reply
    await db.q(`update conversations set ai_mode = 'human' where id = $1`, [unanswered]);
    expect((await db.q<{ conversation_id: string }>(`select conversation_id from public.ai_pending_replies(50)`)).map((r) => r.conversation_id)).not.toContain(unanswered);
    await expect(db.as(owner, (q) => q(`select * from public.ai_pending_replies(5)`))).rejects.toThrow();
  });
});
