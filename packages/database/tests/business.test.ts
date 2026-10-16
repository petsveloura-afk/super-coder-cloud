import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0019: tickets + portal, finance documents/payments, sites, platform admin. */
d("business: tickets, finance, sites, platform admin (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let support: string;
  let sales: string;
  let analyst: string;
  let admin: string;
  let org: string;

  const anon = <T>(sql: string, params: unknown[] = []) => db.as(null, (q) => q<T & Record<string, unknown>>(sql, params), true);

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@b.test", "Biz Owner");
    support = await db.createUser("support@b.test", "Sue Port");
    sales = await db.createUser("sales@b.test");
    analyst = await db.createUser("analyst@b.test");
    admin = await db.createUser("admin@platform.test");
    await db.q(`insert into platform_admins (user_id) values ($1)`, [admin]);
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Biz Org', 'biz-org') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'business' where id = $1`, [org]);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'support'), ($1, $3, 'sales'), ($1, $4, 'analyst')`, [org, support, sales, analyst]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  describe("support", () => {
    let token: string;
    it("customer opens a ticket from the portal: numbered, contact linked, agents notified, event fired", async () => {
      const r = (await anon<{ r: { ok: boolean; number: number; token: string } }>(`select public.create_public_ticket('biz-org', 'Ella Ray', 'ella@b.test', 'Cannot log in', 'Help please', '{"ip_hash":"t1"}') as r`))[0]!.r;
      expect(r.ok).toBe(true);
      expect(r.number).toBe(1001);
      token = r.token;
      const tk = (await db.q<{ status: string; priority: string; sla_due_at: string; created_at: string; contact_id: string }>(`select status, priority, sla_due_at, created_at, contact_id from tickets where public_token = $1`, [token]))[0]!;
      expect(tk.status).toBe("open");
      expect(Date.parse(tk.sla_due_at) - Date.parse(tk.created_at)).toBe(24 * 3600 * 1000);
      expect(tk.contact_id).toBeTruthy();
      expect(await db.q(`select 1 from notifications where user_id = $1 and kind = 'ticket'`, [support])).toHaveLength(1);
      expect(await db.q(`select 1 from events where type = 'ticket.created'`)).toHaveLength(1);
      const bad = (await anon<{ r: { ok: boolean; error: string } }>(`select public.create_public_ticket('biz-org', 'x', 'not-email', 's', 'b', '{"ip_hash":"t2"}') as r`))[0]!.r;
      expect(bad.error).toBe("support.detailsRequired");
    });

    it("agent reply sets first response + pending; internal notes stay private; customer reply reopens", async () => {
      const id = (await db.q<{ id: string }>(`select id from tickets where public_token = $1`, [token]))[0]!.id;
      await db.as(support, (q) => q(`insert into ticket_messages (organization_id, ticket_id, author_type, author_id, body) values ($1, $2, 'agent', $3, 'Try resetting your password')`, [org, id, support]), true);
      await db.as(support, (q) => q(`insert into ticket_messages (organization_id, ticket_id, author_type, author_id, body, internal) values ($1, $2, 'agent', $3, 'VIP — be nice', true)`, [org, id, support]), true);
      let tk = (await db.q<{ status: string; first_response_at: string | null }>(`select status, first_response_at from tickets where id = $1`, [id]))[0]!;
      expect(tk.status).toBe("pending");
      expect(tk.first_response_at).not.toBeNull();
      const pub = (await anon<{ t: { messages: { author: string; body: string; agent: string | null }[] } }>(`select public.get_public_ticket($1) as t`, [token]))[0]!.t;
      expect(pub.messages.map((m) => m.body)).toEqual(["Help please", "Try resetting your password"]);
      expect(pub.messages[1]!.agent).toBe("Sue Port");
      await anon(`select public.reply_public_ticket($1, 'Still broken', '{"ip_hash":"r1"}')`, [token]);
      tk = (await db.q<{ status: string; first_response_at: string | null }>(`select status, first_response_at from tickets where id = $1`, [id]))[0]!;
      expect(tk.status).toBe("open");
    });

    it("customers cannot impersonate agents; analysts read but cannot write; resolved stamps resolved_at", async () => {
      const id = (await db.q<{ id: string }>(`select id from tickets where public_token = $1`, [token]))[0]!.id;
      await expect(db.as(support, (q) => q(`insert into ticket_messages (organization_id, ticket_id, author_type, author_id, body) values ($1, $2, 'customer', $3, 'fake')`, [org, id, support]))).rejects.toThrow();
      expect((await db.as(analyst, (q) => q(`select 1 from tickets where organization_id = $1`, [org]))).length).toBe(1);
      await expect(db.as(analyst, (q) => q(`insert into tickets (organization_id, subject) values ($1, 'x')`, [org]))).rejects.toThrow();
      await db.as(support, (q) => q(`update tickets set status = 'resolved' where id = $1`, [id]), true);
      expect((await db.q<{ resolved_at: string | null }>(`select resolved_at from tickets where id = $1`, [id]))[0]!.resolved_at).not.toBeNull();
      await db.as(support, (q) => q(`update tickets set status = 'closed' where id = $1`, [id]), true);
      const r = (await anon<{ r: { ok: boolean; error: string } }>(`select public.reply_public_ticket($1, 'again', '{"ip_hash":"r2"}') as r`, [token]))[0]!.r;
      expect(r.error).toBe("support.ticketClosed");
    });
  });

  describe("finance", () => {
    let quoteId: string;
    let quoteToken: string;
    let invoiceId: string;
    let invoiceToken: string;

    it("quote: numbered, lines compute totals (discount + VAT), draft is not public", async () => {
      const contact = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Buyer', 'buyer@b.test') returning id`, [org]))[0]!.id;
      const row = await db.as(sales, async (q) => (await q<{ id: string; public_token: string; number: number }>(`insert into documents (organization_id, kind, contact_id, due_date) values ($1, 'quote', $2, current_date + 14) returning id, public_token, number`, [org, contact]))[0]!, true);
      quoteId = row.id;
      quoteToken = row.public_token;
      expect(row.number).toBe(1001);
      await db.as(sales, (q) => q(`insert into document_lines (organization_id, document_id, description, quantity, unit_price, discount_pct, tax_rate, position) values ($1, $2, 'Website', 1, 1000, 10, 18, 0), ($1, $2, 'Hosting', 12, 50, 0, 18, 1)`, [org, quoteId]), true);
      const doc = (await db.q<{ subtotal: string; tax_total: string; total: string }>(`select subtotal, tax_total, total from documents where id = $1`, [quoteId]))[0]!;
      expect(doc).toEqual({ subtotal: "1500.00", tax_total: "270.00", total: "1770.00" });
      expect((await anon<{ d: unknown }>(`select public.get_public_document($1) as d`, [quoteToken]))[0]!.d).toBeNull();
    });

    it("sent quote is public and can be accepted once by name", async () => {
      await db.as(sales, (q) => q(`update documents set status = 'sent' where id = $1`, [quoteId]), true);
      const pub = (await anon<{ d: { total: string; lines: unknown[]; customer: { name: string } } }>(`select public.get_public_document($1) as d`, [quoteToken]))[0]!.d;
      expect(Number(pub.total)).toBe(1770);
      expect(pub.lines).toHaveLength(2);
      expect(pub.customer.name).toBe("Buyer");
      expect((await anon<{ r: { ok: boolean } }>(`select public.accept_public_quote($1, 'Buyer Name') as r`, [quoteToken]))[0]!.r.ok).toBe(true);
      expect((await anon<{ r: { ok: boolean } }>(`select public.accept_public_quote($1, 'Again') as r`, [quoteToken]))[0]!.r.ok).toBe(false);
      expect((await db.q<{ status: string; accepted_by_name: string }>(`select status, accepted_by_name from documents where id = $1`, [quoteId]))[0]).toEqual({ status: "accepted", accepted_by_name: "Buyer Name" });
    });

    it("invoice: partial then full payment → paid + invoice.paid event; refund reverts", async () => {
      const row = await db.as(sales, async (q) => (await q<{ id: string; public_token: string; number: number }>(`insert into documents (organization_id, kind, status) values ($1, 'invoice', 'sent') returning id, public_token, number`, [org]))[0]!, true);
      invoiceId = row.id;
      invoiceToken = row.public_token;
      expect(row.number).toBe(1001); // separate sequence per kind
      await db.as(sales, (q) => q(`insert into document_lines (organization_id, document_id, description, quantity, unit_price, tax_rate) values ($1, $2, 'Service', 1, 100, 18)`, [org, invoiceId]), true);
      await db.as(sales, (q) => q(`insert into payments (organization_id, document_id, amount, method) values ($1, $2, 50, 'bit')`, [org, invoiceId]), true);
      expect((await db.q<{ status: string; amount_paid: string }>(`select status, amount_paid from documents where id = $1`, [invoiceId]))[0]).toEqual({ status: "sent", amount_paid: "50.00" });
      await db.q(`set role service_role`);
      try {
        await db.q(`select public.record_online_payment($1, 68, 'cs_test_1')`, [invoiceToken]);
        await db.q(`select public.record_online_payment($1, 68, 'cs_test_1')`, [invoiceToken]); // webhook retry: idempotent
      } finally {
        await db.q(`reset role`);
      }
      const doc = (await db.q<{ status: string; amount_paid: string; paid_at: string | null }>(`select status, amount_paid, paid_at from documents where id = $1`, [invoiceId]))[0]!;
      expect(doc.status).toBe("paid");
      expect(doc.amount_paid).toBe("118.00");
      expect(await db.q(`select 1 from events where type = 'invoice.paid'`)).toHaveLength(1);
      await db.q(`delete from payments where external_id = 'cs_test_1'`);
      expect((await db.q<{ status: string }>(`select status from documents where id = $1`, [invoiceId]))[0]!.status).toBe("sent");
    });

    it("permissions: analysts read finance, support has none, quotes can't be 'paid'", async () => {
      expect((await db.as(analyst, (q) => q(`select 1 from documents where organization_id = $1`, [org]))).length).toBe(2);
      expect(await db.as(support, (q) => q(`select 1 from documents where organization_id = $1`, [org]))).toHaveLength(0);
      await expect(db.as(analyst, (q) => q(`insert into products (organization_id, name) values ($1, 'x')`, [org]))).rejects.toThrow();
      await expect(db.q(`update documents set status = 'paid' where id = $1`, [quoteId])).rejects.toThrow(/invalid_status/);
      await expect(db.as(owner, (q) => q(`select stripe_secret_enc from finance_settings`))).rejects.toThrow(/permission denied/);
      await expect(db.as(owner, (q) => q(`select public.record_online_payment($1, 1, 'x')`, [invoiceToken]))).rejects.toThrow(/permission denied/);
    });
  });

  describe("sites", () => {
    it("only published sites are public; visits counted once per visitor per day", async () => {
      await db.as(owner, (q) => q(`insert into sites (organization_id, name, slug, blocks) values ($1, 'Landing', 'biz-landing', '[{"type":"hero","data":{"title":"Hi"}}]')`, [org]), true);
      expect((await anon<{ s: unknown }>(`select public.get_public_site('biz-landing') as s`))[0]!.s).toBeNull();
      await db.q(`update sites set status = 'published' where slug = 'biz-landing'`);
      const s = (await anon<{ s: { blocks: { type: string }[]; org: string } }>(`select public.get_public_site('biz-landing') as s`))[0]!.s;
      expect(s.blocks[0]!.type).toBe("hero");
      expect(s.org).toBe("Biz Org");
      await anon(`select public.track_site_visit('biz-landing', '{"ip_hash":"v1"}')`);
      await anon(`select public.track_site_visit('biz-landing', '{"ip_hash":"v1"}')`);
      await anon(`select public.track_site_visit('biz-landing', '{"ip_hash":"v2"}')`);
      expect((await db.q<{ visits: number }>(`select visits from sites where slug = 'biz-landing'`))[0]!.visits).toBe(2);
      await expect(db.as(sales, (q) => q(`insert into sites (organization_id, name, slug) values ($1, 'x', 'sales-site')`, [org]))).rejects.toThrow();
    });
  });

  describe("platform admin", () => {
    it("overview, organizations and flags are platform-admin only", async () => {
      const o = await db.as(admin, async (q) => (await q<{ r: { organizations: number } }>(`select public.platform_overview() as r`))[0]!.r);
      expect(o.organizations).toBeGreaterThanOrEqual(1);
      const orgs = await db.as(admin, (q) => q<{ name: string; owner_email: string; members: number }>(`select * from public.platform_organizations('biz', 10, 0)`));
      expect(orgs[0]).toMatchObject({ name: "Biz Org", owner_email: "owner@b.test" });
      await db.as(admin, (q) => q(`select public.platform_set_flag('beta.sites', $1, true)`, [org]), true);
      expect((await db.q<{ enabled: boolean }>(`select enabled from feature_flags where key = 'beta.sites' and organization_id = $1`, [org]))[0]!.enabled).toBe(true);
      await expect(db.as(owner, (q) => q(`select public.platform_overview()`))).rejects.toThrow(/forbidden/);
      await expect(db.as(owner, (q) => q(`select public.platform_set_flag('x.y', null, true)`))).rejects.toThrow(/forbidden/);
    });

    it("0020: platform_flags lists all flags for admins only; plan change through admin_set_plan", async () => {
      const flags = await db.as(admin, (q) => q<{ key: string; organization_name: string; enabled: boolean }>(`select * from public.platform_flags()`));
      expect(flags.some((f) => f.key === "beta.sites" && f.organization_name === "Biz Org" && f.enabled)).toBe(true);
      await expect(db.as(owner, (q) => q(`select * from public.platform_flags()`))).rejects.toThrow(/forbidden/);
      await db.as(admin, (q) => q(`select public.admin_set_plan($1, 'enterprise', null)`, [org]), true);
      expect((await db.q<{ plan: string }>(`select plan from organizations where id = $1`, [org]))[0]!.plan).toBe("enterprise");
      await expect(db.as(owner, (q) => q(`select public.admin_set_plan($1, 'free', null)`, [org]))).rejects.toThrow(/forbidden/);
    });
  });
});
