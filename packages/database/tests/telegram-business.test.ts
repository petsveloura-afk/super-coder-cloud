import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0027: Telegram Business chats and team-update recipients. */
d("Telegram Business + team updates (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let stranger: string;
  let org: string;
  let token: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@biz.test", "Biz Owner");
    stranger = await db.createUser("stranger@biz.test", "Stranger");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Biz', 'biz-org') as id`))[0]!.id, true);
    await db.as(stranger, async (q) => q(`select public.create_organization('Other', 'other-biz')`), true);
    token = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'telegram', 'bot') returning webhook_token`, [org]))[0]!.webhook_token;
  });
  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("saves a business connection (new, then updated) with an audit trail", async () => {
    const a = (await db.q<{ r: { new: boolean } }>(`select public.upsert_telegram_business_connection($1, 'conn-1', 1001, 1001, 'Tom', 'tom', true, true, '{"can_reply":true}') as r`, [token]))[0]!.r;
    expect(a.new).toBe(true);
    const b = (await db.q<{ r: { new: boolean } }>(`select public.upsert_telegram_business_connection($1, 'conn-1', 1001, 1001, 'Tom', 'tom', false, true, '{}') as r`, [token]))[0]!.r;
    expect(b.new).toBe(false);
    expect((await db.q<{ can_reply: boolean }>(`select can_reply from telegram_business_connections where id = 'conn-1'`))[0]!.can_reply).toBe(false);
    await db.q(`select public.upsert_telegram_business_connection($1, 'conn-1', 1001, 1001, 'Tom', 'tom', true, true, '{}')`, [token]);
    expect(await db.q(`select 1 from audit_logs where organization_id = $1 and action like 'telegram.business.%'`, [org])).toHaveLength(3);
  });

  it("customer messages open a separate 'biz:' conversation linked to the same contact as the bot chat", async () => {
    // the person also wrote to the bot directly before
    await db.q(`select public.ingest_channel_message($1, 'telegram', '555', 'דנה', null, 'היי בוט', 'm1')`, [token]);
    const r = (await db.q<{ r: { ok: boolean; conversation_id: string; contact_id: string; can_reply: boolean } }>(
      `select public.ingest_telegram_business($1, 'conn-1', 555, 'דנה', 'כמה עולה?', 'b1') as r`, [token]))[0]!.r;
    expect(r.ok).toBe(true);
    expect(r.can_reply).toBe(true);
    const conv = (await db.q<{ external_id: string; business_connection_id: string; contact_id: string; unread_count: number }>(`select external_id, business_connection_id, contact_id, unread_count from conversations where id = $1`, [r.conversation_id]))[0]!;
    expect(conv).toMatchObject({ external_id: "biz:555", business_connection_id: "conn-1", unread_count: 1 });
    const botConv = (await db.q<{ contact_id: string }>(`select contact_id from conversations where organization_id = $1 and external_id = '555'`, [org]))[0]!;
    expect(conv.contact_id).toBe(botConv.contact_id);
    // duplicates are ignored
    expect(((await db.q<{ r: { duplicate?: boolean } }>(`select public.ingest_telegram_business($1, 'conn-1', 555, 'דנה', 'כמה עולה?', 'b1') as r`, [token]))[0]!.r).duplicate).toBe(true);
  });

  it("a message the owner typed himself is recorded as outgoing and the agent steps back in that chat", async () => {
    const r = (await db.q<{ r: { owner: boolean; conversation_id: string } }>(`select public.ingest_telegram_business($1, 'conn-1', 555, null, 'אני כאן, דנה 🙂', 'b2', null, true) as r`, [token]))[0]!.r;
    expect(r.owner).toBe(true);
    const c = (await db.q<{ ai_mode: string }>(`select ai_mode from conversations where id = $1`, [r.conversation_id]))[0]!;
    expect(c.ai_mode).toBe("human");
    const m = (await db.q<{ direction: string; meta: { owner: boolean } }>(`select direction, meta from messages where conversation_id = $1 order by created_at desc limit 1`, [r.conversation_id]))[0]!;
    expect(m).toMatchObject({ direction: "out", meta: { owner: true } });
    const n = (await db.q<{ messages_in: number; messages_out: number }>(`select messages_in, messages_out from telegram_business_connections where id = 'conn-1'`))[0]!;
    expect(n).toEqual({ messages_in: 1, messages_out: 1 });
  });

  it("connections are visible to members only", async () => {
    expect(await db.as(owner, (q) => q(`select id from telegram_business_connections`))).toHaveLength(1);
    expect(await db.as(stranger, (q) => q(`select id from telegram_business_connections`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`select public.ingest_telegram_business($1, 'conn-1', 1, 'x', 'y', 'z')`, [token]))).rejects.toThrow();
  });

  it("recipients: managers add them, Telegram invites link by code, /stop_updates pauses, max 20", async () => {
    await db.as(owner, (q) => q(`insert into notify_recipients (organization_id, kind, target, events) values ($1, 'email', 'dan@example.com', array['leads','messages'])`, [org]), true);
    await db.as(owner, (q) => q(`insert into notify_recipients (organization_id, kind, invite_code, events) values ($1, 'telegram', 'AbCdEfGh2345', array['leads'])`, [org]), true);
    await expect(db.as(owner, (q) => q(`insert into notify_recipients (organization_id, kind, events) values ($1, 'email', array['leads'])`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`insert into notify_recipients (organization_id, kind, target, events) values ($1, 'email', 'a@b.co', array['spam'])`, [org]))).rejects.toThrow();
    await expect(db.as(stranger, (q) => q(`insert into notify_recipients (organization_id, kind, target) values ($1, 'email', 'x@y.co')`, [org]))).rejects.toThrow();
    expect(await db.as(stranger, (q) => q(`select id from notify_recipients`))).toHaveLength(0);

    const bad = (await db.q<{ r: { ok: boolean } }>(`select public.link_notify_recipient($1, 'WrongCode123', '777', 'Dan') as r`, [token]))[0]!.r;
    expect(bad.ok).toBe(false);
    const ok = (await db.q<{ r: { ok: boolean; org_name: string } }>(`select public.link_notify_recipient($1, 'AbCdEfGh2345', '777', 'Dan') as r`, [token]))[0]!.r;
    expect(ok).toMatchObject({ ok: true, org_name: "Biz" });
    const linked = (await db.q<{ target: string; label: string; verified_at: string | null }>(`select target, label, verified_at from notify_recipients where invite_code = 'AbCdEfGh2345'`))[0]!;
    expect(linked.target).toBe("777");
    expect(linked.label).toBe("Dan");
    expect(linked.verified_at).not.toBeNull();
    expect((await db.q<{ n: number }>(`select public.unlink_notify_recipient($1, '777') as n`, [token]))[0]!.n).toBe(1);
    expect((await db.q<{ enabled: boolean }>(`select enabled from notify_recipients where invite_code = 'AbCdEfGh2345'`))[0]!.enabled).toBe(false);
    await db.q(`select public.notify_recipient_sent(id) from notify_recipients where kind = 'email'`);
    expect((await db.q<{ sent_count: number }>(`select sent_count from notify_recipients where kind = 'email'`))[0]!.sent_count).toBe(1);
    for (let i = 0; i < 18; i++) await db.q(`insert into notify_recipients (organization_id, kind, target) values ($1, 'email', $2)`, [org, `p${i}@x.co`]);
    await expect(db.q(`insert into notify_recipients (organization_id, kind, target) values ($1, 'email', 'one-too-many@x.co')`, [org])).rejects.toThrow(/notify_recipients/);
  });
});
