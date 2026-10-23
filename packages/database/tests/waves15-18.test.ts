import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/**
 * Waves 15-18 (real Postgres): one conversation state for every channel, conditional
 * forms + website behavior automations, smart campaign audience, appointment
 * reminders, quota / price overrides, AI credit packs and growth metrics.
 */
d("waves 15-18 (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let sales: string;
  let admin: string;
  let org: string;
  let contact: string;
  let conv: string;
  let agent: string;

  const pending = async (kind = "followup") =>
    db.q<{ id: string; status: string; reason: string | null }>(`select id, status, reason from conversation_schedules where conversation_id = $1 and kind = $2 order by created_at`, [conv, kind]);

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@w15.test", "Owner");
    sales = await db.createUser("sales@w15.test", "Sales");
    admin = await db.createUser("admin@w15.test", "Platform Admin");
    await db.q(`insert into platform_admins (user_id) values ($1)`, [admin]);
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Wave Biz', 'wave-biz') as id`))[0]!.id, true);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'sales')`, [org, sales]);
    contact = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, last_name, phone, email, marketing_consent, source) values ($1, 'Dana', 'Levi', '0541112233', 'dana@x.co', true, 'facebook') returning id`, [org]))[0]!.id;
    conv = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, contact_id, title) values ($1, 'telegram', '777', $2, 'Dana') returning id`, [org, contact]))[0]!.id;
    agent = (await db.q<{ id: string }>(`insert into ai_agents (organization_id, name, model, followup_hours) values ($1, 'Noa', 'gemini-flash-latest', 3) returning id`, [org]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  const inbound = (body: string) => db.q(`insert into messages (organization_id, conversation_id, direction, body) values ($1, $2, 'in', $3)`, [org, conv, body]);
  const aiReply = (body = "תשובה") => db.q(`insert into messages (organization_id, conversation_id, direction, body, status, ai_agent_id) values ($1, $2, 'out', $3, 'sent', $4)`, [org, conv, body, agent]);

  describe("one conversation state for all channels", () => {
    it("an AI answer plans a follow-up; the customer's reply cancels it at once", async () => {
      await inbound("כמה עולה?");
      await aiReply();
      let s = await pending();
      expect(s.at(-1)).toMatchObject({ status: "pending" });
      const runAt = (await db.q<{ h: number }>(`select extract(epoch from run_at - now()) / 3600 as h from conversation_schedules where id = $1`, [s.at(-1)!.id]))[0]!.h;
      expect(Number(runAt)).toBeGreaterThan(2.9);
      await inbound("תודה, אחשוב על זה");
      s = await pending();
      expect(s.at(-1)).toMatchObject({ status: "canceled", reason: "customer_replied" });
    });

    it("a person answering cancels automated follow-ups; one pending follow-up per customer", async () => {
      await aiReply();
      await aiReply("עוד");
      const s1 = await pending();
      expect(s1.filter((x) => x.status === "pending")).toHaveLength(1);
      expect(s1.some((x) => x.reason === "replanned")).toBe(true);
      await db.q(`insert into messages (organization_id, conversation_id, direction, body, status, sent_by) values ($1, $2, 'out', 'אני כאן', 'sent', $3)`, [org, conv, owner]);
      const s2 = await pending();
      expect(s2.filter((x) => x.status === "pending")).toHaveLength(0);
      expect(s2.at(-1)!.reason).toBe("human_replied");
      // the AI may not follow up after a person answered (until the customer writes again)
      const g = (await db.q<{ r: { allowed: boolean; reason: string } }>(`select public.outbound_guard($1, 'followup') as r`, [conv]))[0]!.r;
      expect(g).toMatchObject({ allowed: false, reason: "human_answered" });
    });

    it("STOP on any channel: everything stops on every channel, reminders still allowed", async () => {
      const other = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, contact_id) values ($1, 'sms', '+972541112233', $2) returning id`, [org, contact]))[0]!.id;
      await inbound("מה עם התור?");
      await aiReply();
      expect((await pending()).filter((x) => x.status === "pending")).toHaveLength(1);
      await db.q(`insert into messages (organization_id, conversation_id, direction, body) values ($1, $2, 'in', 'הסר')`, [org, other]);
      expect((await pending()).filter((x) => x.status === "pending")).toHaveLength(0);
      const c = (await db.q<{ opted_out_at: string | null; marketing_consent: boolean }>(`select opted_out_at, marketing_consent from contacts where id = $1`, [contact]))[0]!;
      expect(c.opted_out_at).not.toBeNull();
      expect(c.marketing_consent).toBe(false);
      expect((await db.q<{ opt_out: boolean }>(`select opt_out from conversations where id = $1`, [conv]))[0]!.opt_out).toBe(true);
      for (const kind of ["campaign", "followup", "automation", "scheduled"]) {
        const g = (await db.q<{ r: { allowed: boolean; reason: string } }>(`select public.outbound_guard($1, $2) as r`, [conv, kind]))[0]!.r;
        expect(g.allowed, kind).toBe(false);
      }
      expect((await db.q<{ r: { allowed: boolean } }>(`select public.outbound_guard($1, 'reminder') as r`, [conv]))[0]!.r.allowed).toBe(true);
      expect((await db.q<{ r: { reason: string } }>(`select public.contact_can_receive($1, 'automation') as r`, [contact]))[0]!.r.reason).toBe("opted_out");
      // the customer can come back
      await inbound("START");
      expect((await db.q<{ opted_out_at: string | null }>(`select opted_out_at from contacts where id = $1`, [contact]))[0]!.opted_out_at).toBeNull();
    });

    it("scheduled messages need inbox.reply; blocked decisions are logged", async () => {
      await expect(db.as(null, (q) => q(`select public.schedule_conversation_message($1, 'hi', now() + interval '1 hour')`, [conv]))).rejects.toThrow();
      const id = await db.as(sales, async (q) => (await q<{ id: string }>(`select public.schedule_conversation_message($1, 'מזכירים את ההצעה', now() + interval '1 hour') as id`, [conv]))[0]!.id, true);
      expect(id).toBeTruthy();
      expect((await db.q(`select 1 from conversation_guard_log where conversation_id = $1`, [conv])).length).toBeGreaterThan(0);
    });
  });

  describe("conditional forms + website behavior", () => {
    let formSlug: string;
    beforeAll(async () => {
      formSlug = (
        await db.q<{ slug: string }>(
          `insert into forms (organization_id, name, slug, fields) values ($1, 'Lead', 'lead-w17', $2::jsonb) returning slug`,
          [
            org,
            JSON.stringify([
              { key: "email", label: "Email", type: "email", required: true },
              { key: "kind", label: "Kind", type: "select", required: true, options: ["home", "business"] },
              { key: "company", label: "Company", type: "text", required: true, step: 2, show_if: { field: "kind", op: "eq", value: "business" } },
            ]),
          ],
        )
      )[0]!.slug;
      await db.q(`insert into sites (organization_id, name, slug, status, blocks) values ($1, 'Landing', 'wave-landing', 'published', '[{"type":"hero","data":{"title":"Hi"}}]')`, [org]);
    });

    it("a hidden field is neither required nor stored; a visible one is required", async () => {
      const ok = await db.as(null, async (q) => (await q<{ r: { ok: boolean } }>(`select public.submit_form($1, '{"email":"h@x.co","kind":"home","company":"sneaky"}'::jsonb, '{}'::jsonb) as r`, [formSlug]))[0]!.r, true);
      expect(ok.ok).toBe(true);
      const stored = (await db.q<{ data: Record<string, string> }>(`select data from form_submissions where data ->> 'email' = 'h@x.co'`))[0]!.data;
      expect(stored.company).toBeUndefined();
      const bad = await db.as(null, async (q) => (await q<{ r: { ok: boolean; errors: Record<string, string> } }>(`select public.submit_form($1, '{"email":"b@x.co","kind":"business"}'::jsonb, '{}'::jsonb) as r`, [formSlug]))[0]!.r);
      expect(bad.ok).toBe(false);
      expect(Object.keys(bad.errors)).toContain("company");
    });

    it("visits to the pricing page by a known visitor fire the automation once", async () => {
      await db.q(
        `insert into automations (organization_id, name, trigger_type, trigger_config, actions) values ($1, 'pricing x2', 'site.behavior', '{"path_contains":"pric","min_visits":"2"}', '[{"type":"add_tag","config":{"tag":"hot-intent"}}]')`,
        [org],
      );
      const visitor = "v1234567890abc";
      // the visitor leaves details on the site → linked to the new contact
      await db.as(null, (q) => q(`select public.submit_form($1, '{"email":"vis@x.co","kind":"home"}'::jsonb, $2::jsonb)`, [formSlug, JSON.stringify({ visitor })]), true);
      const vc = (await db.q<{ contact_id: string }>(`select contact_id from site_visitors where visitor_id = $1`, [visitor]))[0]!.contact_id;
      expect(vc).toBeTruthy();
      const track = (path: string) => db.as(null, (q) => q(`select public.track_site_event('wave-landing', $1, $2, 'view', 0, 'a')`, [visitor, path]), true);
      await track("/pricing");
      expect(await db.q(`select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 and t.name = 'hot-intent'`, [vc])).toHaveLength(0);
      await track("/pricing");
      expect(await db.q(`select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 and t.name = 'hot-intent'`, [vc])).toHaveLength(1);
      await track("/pricing");
      expect(await db.q(`select 1 from events where type = 'site.behavior' and entity_id = $1`, [vc])).toHaveLength(1);
      // anonymous callers cannot read the events
      await expect(db.as(null, (q) => q(`select * from site_events`))).rejects.toThrow();
      expect(await db.as(owner, (q) => q(`select * from site_events where organization_id = $1`, [org]))).toHaveLength(3);
      // a draft site / bad visitor id is ignored
      expect((await db.as(null, async (q) => (await q<{ r: { ok: boolean } }>(`select public.track_site_event('wave-landing', 'x', '/', 'view') as r`))[0]!.r)).ok).toBe(false);
    });

    it("A/B stats count distinct visitors per variant", async () => {
      await db.q(`update sites set ab = '{"active":true,"title":"B","started_at":"2000-01-01"}' where slug = 'wave-landing'`);
      await db.as(null, (q) => q(`select public.track_site_event('wave-landing', 'bbbbbbbbbb', '/', 'view', 0, 'b')`), true);
      await db.as(null, (q) => q(`select public.track_site_event('wave-landing', 'bbbbbbbbbb', '/', 'convert', 0, 'b')`), true);
      const site = (await db.q<{ id: string }>(`select id from sites where slug = 'wave-landing'`))[0]!.id;
      const s = (await db.as(owner, async (q) => (await q<{ s: Record<string, number> }>(`select public.site_ab_stats($1) as s`, [site]))[0]!.s));
      expect(s).toMatchObject({ a_views: 1, b_views: 1, b_conv: 1 });
      const pub = (await db.as(null, async (q) => (await q<{ ab: { title: string } }>(`select public.get_public_site_ab('wave-landing') as ab`))[0]!.ab));
      expect(pub.title).toBe("B");
    });
  });

  describe("smart campaign audience", () => {
    it("filters by score / activity and never includes opted-out customers", async () => {
      const mk = async (name: string, score: number, consent = true) => {
        const id = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email, marketing_consent) values ($1, $2, $3, $4) returning id`, [org, name, `${name}@aud.co`, consent]))[0]!.id;
        await db.q(`insert into contact_insights (contact_id, organization_id, lead_score, last_inbound_at) values ($1, $2, $3, now() - interval '40 days') on conflict (contact_id) do update set lead_score = excluded.lead_score, last_inbound_at = excluded.last_inbound_at`, [id, org, score]);
        return id;
      };
      const hot = await mk("hot", 85);
      await mk("cold", 10);
      const gone = await mk("gone", 90);
      await db.q(`update contacts set opted_out_at = now() where id = $1`, [gone]);
      const ids = (await db.q<{ contact_id: string }>(`select contact_id from public.campaign_audience($1, 'email', '{"min_score": 70, "inactive_days": 30}'::jsonb)`, [org])).map((r) => r.contact_id);
      expect(ids).toContain(hot);
      expect(ids).not.toContain(gone);
      expect(ids).toHaveLength(1);
    });
  });

  describe("appointment reminders", () => {
    it("claims each window exactly once", async () => {
      const c2 = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone) values ($1, 'Rem', '0549998877') returning id`, [org]))[0]!.id;
      await db.q(`insert into appointments (organization_id, host_id, contact_id, title, starts_at, ends_at, created_at) values ($1, $2, $3, 'ייעוץ', now() + interval '20 hours', now() + interval '21 hours', now() - interval '1 day')`, [org, owner, c2]);
      await db.q(`insert into appointments (organization_id, host_id, contact_id, title, starts_at, ends_at, created_at) values ($1, $2, $3, 'מחר בבוקר', now() + interval '50 minutes', now() + interval '80 minutes', now() - interval '1 day')`, [org, sales, c2]);
      const first = await db.q<{ window_kind: string; title: string }>(`select window_kind, title from public.claim_appointment_reminders(50) order by title`);
      expect(first.map((r) => [r.title, r.window_kind])).toEqual([
        ["ייעוץ", "24h"],
        ["מחר בבוקר", "1h"],
      ]);
      expect(await db.q(`select * from public.claim_appointment_reminders(50)`)).toHaveLength(0);
    });
  });

  describe("platform admin: quota and price overrides", () => {
    it("only the platform admin can change limits / prices", async () => {
      expect((await db.q<{ l: number }>(`select public.plan_limit($1, 'contacts') as l`, [org]))[0]!.l).toBe("250");
      await expect(db.as(owner, (q) => q(`update organizations set limit_overrides = '{"contacts": 99999}' where id = $1`, [org]))).rejects.toThrow(/protected organization column/);
      await expect(db.as(owner, (q) => q(`select public.platform_set_overrides($1, '{"contacts": 99999}', null)`, [org]))).rejects.toThrow(/forbidden/);
      await db.as(admin, (q) => q(`select public.platform_set_overrides($1, '{"contacts": 10, "ai_agents": -1}', '{"pro": {"month": 99}}')`, [org]), true);
      expect((await db.q<{ l: string }>(`select public.plan_limit($1, 'contacts') as l`, [org]))[0]!.l).toBe("10");
      expect((await db.q<{ l: string | null }>(`select public.plan_limit($1, 'ai_agents') as l`, [org]))[0]!.l).toBeNull();
      const eff = await db.as(owner, async (q) => (await q<{ e: Record<string, number | null> }>(`select public.effective_limits($1) as e`, [org]))[0]!.e);
      expect(eff.contacts).toBe(10);
      expect(eff.ai_agents).toBeNull();
      await expect(db.as(admin, (q) => q(`select public.platform_set_overrides($1, null, '{"nope": {"month": 1}}')`, [org]))).rejects.toThrow(/invalid_prices/);
      await db.as(admin, (q) => q(`select public.platform_set_overrides($1, '{}', '{}')`, [org]), true);
    });
  });

  describe("AI credit packs", () => {
    it("adds credits once, uses them after the monthly allowance, refunds failed calls", async () => {
      // use up the free plan's 50 monthly credits
      await db.q(`insert into ai_usage (organization_id, feature, credits, status) select $1, 'insights', 1, 'ok' from generate_series(1, 50)`, [org]);
      await expect(db.q(`select public.reserve_ai_credits_system($1, 'insights')`, [org])).rejects.toThrow(/plan_limit:ai_credits/);
      const p = (await db.q<{ id: string }>(`insert into credit_purchases (organization_id, pack, credits, amount, currency, provider) values ($1, 'ai_500', 500, 9, 'USD', 'paypal') returning id`, [org]))[0]!.id;
      expect((await db.q<{ r: { ok: boolean; error: string } }>(`select public.grant_credit_purchase($1, 1, 'USD') as r`, [p]))[0]!.r).toMatchObject({ ok: false, error: "amount_mismatch" });
      expect((await db.q<{ r: { ok: boolean } }>(`select public.grant_credit_purchase($1, 9, 'usd') as r`, [p]))[0]!.r.ok).toBe(true);
      expect((await db.q<{ r: { already: boolean } }>(`select public.grant_credit_purchase($1, 9, 'USD') as r`, [p]))[0]!.r.already).toBe(true);
      const bal = async () => Number((await db.q<{ b: string }>(`select public.ai_credit_balance($1) as b`, [org]))[0]!.b);
      expect(await bal()).toBe(500);
      const usage = (await db.q<{ id: string }>(`select public.reserve_ai_credits_system($1, 'insights') as id`, [org]))[0]!.id;
      expect(await bal()).toBe(499);
      await db.q(`update ai_usage set status = 'error' where id = $1`, [usage]);
      expect(await bal()).toBe(500);
      // members of the org see their balance; others do not
      expect(await db.as(owner, async (q) => Number((await q<{ b: string }>(`select public.org_credit_balance($1) as b`, [org]))[0]!.b))).toBe(500);
      await expect(db.as(null, (q) => q(`select public.ai_credit_balance($1)`, [org]))).rejects.toThrow();
      // the platform admin can grant credits
      await db.as(admin, (q) => q(`select public.platform_grant_credits($1, 100, 'bonus')`, [org]), true);
      expect(await bal()).toBe(600);
      await expect(db.as(owner, (q) => q(`select public.platform_grant_credits($1, 100, 'x')`, [org]))).rejects.toThrow(/forbidden/);
    });
  });

  describe("growth metrics", () => {
    it("ROAS / CAC per source and spend RLS", async () => {
      const inv = (await db.q<{ id: string }>(`insert into documents (organization_id, kind, status, contact_id) values ($1, 'invoice', 'sent', $2) returning id`, [org, contact]))[0]!.id;
      await db.q(`insert into payments (organization_id, document_id, amount, method) values ($1, $2, 1000, 'transfer')`, [org, inv]);
      await db.as(owner, (q) => q(`insert into marketing_spend (organization_id, month, source, amount) values ($1, date_trunc('month', now())::date, 'facebook', 250)`, [org]), true);
      await expect(db.as(sales, (q) => q(`insert into marketing_spend (organization_id, month, source, amount) values ($1, date_trunc('month', now())::date, 'google', 1)`, [org]))).rejects.toThrow();
      const g = await db.as(owner, async (q) => (await q<{ g: { by_source: { source: string; roas: number; cac: number; customers: number }[]; ltv: { ltv: number }; forecast: unknown[] } }>(`select public.growth_metrics($1, 90) as g`, [org]))[0]!.g);
      const fb = g.by_source.find((s) => s.source === "facebook")!;
      expect(Number(fb.roas)).toBe(4);
      expect(Number(fb.cac)).toBe(250);
      expect(Number(g.ltv.ltv)).toBe(1000);
      expect(g.forecast).toHaveLength(3);
      await expect(db.as(null, (q) => q(`select public.growth_metrics($1, 90)`, [org]))).rejects.toThrow();
    });
  });

  describe("web push + conversions", () => {
    it("a notification queues a push job only for members with devices; conversions only when connected", async () => {
      await db.q(`insert into push_subscriptions (organization_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://fcm.googleapis.com/fcm/send/abc', 'k', 'a')`, [org, owner]);
      await db.q(`insert into notifications (organization_id, user_id, kind, title_key) values ($1, $2, 'x', 'common.save'), ($1, $3, 'x', 'common.save')`, [org, owner, sales]);
      expect(await db.q(`select 1 from jobs where kind = 'push' and organization_id = $1`, [org])).toHaveLength(1);
      // another user cannot see my devices
      expect(await db.as(sales, (q) => q(`select * from push_subscriptions`))).toHaveLength(0);
      const before = (await db.q(`select 1 from jobs where kind = 'conversion'`)).length;
      await db.q(`insert into contacts (organization_id, first_name) values ($1, 'NoConv')`, [org]);
      expect((await db.q(`select 1 from jobs where kind = 'conversion'`)).length).toBe(before);
      await db.q(`update organizations set plan = 'pro' where id = $1`, [org]);
      await db.q(`insert into integrations (organization_id, provider, status) values ($1, 'meta_capi', 'active')`, [org]);
      await db.q(`insert into contacts (organization_id, first_name) values ($1, 'Conv')`, [org]);
      expect((await db.q(`select 1 from jobs where kind = 'conversion'`)).length).toBe(before + 1);
    });
  });
});
