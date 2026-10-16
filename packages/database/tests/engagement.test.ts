import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0018: public forms, booking pages + appointments, campaigns. */
d("engagement: forms, bookings, campaigns (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let marketing: string;
  let sales: string;
  let analyst: string;
  let org: string;

  const anon = <T>(sql: string, params: unknown[] = []) => db.as(null, (q) => q<T & Record<string, unknown>>(sql, params), true);

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@e.test", "Host Person");
    marketing = await db.createUser("marketing@e.test");
    sales = await db.createUser("sales@e.test");
    analyst = await db.createUser("analyst@e.test");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Engage Org', 'engage-org') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'business' where id = $1`, [org]);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'marketing'), ($1, $3, 'sales'), ($1, $4, 'analyst')`, [org, marketing, sales, analyst]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  describe("forms", () => {
    let slug: string;
    beforeAll(async () => {
      slug = await db.as(marketing, async (q) =>
        (await q<{ slug: string }>(
          `insert into forms (organization_id, name, slug, fields, settings) values ($1, 'Contact us', 'contact-us-e2e', $2::jsonb, $3::jsonb) returning slug`,
          [
            org,
            JSON.stringify([
              { key: "name", label: "Name", type: "text", required: true },
              { key: "email", label: "Email", type: "email", required: true },
              { key: "phone", label: "Phone", type: "phone" },
              { key: "budget", label: "Budget", type: "select", options: ["<5k", "5k+"] },
              { key: "marketing_consent", label: "Updates", type: "checkbox" },
            ]),
            JSON.stringify({ tag: "website-form", success_message: "Thanks!", notify: true }),
          ],
        ))[0]!.slug,
      true);
    });

    it("only forms.manage can create forms; sales cannot", async () => {
      await expect(db.as(sales, (q) => q(`insert into forms (organization_id, name, fields) values ($1, 'x', '[{"key":"a"}]')`, [org]))).rejects.toThrow();
    });

    it("anonymous visitors can read an active form (without internal settings)", async () => {
      const f = (await anon<{ f: { name: string; settings: Record<string, unknown> } }>(`select public.get_public_form($1) as f`, [slug]))[0]!.f;
      expect(f.name).toBe("Contact us");
      expect(f.settings.tag).toBeUndefined();
      expect(f.settings.success_message).toBe("Thanks!");
    });

    it("validates submissions server-side", async () => {
      const r = (await anon<{ r: { ok: boolean; errors: Record<string, string> } }>(`select public.submit_form($1, $2::jsonb, '{"ip_hash":"v1"}') as r`, [slug, JSON.stringify({ name: "", email: "bad", budget: "hack" })]))[0]!.r;
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual({ name: "validation.required", email: "validation.email", budget: "validation.invalidOption" });
    });

    it("a valid submission creates a tagged, consenting contact, a note, a notification and an event", async () => {
      const r = (await anon<{ r: { ok: boolean; message: string } }>(`select public.submit_form($1, $2::jsonb, '{"ip_hash":"v2","utm":{"utm_source":"google"}}') as r`, [slug, JSON.stringify({ name: "Lea Gold", email: "LEA@e.test", phone: "054-333-2211", budget: "5k+", marketing_consent: "on", extra: "ignored" })]))[0]!.r;
      expect(r).toMatchObject({ ok: true, message: "Thanks!" });
      const c = (await db.q<{ id: string; first_name: string; last_name: string; source: string; marketing_consent: boolean; utm: Record<string, string> }>(`select id, first_name, last_name, source, marketing_consent, utm from contacts where email = 'lea@e.test'`))[0]!;
      expect(c).toMatchObject({ first_name: "Lea", last_name: "Gold", source: "form", marketing_consent: true, utm: { utm_source: "google" } });
      expect(await db.q(`select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 and t.name = 'website-form'`, [c.id])).toHaveLength(1);
      const sub = (await db.q<{ data: Record<string, string> }>(`select data from form_submissions where contact_id = $1`, [c.id]))[0]!;
      expect(sub.data.extra).toBeUndefined();
      expect(sub.data.budget).toBe("5k+");
      expect(await db.q(`select 1 from notifications where organization_id = $1 and kind = 'form'`, [org])).not.toHaveLength(0);
      expect(await db.q(`select 1 from events where type = 'form.submitted' and entity_id = $1`, [c.id])).toHaveLength(1);
      // second submission with the same e-mail updates the same contact
      await anon(`select public.submit_form($1, $2::jsonb, '{"ip_hash":"v3"}')`, [slug, JSON.stringify({ name: "Lea", email: "lea@e.test" })]);
      expect(await db.q(`select 1 from contacts where email = 'lea@e.test'`)).toHaveLength(1);
      expect(await db.as(analyst, (q) => q(`select 1 from form_submissions where organization_id = $1`, [org]))).toHaveLength(0);
    });

    it("rate-limits a single visitor and rejects inactive/unknown forms", async () => {
      let limited = false;
      for (let i = 0; i < 12; i++) {
        try {
          await anon(`select public.submit_form($1, $2::jsonb, '{"ip_hash":"flood"}')`, [slug, JSON.stringify({ name: "x", email: `f${i}@e.test` })]);
        } catch (e) {
          if (/rate_limited/.test(String(e))) limited = true;
        }
      }
      expect(limited).toBe(true);
      await expect(anon(`select public.submit_form('nope-nope', '{}')`)).rejects.toThrow(/not_found/);
    });
  });

  describe("booking", () => {
    let slug: string;
    const nextWeekday = (dow: number, hourUtc: number) => {
      const dt = new Date();
      dt.setUTCDate(dt.getUTCDate() + 7 + ((dow - dt.getUTCDay() + 7) % 7));
      dt.setUTCHours(hourUtc, 0, 0, 0);
      return dt.toISOString();
    };

    beforeAll(async () => {
      slug = await db.as(owner, async (q) =>
        (await q<{ slug: string }>(
          `insert into appointment_types (organization_id, name, slug, duration_min, buffer_min, host_id, timezone, availability, min_notice_hours, max_days_ahead)
           values ($1, 'Intro call', 'intro-call-e2e', 30, 10, $2, 'UTC', '{"1":[["09:00","12:00"]]}', 1, 30) returning slug`,
          [org, owner],
        ))[0]!.slug,
      true);
    });

    it("public page exposes only availability and busy times", async () => {
      const b = (await anon<{ b: { name: string; busy: unknown[]; host: string } }>(`select public.get_public_booking($1) as b`, [slug]))[0]!.b;
      expect(b.name).toBe("Intro call");
      expect(b.host).toBe("Host Person");
      expect(b.busy).toEqual([]);
    });

    it("books a valid slot, blocks overlaps (incl. buffer) and out-of-hours times", async () => {
      const monday10 = nextWeekday(1, 10);
      const ok = (await anon<{ r: { ok: boolean; token: string } }>(`select public.book_appointment($1, $2, 'Ron Bar', 'ron@e.test', null, 'hi', '{"ip_hash":"b1"}') as r`, [slug, monday10]))[0]!.r;
      expect(ok.ok).toBe(true);
      const clash = (await anon<{ r: { ok: boolean; error: string } }>(`select public.book_appointment($1, $2, 'Other', 'o@e.test', null, null, '{"ip_hash":"b2"}') as r`, [slug, new Date(Date.parse(monday10) + 35 * 60_000).toISOString()]))[0]!.r;
      expect(clash).toEqual({ ok: false, error: "booking.taken" });
      const evening = (await anon<{ r: { ok: boolean; error: string } }>(`select public.book_appointment($1, $2, 'Late', 'l@e.test', null, null, '{"ip_hash":"b3"}') as r`, [slug, nextWeekday(1, 18)]))[0]!.r;
      expect(evening.error).toBe("booking.notAvailable");
      const tuesday = (await anon<{ r: { ok: boolean; error: string } }>(`select public.book_appointment($1, $2, 'Tue', 't@e.test', null, null, '{"ip_hash":"b4"}') as r`, [slug, nextWeekday(2, 10)]))[0]!.r;
      expect(tuesday.error).toBe("booking.notAvailable");
      const past = (await anon<{ r: { ok: boolean; error: string } }>(`select public.book_appointment($1, now() - interval '1 day', 'Past', 'p@e.test', null, null, '{"ip_hash":"b5"}') as r`, [slug]))[0]!.r;
      expect(past.error).toBe("booking.outOfRange");

      const appt = (await db.q<{ status: string; contact_id: string }>(`select status, contact_id from appointments where public_token = $1`, [ok.token]))[0]!;
      expect(appt.status).toBe("scheduled");
      expect(appt.contact_id).toBeTruthy();
      expect(await db.q(`select 1 from events where type = 'appointment.booked'`)).toHaveLength(1);
      const busy = (await anon<{ b: { busy: unknown[] } }>(`select public.get_public_booking($1) as b`, [slug]))[0]!.b.busy;
      expect(busy).toHaveLength(1);

      // the DB itself refuses overlapping appointments for a host
      await expect(db.q(`insert into appointments (organization_id, host_id, title, starts_at, ends_at) values ($1, $2, 'dup', $3, $3::timestamptz + interval '15 minutes')`, [org, owner, monday10])).rejects.toThrow(/appointments_no_overlap/);

      expect((await anon<{ r: { ok: boolean } }>(`select public.cancel_public_appointment($1) as r`, [ok.token]))[0]!.r.ok).toBe(true);
      expect((await anon<{ r: { ok: boolean } }>(`select public.cancel_public_appointment($1) as r`, [ok.token]))[0]!.r.ok).toBe(false);
    });

    it("appointments: read for everyone with appointments.read, write for managers/sales/support only", async () => {
      expect((await db.as(analyst, (q) => q(`select 1 from appointments where organization_id = $1`, [org]))).length).toBeGreaterThan(0);
      await expect(db.as(analyst, (q) => q(`insert into appointments (organization_id, title, starts_at, ends_at) values ($1, 'x', now(), now() + interval '1 hour')`, [org]))).rejects.toThrow();
      await db.as(sales, (q) => q(`insert into appointments (organization_id, host_id, title, starts_at, ends_at) values ($1, $2, 'demo', now() + interval '40 days', now() + interval '40 days 1 hour')`, [org, sales]), true);
    });
  });

  describe("campaigns", () => {
    it("audience = opted-in contacts with the channel address + filters; launch creates recipients and jobs", async () => {
      await db.q(
        `insert into contacts (organization_id, first_name, email, phone, marketing_consent, status) values
          ($1, 'Opt', 'opt@e.test', '0501111111', true, 'customer'),
          ($1, 'NoConsent', 'no@e.test', '0502222222', false, 'customer'),
          ($1, 'Lead', 'lead@e.test', null, true, 'lead')`,
        [org],
      );
      const count = await db.as(marketing, async (q) => (await q<{ n: number }>(`select public.preview_campaign_audience($1, 'email', '{"status":"customer"}') as n`, [org]))[0]!.n);
      expect(count).toBe(1);
      const sms = await db.as(marketing, async (q) => (await q<{ n: number }>(`select public.preview_campaign_audience($1, 'sms', '{}') as n`, [org]))[0]!.n);
      expect(sms).toBeGreaterThanOrEqual(1);
      await expect(db.as(sales, (q) => q(`select public.preview_campaign_audience($1, 'email', '{}')`, [org]))).rejects.toThrow(/forbidden/);

      const cid = await db.as(marketing, async (q) =>
        (await q<{ id: string }>(`insert into campaigns (organization_id, name, channel, subject, body, audience) values ($1, 'Promo', 'email', 'Hi {{contact.first_name}}', 'Sale at {{org.name}}', '{"status":"customer"}') returning id`, [org]))[0]!.id,
      true);
      const res = await db.as(marketing, async (q) => (await q<{ r: { recipients: number } }>(`select public.launch_campaign($1, $2) as r`, [org, cid]))[0]!.r, true);
      expect(res.recipients).toBe(1);
      const job = (await db.q<{ kind: string; campaign_recipient_id: string }>(`select kind, campaign_recipient_id from jobs where payload ->> 'campaign_id' = $1`, [cid]))[0]!;
      expect(job.kind).toBe("email");
      await expect(db.as(marketing, (q) => q(`select public.launch_campaign($1, $2)`, [org, cid]))).rejects.toThrow(/campaign_already_launched/);

      await db.q(`set role service_role`);
      try {
        const msg = (await db.q<{ m: { to: string; subject: string; body: string; unsub_token: string } }>(`select public.campaign_message($1) as m`, [job.campaign_recipient_id]))[0]!.m;
        expect(msg).toMatchObject({ to: "opt@e.test", subject: "Hi Opt", body: "Sale at Engage Org" });
        await db.q(`select public.campaign_recipient_result($1, true, null, true)`, [job.campaign_recipient_id]);
        const camp = (await db.q<{ status: string; stats: { sent: number } }>(`select status, stats from campaigns where id = $1`, [cid]))[0]!;
        expect(camp.status).toBe("sent");
        expect(camp.stats.sent).toBe(1);
        // unsubscribe link works anonymously and removes consent
        await db.q(`reset role`);
        const un = (await anon<{ r: { ok: boolean } }>(`select public.unsubscribe($1) as r`, [msg.unsub_token]))[0]!.r;
        expect(un.ok).toBe(true);
        expect((await db.q<{ marketing_consent: boolean }>(`select marketing_consent from contacts where email = 'opt@e.test'`))[0]!.marketing_consent).toBe(false);
      } finally {
        await db.q(`reset role`);
      }
    });

    it("campaigns cannot be launched from demo workspaces", async () => {
      const cid = (await db.q<{ id: string }>(`insert into campaigns (organization_id, name, channel, body) values ($1, 'Demo', 'sms', 'x') returning id`, [org]))[0]!.id;
      await db.q(`update organizations set is_demo = true where id = $1`, [org]);
      await expect(db.as(marketing, (q) => q(`select public.launch_campaign($1, $2)`, [org, cid]))).rejects.toThrow(/demo_mode/);
      await db.q(`update organizations set is_demo = false where id = $1`, [org]);
    });
  });
});
