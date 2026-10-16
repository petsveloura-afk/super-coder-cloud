import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0029: the owner answers from his phone (WhatsApp / Telegram), the agent resumes later; plans give exactly their limits. */
d("owner take-over + plan entitlements (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let org: string;
  let waToken: string;
  let tgToken: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@take.test", "Take Owner");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Take Org', 'take-org') as id`))[0]!.id, true);
    waToken = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'whatsapp_qr', 'וואטסאפ') returning webhook_token`, [org]))[0]!.webhook_token;
    tgToken = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'telegram_user', 'טלגרם') returning webhook_token`, [org]))[0]!.webhook_token;
  });
  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  const ownerMsg = (token: string, kind: string, chat: string, text: string, id: string) =>
    db.q<{ r: { ok: boolean; conversation_id: string; duplicate?: boolean; owner?: boolean } }>(`select public.ingest_owner_message($1, $2, $3, $4, $5) as r`, [token, kind, chat, text, id]).then((x) => x[0]!.r);

  it("WhatsApp: the owner's own message is recorded as outgoing and the agent steps back", async () => {
    const inb = (await db.q<{ r: { conversation_id: string } }>(`select public.ingest_channel_message_v2($1, 'whatsapp_qr', '972509998888', 'דנה', '+972509998888', null, 'כמה עולה תספורת?', 'IN1') as r`, [waToken]))[0]!.r;
    const r = await ownerMsg(waToken, "whatsapp_qr", "972509998888", "היי דנה, כאן בעל העסק 🙂", "PHONE1");
    expect(r).toMatchObject({ ok: true, owner: true, conversation_id: inb.conversation_id });
    const c = (await db.q<{ ai_mode: string; owner_takeover_at: string | null; unread_count: number }>(`select ai_mode, owner_takeover_at, unread_count from conversations where id = $1`, [r.conversation_id]))[0]!;
    expect(c.ai_mode).toBe("human");
    expect(c.owner_takeover_at).not.toBeNull();
    expect(c.unread_count).toBe(0);
    const m = (await db.q<{ direction: string; meta: { owner: boolean } }>(`select direction, meta from messages where conversation_id = $1 order by created_at desc limit 1`, [r.conversation_id]))[0]!;
    expect(m).toMatchObject({ direction: "out", meta: { owner: true } });
    expect((await ownerMsg(waToken, "whatsapp_qr", "972509998888", "x", "PHONE1")).duplicate).toBe(true);
  });

  it("the owner can start a new chat himself; a known contact is linked by phone", async () => {
    const cid = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone) values ($1, 'רון', '0521112222') returning id`, [org]))[0]!.id;
    const r = await ownerMsg(waToken, "whatsapp_qr", "972521112222", "רון, התור שלך מחר ב-10", "PHONE2");
    const c = (await db.q<{ contact_id: string; ai_mode: string }>(`select contact_id, ai_mode from conversations where id = $1`, [r.conversation_id]))[0]!;
    expect(c).toEqual({ contact_id: cid, ai_mode: "human" });
  });

  it("Telegram personal account works the same; bad input and tokens are refused", async () => {
    const r = await ownerMsg(tgToken, "telegram_user", "123456", "שלום מבעל העסק", "123456:7");
    expect(r.owner).toBe(true);
    await expect(ownerMsg(tgToken, "whatsapp_qr", "123456", "x", "y")).rejects.toThrow(/not_found/);
    await expect(ownerMsg(waToken, "whatsapp_qr", "abc", "x", "y")).rejects.toThrow(/invalid_chat/);
    await expect(db.as(owner, (q) => q(`select public.ingest_owner_message($1, 'whatsapp_qr', '972500000000', 'x', 'z')`, [waToken]))).rejects.toThrow();
  });

  it("the agent resumes only after the owner has been quiet for N minutes and nobody from the team answered", async () => {
    const conv = (await db.q<{ id: string }>(`select id from conversations where organization_id = $1 and external_id = '972509998888'`, [org]))[0]!.id;
    const resume = (min: number) => db.q<{ r: boolean }>(`select public.ai_owner_resume($1, $2) as r`, [conv, min]).then((x) => x[0]!.r);
    expect(await resume(0)).toBe(false); // "never"
    expect(await resume(30)).toBe(false); // the owner just wrote
    await db.q(`update conversations set owner_takeover_at = now() - interval '45 minutes' where id = $1`, [conv]);
    // a teammate answered from the app after the owner → stays with the people
    await db.q(`insert into messages (organization_id, conversation_id, direction, body, status, sent_by) values ($1, $2, 'out', 'אני מטפל', 'sent', $3)`, [org, conv, owner]);
    expect(await resume(30)).toBe(false);
    await db.q(`delete from messages where conversation_id = $1 and sent_by is not null`, [conv]);
    expect(await resume(60)).toBe(false); // 45 < 60
    expect(await resume(30)).toBe(true);
    const c = (await db.q<{ ai_mode: string; owner_takeover_at: string | null }>(`select ai_mode, owner_takeover_at from conversations where id = $1`, [conv]))[0]!;
    expect(c).toEqual({ ai_mode: "auto", owner_takeover_at: null });
    expect(await db.q(`select 1 from events where organization_id = $1 and type = 'ai.resumed'`, [org])).toHaveLength(1);
    // an agent hand-off (no owner message) is never auto-resumed
    await db.q(`update conversations set ai_mode = 'human' where id = $1`, [conv]);
    expect(await resume(1)).toBe(false);
  });

  it("each paid plan gives exactly its limits (card / crypto), and the org returns to free when the period ends", async () => {
    const lim = async (k: string) => (await db.q<{ v: string | null }>(`select public.plan_limit($1, $2)::text as v`, [org, k]))[0]!.v;
    const plan = async () => (await db.q<{ plan: string }>(`select plan from organizations where id = $1`, [org]))[0]!.plan;
    expect([await plan(), await lim("contacts"), await lim("ai_agents"), await lim("ai_credits_monthly"), await lim("members")]).toEqual(["free", "250", "1", "50", "2"]);

    // card (PayPal one-off order, prepaid month)
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'paypal', 'PAYER', 'order:5O190127TN364715T', 'month', now() + interval '30 days', false)`, [org]);
    expect([await plan(), await lim("contacts"), await lim("ai_agents"), await lim("ai_credits_monthly"), await lim("members")]).toEqual(["pro", "5000", "3", "1000", "5"]);
    const f = (await db.q<{ features: string[] }>(`select features from org_entitlements($1)`, [org]).catch(async () => db.q<{ features: string[] }>(`select p.features from plans p join organizations o on o.plan = p.key where o.id = $1`, [org])))[0]!.features;
    expect(f).toEqual(expect.arrayContaining(["ai_agents", "ai_site_full", "ai_images", "audit_log", "priority_support"]));

    // crypto: Business for a year
    await db.q(`select public.apply_subscription($1, 'business', 'active', 'nowpayments', null, null, 'year', now() + interval '365 days', false)`, [org]);
    expect([await plan(), await lim("contacts"), await lim("ai_agents"), await lim("ai_credits_monthly"), await lim("members")]).toEqual(["business", "50000", "20", "10000", "25"]);
    // agents limit is enforced in the database
    for (let i = 0; i < 20; i++) await db.q(`insert into ai_agents (organization_id, name, model) values ($1, $2, 'gemini-flash-latest')`, [org, `סוכן ${i}`]);
    await expect(db.q(`insert into ai_agents (organization_id, name, model) values ($1, 'one too many', 'gemini-flash-latest')`, [org])).rejects.toThrow(/plan_limit:ai_agents/);

    // paid period over (+3 days grace) → back to free
    await db.q(`update subscriptions set current_period_end = now() - interval '4 days' where organization_id = $1`, [org]);
    await db.q(`select * from public.sweep_prepaid_subscriptions()`);
    expect(await plan()).toBe("free");
    expect(await lim("ai_agents")).toBe("1");
  });
});
