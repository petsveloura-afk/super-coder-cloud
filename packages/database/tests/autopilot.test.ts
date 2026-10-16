import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;
const V = "a1".repeat(16); // 32-hex visitor token

/** 0023: AI autopilot — website chat, e-mail / QR WhatsApp ingest, handoff, server-side metering. */
d("AI autopilot (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let outsider: string;
  let org: string;
  let agent: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@pilot.test", "Pilot Owner");
    outsider = await db.createUser("out@pilot.test");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Pet Line', 'pet-line') as id`))[0]!.id, true);
    await db.as(outsider, (q) => q(`select public.create_organization('Other', 'other-co')`), true);
    agent = (await db.q<{ id: string }>(`insert into ai_agents (organization_id, name, model, greeting) values ($1, 'נועה', 'gemini-flash-latest', 'היי!') returning id`, [org]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("website chat is enabled only when an enabled agent answers 'web'", async () => {
    const off = (await db.as(null, (q) => q<{ c: { enabled: boolean } }>(`select public.web_chat_config('pet-line') as c`)))[0]!.c;
    expect(off.enabled).toBe(false);
    await db.q(`update ai_agents set autopilot_channels = array['web','telegram'] where id = $1`, [agent]);
    const on = (await db.as(null, (q) => q<{ c: { enabled: boolean; agent: string; greeting: string; org: string } }>(`select public.web_chat_config('pet-line') as c`)))[0]!.c;
    expect(on).toMatchObject({ enabled: true, agent: "נועה", greeting: "היי!", org: "Pet Line" });
    expect((await db.as(null, (q) => q<{ c: unknown }>(`select public.web_chat_config('nope') as c`)))[0]!.c).toBeNull();
    await expect(db.q(`update ai_agents set autopilot_channels = array['fax'] where id = $1`, [agent])).rejects.toThrow();
  });

  it("website visitors get one conversation; a phone links/creates the contact", async () => {
    const r1 = (await db.q<{ r: { conversation_id: string; contact_id: string | null; ai_mode: string } }>(`select public.ingest_web_message('pet-line', $1, null, null, null, 'כמה עולה תספורת?') as r`, [V]))[0]!.r;
    expect(r1.contact_id).toBeNull();
    expect(r1.ai_mode).toBe("auto");
    const r2 = (await db.q<{ r: { conversation_id: string; contact_id: string | null } }>(`select public.ingest_web_message('pet-line', $1, 'דנה כהן', null, '0541234567', 'הטלפון שלי') as r`, [V]))[0]!.r;
    expect(r2.conversation_id).toBe(r1.conversation_id);
    expect(r2.contact_id).toBeTruthy();
    const conv = (await db.q<{ title: string; channel: string; unread_count: number; contact_id: string }>(`select title, channel, unread_count, contact_id from conversations where id = $1`, [r1.conversation_id]))[0]!;
    expect(conv).toMatchObject({ title: "דנה כהן", channel: "web", unread_count: 2, contact_id: r2.contact_id });
    const c = (await db.q<{ first_name: string; phone: string; source: string }>(`select first_name, phone, source from contacts where id = $1`, [r2.contact_id]))[0]!;
    expect(c).toMatchObject({ first_name: "דנה", phone: "0541234567", source: "website_chat" });
    await expect(db.q(`select public.ingest_web_message('pet-line', 'not-hex', null, null, null, 'x')`)).rejects.toThrow();
    // signed-in users / anon can't call it directly (server only)
    await expect(db.as(owner, (q) => q(`select public.ingest_web_message('pet-line', $1, null, null, null, 'x')`, [V]))).rejects.toThrow();
    await expect(db.as(null, (q) => q(`select public.ingest_web_message('pet-line', $1, null, null, null, 'x')`, [V]))).rejects.toThrow();
  });

  it("e-mail ingest matches by address, keeps subject + threading metadata and de-duplicates", async () => {
    const tok = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name, config) values ($1, 'email', 'box', '{"address":"info@pet.test"}') returning webhook_token`, [org]))[0]!.webhook_token;
    const args = [tok, "dana@gmail.com", "Dana", "dana@gmail.com", "שלום, יש תור מחר?", "<m1@gmail.com>", "שאלה על תור"];
    const sql = `select public.ingest_channel_message_v2($1, 'email', $2, $3, null, $4, $5, $6, null, $7, '{"message_id":"<m1@gmail.com>"}'::jsonb) as r`;
    const r = (await db.q<{ r: { conversation_id: string; contact_id: string; organization_id: string } }>(sql, args))[0]!.r;
    expect(r.organization_id).toBe(org);
    const conv = (await db.q<{ subject: string; channel: string }>(`select subject, channel from conversations where id = $1`, [r.conversation_id]))[0]!;
    expect(conv).toEqual({ subject: "שאלה על תור", channel: "email" });
    const msg = (await db.q<{ meta: Record<string, string> }>(`select meta from messages where conversation_id = $1`, [r.conversation_id]))[0]!;
    expect(msg.meta).toMatchObject({ message_id: "<m1@gmail.com>", subject: "שאלה על תור" });
    const contact = (await db.q<{ email: string; source: string }>(`select email::text as email, source from contacts where id = $1`, [r.contact_id]))[0]!;
    expect(contact).toEqual({ email: "dana@gmail.com", source: "email" });
    const again = (await db.q<{ r: { duplicate?: boolean } }>(sql, args))[0]!.r;
    expect(again.duplicate).toBe(true);
    // QR WhatsApp uses the same path with phone matching
    const qrTok = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'whatsapp_qr', 'qr') returning webhook_token`, [org]))[0]!.webhook_token;
    const q = (await db.q<{ r: { contact_id: string } }>(`select public.ingest_channel_message_v2($1, 'whatsapp_qr', '972541234567', 'Dana', '+972541234567', null, 'היי', 'W1') as r`, [qrTok]))[0]!.r;
    expect(q.contact_id).toBeTruthy();
  });

  it("handoff switches the conversation to the team and notifies managers once", async () => {
    const conv = (await db.q<{ id: string }>(`select id from conversations where organization_id = $1 and channel = 'web'`, [org]))[0]!.id;
    await db.q(`select public.ai_handoff($1, 'customer_asked')`, [conv]);
    await db.q(`select public.ai_handoff($1, 'again')`, [conv]);
    const row = (await db.q<{ ai_mode: string; handoff_at: string | null }>(`select ai_mode, handoff_at from conversations where id = $1`, [conv]))[0]!;
    expect(row.ai_mode).toBe("human");
    expect(row.handoff_at).toBeTruthy();
    const n = await db.q<{ user_id: string; link: string; title_key: string }>(`select user_id, link, title_key from notifications where organization_id = $1 and kind = 'inbox'`, [org]);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ user_id: owner, link: `/inbox?c=${conv}`, title_key: "inbox.handoffNotification" });
    // the team can switch the AI back on (RLS: inbox.reply)
    await db.as(owner, (q) => q(`update conversations set ai_mode = 'auto' where id = $1`, [conv]), true);
    expect((await db.q<{ ai_mode: string }>(`select ai_mode from conversations where id = $1`, [conv]))[0]!.ai_mode).toBe("auto");
    expect(await db.as(outsider, (q) => q(`select id from conversations where id = $1`, [conv]))).toHaveLength(0);
  });

  it("meters automatic replies server-side with the plan's credits", async () => {
    const id = (await db.q<{ id: string }>(`select public.reserve_ai_credits_system($1, 'autopilot', $2) as id`, [org, agent]))[0]!.id;
    await db.q(`select public.finalize_ai_usage_system($1, 'gemini', 'gemini-flash-latest', 1800, 400, true)`, [id]);
    expect((await db.q<{ credits: number; feature: string; user_id: string | null }>(`select credits, feature, user_id from ai_usage where id = $1`, [id]))[0]).toEqual({ credits: 3, feature: "autopilot", user_id: null });
    await expect(db.as(owner, (q) => q(`select public.reserve_ai_credits_system($1, 'autopilot', null)`, [org]))).rejects.toThrow();
    await db.q(`update organizations set is_demo = true where id = $1`, [org]);
    await expect(db.q(`select public.reserve_ai_credits_system($1, 'autopilot', null)`, [org])).rejects.toThrow(/demo_mode/);
    await db.q(`update organizations set is_demo = false where id = $1`, [org]);
  });
});
