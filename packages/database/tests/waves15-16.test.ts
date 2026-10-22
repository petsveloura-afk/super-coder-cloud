import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;
const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(30)}`;

/** Waves 15-16 (real Postgres): e-signature, lead routing, task reminders, lead score, duplicates, KB, calendar busy times. */
d("waves 15-16 (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let s1: string;
  let s2: string;
  let org: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@w16.test", "Owner Person");
    s1 = await db.createUser("s1@w16.test", "Seller One");
    s2 = await db.createUser("s2@w16.test", "Seller Two");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Sixteen', 'sixteen-biz') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'pro' where id = $1`, [org]);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'sales'), ($1, $3, 'sales')`, [org, s1, s2]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("contracts: signature required, then locked with a content hash", async () => {
    const c = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Sig', 'sig@x.co') returning id`, [org]))[0]!.id;
    const doc = (await db.q<{ id: string; public_token: string }>(`insert into documents (organization_id, kind, status, contact_id, require_signature, contract_terms, due_date) values ($1, 'quote', 'sent', $2, true, '1. Terms', current_date + 7) returning id, public_token`, [org, c]))[0]!;
    await db.q(`insert into document_lines (organization_id, document_id, description, quantity, unit_price, tax_rate) values ($1, $2, 'Work', 1, 1000, 18)`, [org, doc.id]);
    // accepting with a typed name only is refused
    await expect(db.as(owner, (q) => q(`update documents set status = 'accepted' where id = $1`, [doc.id]))).rejects.toThrow(/signature_required/);
    const bad = await db.as(null, async (q) => (await q<{ r: { ok: boolean; error: string } }>(`select public.sign_public_quote($1, 'Dana', 'data:image/png;base64,x') as r`, [doc.public_token]))[0]!.r);
    expect(bad.error).toBe("finance.sign.required");
    const ok = await db.as(null, async (q) => (await q<{ r: { ok: boolean; hash: string } }>(`select public.sign_public_quote($1, 'Dana Levi', $2, '{"ip_hash":"h1"}') as r`, [doc.public_token, PNG]))[0]!.r, true);
    expect(ok.ok).toBe(true);
    expect(ok.hash).toMatch(/^[0-9a-f]{64}$/);
    const row = (await db.q<{ status: string; content_hash: string; accepted_by_name: string }>(`select status, content_hash, accepted_by_name from documents where id = $1`, [doc.id]))[0]!;
    expect(row).toMatchObject({ status: "accepted", content_hash: ok.hash, accepted_by_name: "Dana Levi" });
    await expect(db.as(owner, (q) => q(`update documents set contract_terms = 'changed' where id = $1`, [doc.id]))).rejects.toThrow(/document_signed/);
    await expect(db.as(owner, (q) => q(`update document_lines set unit_price = 1 where document_id = $1`, [doc.id]))).rejects.toThrow();
    // signing twice is impossible
    const again = await db.as(null, async (q) => (await q<{ r: { ok: boolean } }>(`select public.sign_public_quote($1, 'X', $2) as r`, [doc.public_token, PNG]))[0]!.r);
    expect(again.ok).toBe(false);
    expect(await db.q(`select 1 from activities where type = 'quote.signed' and contact_id = $1`, [c])).toHaveLength(1);
    expect(await db.q(`select 1 from events where type = 'contract.signed' and entity_id = $1`, [c])).toHaveLength(1);
  });

  it("lead routing: round robin over available members, skips people who are away", async () => {
    await db.q(`update organizations set lead_routing = $2 where id = $1`, [org, JSON.stringify({ mode: "round_robin", members: [s1, s2], contacts: true })]);
    const owners: string[] = [];
    for (let i = 0; i < 4; i++) owners.push((await db.q<{ owner_id: string }>(`insert into contacts (organization_id, first_name) values ($1, $2) returning owner_id`, [org, `rr${i}`]))[0]!.owner_id);
    expect(new Set(owners)).toEqual(new Set([s1, s2]));
    expect(owners[0]).not.toBe(owners[1]);
    await db.q(`update organization_members set available = false where organization_id = $1 and user_id = $2`, [org, s2]);
    const next = (await db.q<{ owner_id: string }>(`insert into contacts (organization_id, first_name) values ($1, 'away') returning owner_id`, [org]))[0]!.owner_id;
    expect(next).toBe(s1);
    // a contact created by a person keeps its creator's choice
    const manual = await db.as(owner, async (q) => (await q<{ owner_id: string | null }>(`insert into contacts (organization_id, first_name, created_by) values ($1, 'manual', $2) returning owner_id`, [org, owner]))[0]!.owner_id, true);
    expect(manual).toBeNull();
    await db.q(`update organizations set lead_routing = '{}' where id = $1`, [org]);
  });

  it("task reminders are claimed once; done / snooze from the reminder", async () => {
    const task = (await db.q<{ id: string }>(`insert into tasks (organization_id, title, assignee_id, remind_at) values ($1, 'Call Dana', $2, now() - interval '1 minute') returning id`, [org, s1]))[0]!.id;
    const claimed = await db.q<{ task_id: string; title: string }>(`select * from public.claim_task_reminders(10)`);
    expect(claimed.map((r) => r.task_id)).toContain(task);
    expect(await db.q(`select * from public.claim_task_reminders(10) where task_id = $1`, [task])).toHaveLength(0);
    expect((await db.q<{ r: { ok: boolean; error: string } }>(`select public.task_reminder_action($1, $2, 'done') as r`, [task, s2]))[0]!.r.error).toBe("not_found");
    expect((await db.q<{ r: { ok: boolean } }>(`select public.task_reminder_action($1, $2, 'snooze', 15) as r`, [task, s1]))[0]!.r.ok).toBe(true);
    const t = (await db.q<{ snooze_count: number; reminded_at: string | null }>(`select snooze_count, reminded_at from tasks where id = $1`, [task]))[0]!;
    expect(t).toMatchObject({ snooze_count: 1, reminded_at: null });
    expect((await db.q<{ r: { ok: boolean } }>(`select public.task_reminder_action($1, $2, 'done') as r`, [task, s1]))[0]!.r.ok).toBe(true);
    expect((await db.q<{ status: string }>(`select status from tasks where id = $1`, [task]))[0]!.status).toBe("done");
  });

  it("lead score is explainable and stored for members only", async () => {
    const c = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone, email, marketing_consent, status, owner_id) values ($1, 'Score', '0541234567', 's@x.co', true, 'qualified', $2) returning id`, [org, s1]))[0]!.id;
    const r = await db.as(s1, async (q) => (await q<{ r: { lead_score: number; breakdown: Record<string, number> } }>(`select public.refresh_contact_score($1, $2) as r`, [org, c]))[0]!.r, true);
    expect(r.lead_score).toBeGreaterThan(0);
    expect(r.breakdown.details).toBe(7);
    await expect(db.as(null, (q) => q(`select public.refresh_contact_score($1, $2)`, [org, c]))).rejects.toThrow();
  });

  it("channel duplicates merge automatically into the older contact", async () => {
    const keep = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone, created_at) values ($1, 'Old', '0547778899', now() - interval '1 day') returning id`, [org]))[0]!.id;
    const dup = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone, source) values ($1, 'Dup', '+972547778899', 'whatsapp') returning id`, [org]))[0]!.id;
    const conv = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, contact_id) values ($1, 'whatsapp', '972547778899', $2) returning id`, [org, dup]))[0]!.id;
    const n = Number((await db.q<{ n: number }>(`select public.auto_merge_channel_duplicates(50, $1) as n`, [org]))[0]!.n);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await db.q(`select 1 from contacts where id = $1`, [dup])).toHaveLength(0);
    expect((await db.q<{ contact_id: string }>(`select contact_id from conversations where id = $1`, [conv]))[0]!.contact_id).toBe(keep);
  });

  it("knowledge base: search for the agent, public help center for published articles only", async () => {
    await db.q(`insert into kb_articles (organization_id, title, body, category, published) values ($1, 'איך מבטלים תור', 'אפשר לבטל עד 24 שעות לפני', 'תורים', true), ($1, 'Secret draft', 'internal', null, false)`, [org]);
    const hits = await db.as(s1, (q) => q<{ title: string }>(`select title from public.kb_search($1, 'לבטל תור')`, [org]));
    expect(hits.map((h) => h.title)).toEqual(["איך מבטלים תור"]);
    const pub = await db.as(null, async (q) => (await q<{ k: { articles: { title: string }[] } }>(`select public.get_public_kb('sixteen-biz') as k`))[0]!.k);
    expect(JSON.stringify(pub)).not.toContain("Secret draft");
    await expect(db.as(null, (q) => q(`select * from public.kb_search($1, 'x')`, [org]))).rejects.toThrow();
  });

  it("booking respects busy times from the host's connected calendar", async () => {
    const slug = await db.as(owner, async (q) =>
      (await q<{ slug: string }>(
        `insert into appointment_types (organization_id, name, slug, duration_min, buffer_min, host_id, timezone, availability, min_notice_hours, max_days_ahead)
         values ($1, 'Consult', 'consult-w16', 30, 0, $2, 'UTC', '{"0":[["00:00","23:59"]],"1":[["00:00","23:59"]],"2":[["00:00","23:59"]],"3":[["00:00","23:59"]],"4":[["00:00","23:59"]],"5":[["00:00","23:59"]],"6":[["00:00","23:59"]]}', 1, 30) returning slug`,
        [org, owner],
      ))[0]!.slug,
    true);
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCHours(10, 0, 0, 0);
    const cc = (await db.q<{ id: string }>(`insert into calendar_connections (organization_id, user_id, provider) values ($1, $2, 'google') returning id`, [org, owner]))[0]!.id;
    await db.q(`insert into calendar_busy (connection_id, organization_id, user_id, starts_at, ends_at) values ($1, $2, $3, $4, $4::timestamptz + interval '1 hour')`, [cc, org, owner, start.toISOString()]);
    const taken = await db.as(null, async (q) => (await q<{ r: { ok: boolean; error: string } }>(`select public.book_appointment_v2($1, $2, 'A', 'a@x.co', null, null, '{"ip_hash":"z1"}') as r`, [slug, start.toISOString()]))[0]!.r);
    expect(taken).toEqual({ ok: false, error: "booking.taken" });
    const later = new Date(start.getTime() + 2 * 3_600_000).toISOString();
    const ok = await db.as(null, async (q) => (await q<{ r: { ok: boolean } }>(`select public.book_appointment_v2($1, $2, 'B', 'b@x.co', null, null, '{"ip_hash":"z2"}') as r`, [slug, later]))[0]!.r, true);
    expect(ok.ok).toBe(true);
    // the meeting is queued for the host's calendar
    expect(await db.q(`select 1 from jobs where kind = 'calendar' and organization_id = $1`, [org])).toHaveLength(1);
  });
});
