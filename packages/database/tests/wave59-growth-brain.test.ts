import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/**
 * Wave 59: learning from the owner (trigger), coach reports, A/B opener column, phone settings, chat
 * payments (paid trigger), review gates, minute packs (voice ledger) — tenant isolation everywhere.
 */
d("wave 59 growth brain (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let other: string;
  let owner: string;
  let outsider: string;
  let conv: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@w59.test", "W59 Owner");
    outsider = await db.createUser("out@w59.test", "W59 Out");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('W59', 'w59-biz') as id`))[0]!.id, true);
    other = await db.as(outsider, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'w59-other') as id`))[0]!.id, true);
    conv = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, title) values ($1, 'telegram', 'c1', 'Dana') returning id`, [org]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("a person answering a customer's question becomes a learning suggestion; AI / system / non-questions do not", async () => {
    await db.q(`insert into messages (organization_id, conversation_id, direction, body) values ($1, $2, 'in', 'כמה עולה תספורת לכלב גדול?')`, [org, conv]);
    await db.q(`insert into messages (organization_id, conversation_id, direction, body, sent_by) values ($1, $2, 'out', '220 ₪ כולל רחצה וייבוש', $3)`, [org, conv, owner]);
    const rows = await db.q<{ question: string; answer: string; status: string }>(`select question, answer, status from ai_learning_suggestions where organization_id = $1`, [org]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question: "כמה עולה תספורת לכלב גדול?", answer: "220 ₪ כולל רחצה וייבוש", status: "pending" });
    // the AI's own reply and a plain greeting do not create suggestions
    await db.q(`insert into messages (organization_id, conversation_id, direction, body) values ($1, $2, 'in', 'תודה רבה')`, [org, conv]);
    await db.q(`insert into messages (organization_id, conversation_id, direction, body, sent_by) values ($1, $2, 'out', 'בשמחה, נתראה בקרוב!', $3)`, [org, conv, owner]);
    await db.q(`insert into messages (organization_id, conversation_id, direction, body) values ($1, $2, 'in', 'יש חניה?')`, [org, conv]);
    await db.q(`insert into messages (organization_id, conversation_id, direction, body, meta) values ($1, $2, 'out', 'יש חניה חינם מול העסק', '{"system":"agent"}')`, [org, conv]);
    expect(await db.q(`select id from ai_learning_suggestions where organization_id = $1`, [org])).toHaveLength(1);
  });

  it("suggestions and coach reports are private to the business and written only by the server", async () => {
    await db.q(`insert into ai_coach_reports (organization_id, week_start, stats) values ($1, '2026-10-25', '{"conversations":3}')`, [org]);
    await expect(db.q(`insert into ai_coach_reports (organization_id, week_start) values ($1, '2026-10-25')`, [org])).rejects.toThrow();
    expect(await db.as(owner, (q) => q(`select id from ai_learning_suggestions`))).toHaveLength(1);
    expect(await db.as(outsider, (q) => q(`select id from ai_learning_suggestions`))).toHaveLength(0);
    expect(await db.as(outsider, (q) => q(`select id from ai_coach_reports`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`update ai_learning_suggestions set status = 'approved'`))).rejects.toThrow();
  });

  it("opener variant is 0/1 only; call purpose and recording are validated", async () => {
    await db.q(`update conversations set opener_variant = 1 where id = $1`, [conv]);
    await expect(db.q(`update conversations set opener_variant = 2 where id = $1`, [conv])).rejects.toThrow();
    await db.q(`insert into voice_calls (organization_id, direction, purpose, recording_sid, recording_url, recording_sec) values ($1, 'out', 'reminder', 'RE${"a".repeat(32)}', 'https://api.twilio.com/x', 12)`, [org]);
    await expect(db.q(`insert into voice_calls (organization_id, direction, purpose) values ($1, 'out', 'spam')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into voice_calls (organization_id, direction, recording_url) values ($1, 'in', 'http://insecure')`, [org])).rejects.toThrow();
  });

  it("phone settings: members read, managers write their own business only", async () => {
    await db.as(owner, (q) => q(`insert into phone_settings (organization_id, record_calls) values ($1, true)`, [org]), true);
    expect(await db.as(owner, (q) => q<{ missed_text: boolean }>(`select missed_text from phone_settings`))).toEqual([{ missed_text: true }]);
    await expect(db.as(owner, (q) => q(`insert into phone_settings (organization_id) values ($1)`, [other]))).rejects.toThrow();
    expect(await db.as(outsider, (q) => q(`select organization_id from phone_settings`))).toHaveLength(0);
  });

  it("a paid invoice marks the chat payment as paid and tells the team", async () => {
    const doc = (await db.q<{ id: string }>(`insert into documents (organization_id, kind, title, status) values ($1, 'invoice', 'מקדמה', 'sent') returning id`, [org]))[0]!.id;
    await db.q(`insert into chat_payments (organization_id, conversation_id, document_id, amount, description) values ($1, $2, $3, 100, 'מקדמה')`, [org, conv, doc]);
    await db.q(`update documents set status = 'paid' where id = $1`, [doc]);
    expect((await db.q<{ status: string }>(`select status from chat_payments where document_id = $1`, [doc]))[0]!.status).toBe("paid");
    expect(await db.q(`select id from notifications where organization_id = $1 and title_key = 'payChat.paidNotification'`, [org])).toHaveLength(1);
  });

  it("review gates are validated and private", async () => {
    const c = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name) values ($1, 'Dana') returning id`, [org]))[0]!.id;
    await db.q(`insert into review_gates (organization_id, contact_id, review_url) values ($1, $2, 'https://g.page/r/x')`, [org, c]);
    await expect(db.q(`insert into review_gates (organization_id, contact_id, rating) values ($1, $2, 9)`, [org, c])).rejects.toThrow();
    expect(await db.as(outsider, (q) => q(`select id from review_gates`))).toHaveLength(0);
  });

  it("minute packs add phone minutes, AI packs still add AI credits", async () => {
    const mp = (await db.q<{ id: string }>(`insert into credit_purchases (organization_id, pack, credits, amount, provider) values ($1, 'min_100', 100, 12, 'manual') returning id`, [org]))[0]!.id;
    const ap = (await db.q<{ id: string }>(`insert into credit_purchases (organization_id, pack, credits, amount, provider) values ($1, 'ai_500', 500, 9, 'manual') returning id`, [org]))[0]!.id;
    expect((await db.q<{ r: { ok: boolean; minutes: boolean } }>(`select public.grant_credit_purchase($1, 12, 'USD') as r`, [mp]))[0]!.r).toMatchObject({ ok: true, minutes: true });
    expect((await db.q<{ r: { ok: boolean; minutes: boolean } }>(`select public.grant_credit_purchase($1, 9, 'USD') as r`, [ap]))[0]!.r).toMatchObject({ ok: true, minutes: false });
    expect(Number((await db.q<{ b: string }>(`select public.voice_minutes_balance($1) as b`, [org]))[0]!.b)).toBe(100);
    expect(Number((await db.q<{ b: string }>(`select public.ai_credit_balance($1) as b`, [org]))[0]!.b)).toBe(500);
    await db.q(`insert into credit_ledger (organization_id, kind, delta, reason) values ($1, 'voice', -30, 'usage')`, [org]);
    expect(Number((await db.q<{ b: string }>(`select public.voice_minutes_balance($1) as b`, [org]))[0]!.b)).toBe(70);
    await expect(db.q(`insert into credit_ledger (organization_id, kind, delta, reason) values ($1, 'other', 1, 'admin')`, [org])).rejects.toThrow();
  });
});
