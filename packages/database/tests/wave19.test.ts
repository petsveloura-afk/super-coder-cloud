import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 19 (real Postgres): Messenger / Instagram channels, social comments + posts, stores, reviews, the AI team. */
d("wave 19 (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let outsider: string;
  let org: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@w19.test", "Owner Nineteen");
    outsider = await db.createUser("x@w19.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Nineteen', 'nineteen-biz') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'business' where id = $1`, [org]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("Messenger / Instagram are channels: ingest, AI agents answer them, owner echo takes over", async () => {
    const tok = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name, config) values ($1, 'instagram', '@shop', '{"ig_id":"178414","page_id":"1055"}') returning webhook_token`, [org]))[0]!.webhook_token;
    const r = (await db.q<{ r: { ok: boolean; conversation_id: string } }>(`select public.ingest_channel_message_v2($1, 'instagram', '9876543210', 'Dana', null, null, 'כמה עולה?', 'mid.1') as r`, [tok]))[0]!.r;
    expect(r.ok).toBe(true);
    const conv = (await db.q<{ channel: string; ai_mode: string }>(`select channel, ai_mode from conversations where id = $1`, [r.conversation_id]))[0]!;
    expect(conv).toMatchObject({ channel: "instagram", ai_mode: "auto" });
    // agents may answer the new channels
    await db.q(`insert into ai_agents (organization_id, name, model, autopilot_channels) values ($1, 'Noa', 'gemini-flash-latest', array['web', 'instagram', 'messenger'])`, [org]);
    // the owner answered from the Instagram app → the agent steps back
    const e = (await db.q<{ r: { ok: boolean; owner: boolean } }>(`select public.ingest_owner_message_meta($1, 'instagram', '9876543210', 'היי, כאן הבעלים', 'mid.2') as r`, [tok]))[0]!.r;
    expect(e.owner).toBe(true);
    expect((await db.q<{ ai_mode: string }>(`select ai_mode from conversations where id = $1`, [r.conversation_id]))[0]!.ai_mode).toBe("human");
    await expect(db.q(`select public.ingest_owner_message_meta($1, 'whatsapp', '123', 'x', 'm')`, [tok])).rejects.toThrow(/invalid_kind/);
  });

  it("the guard applies Meta's 24-hour window to Messenger / Instagram follow-ups", async () => {
    const tok = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name, config) values ($1, 'messenger', 'Page', '{"page_id":"2001"}') returning webhook_token`, [org]))[0]!.webhook_token;
    const r = (await db.q<{ r: { conversation_id: string } }>(`select public.ingest_channel_message_v2($1, 'messenger', '5550001', 'Ron', null, null, 'שלום', 'm.1') as r`, [tok]))[0]!.r;
    await db.q(`update messages set created_at = now() - interval '30 hours' where conversation_id = $1`, [r.conversation_id]);
    await db.q(`update conversations set last_customer_at = now() - interval '30 hours', last_auto_at = null where id = $1`, [r.conversation_id]).catch(() => undefined);
    const g = (await db.q<{ g: { allowed: boolean; reason: string } }>(`select public.outbound_guard($1, 'followup', null, false) as g`, [r.conversation_id]))[0]!.g;
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe("outside_24h");
  });

  it("social comments are stored once, raise social.comment, and are visible to members only", async () => {
    const a = (await db.q<{ r: { ok: boolean; id: string } }>(`select public.record_social_comment($1, 'facebook', 'c_1', 'p_1', null, 'u1', 'Yael', 'כמה עולה?', 'lead') as r`, [org]))[0]!.r;
    expect(a.id).toBeTruthy();
    const again = (await db.q<{ r: { duplicate: boolean } }>(`select public.record_social_comment($1, 'facebook', 'c_1', 'p_1', null, 'u1', 'Yael', 'כמה עולה?', 'lead') as r`, [org]))[0]!.r;
    expect(again.duplicate).toBe(true);
    expect(await db.q(`select 1 from events where organization_id = $1 and type = 'social.comment'`, [org])).toHaveLength(1);
    const mine = await db.as(owner, (q) => q(`select id from social_comments`));
    expect(mine).toHaveLength(1);
    const theirs = await db.as(outsider, (q) => q(`select id from social_comments`));
    expect(theirs).toHaveLength(0);
  });

  it("scheduled social posts are claimed once when due", async () => {
    await db.as(owner, (q) => q(`insert into social_posts (organization_id, platforms, body, scheduled_at, status) values ($1, array['facebook'], 'פוסט', now() - interval '1 minute', 'scheduled'), ($1, array['facebook'], 'later', now() + interval '1 day', 'scheduled')`, [org]), true);
    const first = await db.q<{ id: string }>(`select id from public.claim_due_social_posts(10)`);
    expect(first).toHaveLength(1);
    expect(await db.q(`select id from public.claim_due_social_posts(10)`)).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`insert into social_posts (organization_id, platforms, body) values ($1, array['tiktok'], 'x')`, [org]))).rejects.toThrow();
  });

  it("store orders: contact matched/created, customer status, order.created once, carts recovered", async () => {
    const cart = (await db.q<{ r: { ok: boolean; id: string; contact_id: string } }>(`select public.record_store_cart($1, 'shopify', $2) as r`, [org, JSON.stringify({ id: "chk_1", email: "Buyer@Shop.Test", name: "Avi Cohen", total: 320, currency: "ILS", checkout_url: "https://shop.test/c/1", consent: true })]))[0]!.r;
    expect(cart.ok).toBe(true);
    const o = (await db.q<{ r: { ok: boolean; id: string; contact_id: string } }>(`select public.record_store_order($1, 'shopify', $2) as r`, [org, JSON.stringify({ id: "1001", number: "#1001", email: "buyer@shop.test", name: "Avi Cohen", total: 320, currency: "ILS", status: "paid", items: [{ name: "Shampoo", qty: 2, price: 160 }] })]))[0]!.r;
    expect(o.ok).toBe(true);
    expect(o.contact_id).toBe(cart.contact_id);
    expect((await db.q<{ status: string }>(`select status from contacts where id = $1`, [o.contact_id]))[0]!.status).toBe("customer");
    expect((await db.q<{ status: string }>(`select status from store_carts where id = $1`, [cart.id]))[0]!.status).toBe("recovered");
    // the same order again (orders/paid after orders/create) → updated, no second event
    await db.q(`select public.record_store_order($1, 'shopify', $2)`, [org, JSON.stringify({ id: "1001", total: 320, status: "paid", email: "buyer@shop.test" })]);
    expect(await db.q(`select 1 from events where organization_id = $1 and type = 'order.created'`, [org])).toHaveLength(1);
    // a cart without e-mail or phone is not stored
    const none = (await db.q<{ r: { ok: boolean } }>(`select public.record_store_cart($1, 'shopify', '{"id":"chk_2"}') as r`, [org]))[0]!.r;
    expect(none.ok).toBe(false);
  });

  it("abandoned carts: after a quiet hour → cart.abandoned once", async () => {
    await db.q(`select public.record_store_cart($1, 'shopify', $2)`, [org, JSON.stringify({ id: "chk_3", phone: "0541231234", name: "Lea", total: 90 })]);
    expect(await db.q(`select * from public.claim_abandoned_carts(10)`)).toHaveLength(0);
    await db.q(`update store_carts set updated_at = now() - interval '2 hours' where external_id = 'chk_3'`);
    expect(await db.q(`select * from public.claim_abandoned_carts(10)`)).toHaveLength(1);
    expect(await db.q(`select * from public.claim_abandoned_carts(10)`)).toHaveLength(0);
    expect(await db.q(`select 1 from events where organization_id = $1 and type = 'cart.abandoned'`, [org])).toHaveLength(1);
  });

  it("reviews: stored once, review.received only for unanswered reviews", async () => {
    await db.q(`select public.record_review($1, 'google', 'accounts/1/locations/2', 'accounts/1/locations/2/reviews/a', 'Moshe', 5, 'שירות מעולה', null, now())`, [org]);
    await db.q(`select public.record_review($1, 'google', 'accounts/1/locations/2', 'accounts/1/locations/2/reviews/a', 'Moshe', 5, 'שירות מעולה', null, now())`, [org]);
    await db.q(`select public.record_review($1, 'google', 'accounts/1/locations/2', 'accounts/1/locations/2/reviews/b', 'Dina', 4, 'טוב', 'תודה!', now())`, [org]);
    expect(await db.q(`select 1 from reviews where organization_id = $1`, [org])).toHaveLength(2);
    expect(await db.q(`select 1 from events where organization_id = $1 and type = 'review.received'`, [org])).toHaveLength(1);
  });

  it("the AI team: agents are claimed once per interval, stuck deals and overdue invoices are found, agent events are deduplicated", async () => {
    await db.as(owner, (q) => q(`insert into agent_settings (organization_id, agent, enabled) values ($1, 'sales_manager', true), ($1, 'collections', false)`, [org]), true);
    expect(await db.q(`select * from public.claim_due_agents('sales_manager', 60, 10)`)).toHaveLength(1);
    expect(await db.q(`select * from public.claim_due_agents('sales_manager', 60, 10)`)).toHaveLength(0);
    expect(await db.q(`select * from public.claim_due_agents('collections', 60, 10)`)).toHaveLength(0);
    // a deal quiet for 10 days
    const pipe = (await db.q<{ stage: string }>(`select s.id as stage from pipeline_stages s join pipelines p on p.id = s.pipeline_id where p.organization_id = $1 order by s.position limit 1`, [org]))[0];
    if (pipe) {
      const deal = (await db.q<{ id: string }>(`insert into deals (organization_id, title, value, stage_id, pipeline_id) select $1, 'Big deal', 9000, $2, s.pipeline_id from pipeline_stages s where s.id = $2 returning id`, [org, pipe.stage]))[0]!.id;
      await db.q(`set session_replication_role = replica`);
      await db.q(`update deals set updated_at = now() - interval '10 days' where id = $1`, [deal]);
      await db.q(`set session_replication_role = origin`);
      await db.q(`update activities set created_at = now() - interval '10 days' where deal_id = $1`, [deal]);
      const stuck = await db.q<{ id: string; days_quiet: number }>(`select * from public.stuck_deals($1, 7, 10)`, [org]);
      expect(stuck.map((s) => s.id)).toContain(deal);
      expect((await db.q<{ ok: boolean }>(`select public.agent_emit($1, 'deal.stuck', 'deal', $2, '{}') as ok`, [org, deal]))[0]!.ok).toBe(true);
      expect((await db.q<{ ok: boolean }>(`select public.agent_emit($1, 'deal.stuck', 'deal', $2, '{}') as ok`, [org, deal]))[0]!.ok).toBe(false);
    }
    await expect(db.q(`select public.agent_emit($1, 'contact.created', 'contact', gen_random_uuid(), '{}')`, [org])).rejects.toThrow(/invalid_event/);
    // an overdue invoice with a balance
    const c = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Payer', 'payer@x.test') returning id`, [org]))[0]!.id;
    const inv = (await db.q<{ id: string }>(`insert into documents (organization_id, kind, status, contact_id, due_date) values ($1, 'invoice', 'sent', $2, current_date - 5) returning id`, [org, c]))[0]!.id;
    await db.q(`insert into document_lines (organization_id, document_id, description, quantity, unit_price, tax_rate) values ($1, $2, 'Work', 1, 500, 0)`, [org, inv]);
    const od = await db.q<{ id: string; days_overdue: number; reminders: number }>(`select * from public.overdue_invoices($1, 3, 10)`, [org]);
    expect(od.find((x) => x.id === inv)).toMatchObject({ days_overdue: 5, reminders: 0 });
    // a reminder logged today → not again within the gap
    await db.q(`insert into activities (organization_id, contact_id, type, payload) values ($1, $2, 'invoice.reminded', $3)`, [org, c, JSON.stringify({ document_id: inv })]);
    expect((await db.q<{ id: string }>(`select * from public.overdue_invoices($1, 3, 10)`, [org])).find((x) => x.id === inv)).toBeUndefined();
  });

  it("new automation triggers and AI features are accepted", async () => {
    await db.as(owner, (q) => q(`insert into automations (organization_id, name, trigger_type) values ($1, 'orders', 'order.created'), ($1, 'reviews', 'review.received'), ($1, 'stuck', 'deal.stuck')`, [org]), true);
    expect(await db.q(`select 1 from automations where organization_id = $1 and trigger_type in ('order.created', 'review.received', 'deal.stuck')`, [org])).toHaveLength(3);
    const ok = await db.q(`select public.reserve_ai_credits_system($1, 'brief', null) as id`, [org]);
    expect(ok).toHaveLength(1);
  });
});
