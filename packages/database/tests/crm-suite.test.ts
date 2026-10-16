import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0014: deals integrity, analytics, CSV import, duplicate merge, tags — all tenant-isolated. */
d("CRM suite: deals, analytics, import, merge, tags (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let sales: string;
  let viewer: string;
  let stranger: string;
  let org: string;
  let otherOrg: string;
  let pipeline: string;
  let stages: string[];
  let otherStage: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@s.test", "Owner Person");
    sales = await db.createUser("sales@s.test");
    viewer = await db.createUser("viewer@s.test");
    stranger = await db.createUser("stranger@s.test");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Suite Org', 'suite-org') as id`))[0]!.id, true);
    otherOrg = await db.as(stranger, async (q) => (await q<{ id: string }>(`select public.create_organization('Other Org', 'other-org') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'business' where id = any($1)`, [[org, otherOrg]]);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'sales'), ($1, $3, 'read_only')`, [org, sales, viewer]);
    pipeline = (await db.q<{ id: string }>(`select id from pipelines where organization_id = $1`, [org]))[0]!.id;
    stages = (await db.q<{ id: string }>(`select id from pipeline_stages where pipeline_id = $1 order by position`, [pipeline])).map((r) => r.id);
    otherStage = (await db.q<{ id: string }>(`select s.id from pipeline_stages s where s.organization_id = $1 limit 1`, [otherOrg]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("sales can create a deal and move it between stages; won stamps closed_at, reopen clears it", async () => {
    const id = await db.as(sales, async (q) => {
      const r = await q<{ id: string }>(
        `insert into deals (organization_id, pipeline_id, stage_id, title, value, owner_id, created_by) values ($1, $2, $3, 'Big deal', 1000, $4, $4) returning id`,
        [org, pipeline, stages[0], sales],
      );
      return r[0]!.id;
    }, true);
    await db.as(sales, (q) => q(`update deals set stage_id = $1 where id = $2`, [stages[2], id]), true);
    await db.as(sales, (q) => q(`update deals set status = 'won' where id = $1`, [id]), true);
    let row = (await db.q<{ status: string; closed_at: string | null; stage_id: string }>(`select status, closed_at, stage_id from deals where id = $1`, [id]))[0]!;
    expect(row.status).toBe("won");
    expect(row.closed_at).not.toBeNull();
    expect(row.stage_id).toBe(stages[2]);
    await db.as(sales, (q) => q(`update deals set status = 'open' where id = $1`, [id]), true);
    row = (await db.q<{ status: string; closed_at: string | null; stage_id: string }>(`select status, closed_at, stage_id from deals where id = $1`, [id]))[0]!;
    expect(row.closed_at).toBeNull();
    await db.as(sales, (q) => q(`update deals set status = 'won' where id = $1`, [id]), true);
  });

  it("a deal cannot point at another pipeline's / tenant's stage", async () => {
    await expect(
      db.as(owner, (q) =>
        q(`insert into deals (organization_id, pipeline_id, stage_id, title) values ($1, $2, $3, 'x')`, [org, pipeline, otherStage]),
      ),
    ).rejects.toThrow();
  });

  it("read-only members cannot create deals", async () => {
    await expect(
      db.as(viewer, (q) => q(`insert into deals (organization_id, pipeline_id, stage_id, title) values ($1, $2, $3, 'x')`, [org, pipeline, stages[0]])),
    ).rejects.toThrow();
  });

  it("CSV import: inserts valid rows, skips duplicates and invalid rows, normalises phones", async () => {
    await db.as(owner, (q) => q(`insert into contacts (organization_id, first_name, email) values ($1, 'Existing', 'dup@s.test')`, [org]), true);
    const rows = [
      { first_name: "Ana", last_name: "Levi", email: "ana@s.test", phone: "050-123-4567", status: "customer" },
      { first_name: "", email: "noname@s.test" },
      { first_name: "Dup", email: "DUP@s.test" },
      { first_name: "NoContact" },
      { first_name: "BadMail", email: "not-an-email" },
      { first_name: "Phone", phone: "+972 52 765 4321" },
    ];
    const res = await db.as(sales, async (q) => (await q<{ r: Record<string, number> }>(`select public.import_contacts($1, $2::jsonb) as r`, [org, JSON.stringify(rows)]))[0]!.r, true);
    expect(res).toMatchObject({ inserted: 3, skipped: 1, invalid: 2 });
    const ana = (await db.q<{ phone: string; status: string; source: string }>(`select phone, status, source from contacts where email = 'ana@s.test'`))[0]!;
    expect(ana).toEqual({ phone: "0501234567", status: "customer", source: "import" });
    const named = await db.q(`select 1 from contacts where email = 'noname@s.test' and first_name = 'noname'`);
    expect(named).toHaveLength(1);
  });

  it("CSV import requires contacts.write and cannot target another tenant", async () => {
    await expect(db.as(viewer, (q) => q(`select public.import_contacts($1, '[{"first_name":"x","email":"x@x.io"}]')`, [org]))).rejects.toThrow(/forbidden/);
    await expect(db.as(sales, (q) => q(`select public.import_contacts($1, '[{"first_name":"x","email":"x@x.io"}]')`, [otherOrg]))).rejects.toThrow(/forbidden/);
  });

  it("tags: set by name, replace, and isolate per tenant", async () => {
    const cid = (await db.q<{ id: string }>(`select id from contacts where email = 'ana@s.test'`))[0]!.id;
    await db.as(sales, (q) => q(`select public.set_contact_tags($1, $2, array['VIP','  vip-2 ','VIP'])`, [org, cid]), true);
    let tags = await db.q<{ name: string }>(`select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 order by 1`, [cid]);
    expect(tags.map((x) => x.name)).toEqual(["VIP", "vip-2"]);
    await db.as(sales, (q) => q(`select public.set_contact_tags($1, $2, array['VIP'])`, [org, cid]), true);
    tags = await db.q<{ name: string }>(`select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1`, [cid]);
    expect(tags.map((x) => x.name)).toEqual(["VIP"]);
    await expect(db.as(stranger, (q) => q(`select public.set_contact_tags($1, $2, array['hack'])`, [org, cid]))).rejects.toThrow(/forbidden/);
    await expect(db.as(viewer, (q) => q(`select public.set_contact_tags($1, $2, array['x'])`, [org, cid]))).rejects.toThrow(/forbidden/);
  });

  it("duplicates are found and merged: notes/deals/tags move, gaps are filled, the duplicate is gone", async () => {
    const keep = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, last_name, phone) values ($1, 'Dana', 'Cohen', '0541112222') returning id`, [org]))[0]!.id;
    const dupe = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, last_name, phone, email, job_title) values ($1, 'dana', 'cohen', '0541112222', 'dana@s.test', 'CEO') returning id`, [org]))[0]!.id;
    await db.q(`insert into notes (organization_id, contact_id, body, created_by) values ($1, $2, 'from dupe', $3)`, [org, dupe, owner]);
    await db.q(`insert into deals (organization_id, pipeline_id, stage_id, contact_id, title) values ($1, $2, $3, $4, 'dupe deal')`, [org, pipeline, stages[0], dupe]);
    await db.as(owner, (q) => q(`select public.set_contact_tags($1, $2, array['lead-magnet'])`, [org, dupe]), true);

    const found = await db.as(owner, (q) => q<{ id: string }>(`select id from public.find_duplicate_contacts($1, $2)`, [org, keep]));
    expect(found.map((x) => x.id)).toContain(dupe);

    // sales has contacts.write but not contacts.delete → cannot merge
    await expect(db.as(sales, (q) => q(`select public.merge_contacts($1, $2, $3)`, [org, keep, dupe]))).rejects.toThrow(/forbidden/);

    await db.as(owner, (q) => q(`select public.merge_contacts($1, $2, $3)`, [org, keep, dupe]), true);
    const k = (await db.q<{ email: string; job_title: string }>(`select email::text, job_title from contacts where id = $1`, [keep]))[0]!;
    expect(k).toEqual({ email: "dana@s.test", job_title: "CEO" });
    expect(await db.q(`select 1 from contacts where id = $1`, [dupe])).toHaveLength(0);
    expect(await db.q(`select 1 from notes where contact_id = $1 and body = 'from dupe'`, [keep])).toHaveLength(1);
    expect(await db.q(`select 1 from deals where contact_id = $1 and title = 'dupe deal'`, [keep])).toHaveLength(1);
    expect(await db.q(`select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 and t.name = 'lead-magnet'`, [keep])).toHaveLength(1);
    expect(await db.q(`select 1 from activities where contact_id = $1 and type = 'contact.merged'`, [keep])).toHaveLength(1);
  });

  it("analytics: real numbers from the org only, permission-checked", async () => {
    await db.q(`insert into tasks (organization_id, title, status, due_at) values ($1, 'late', 'open', now() - interval '1 day'), ($1, 'done', 'done', null)`, [org]);
    const a = await db.as(viewer, async (q) => (await q<{ r: Record<string, unknown> }>(`select public.crm_analytics($1, 30) as r`, [org]))[0]!.r);
    expect(a.won).toBe(1);
    expect(Number(a.won_value)).toBe(1000);
    expect(a.tasks_overdue).toBe(1);
    expect(a.tasks_done).toBe(1);
    expect(a.open_deals).toBe(1);
    expect((a.stages as unknown[]).length).toBe(4);
    expect((a.monthly as { value: number }[])[0]!.value).toBe(1000);
    await expect(db.as(stranger, (q) => q(`select public.crm_analytics($1, 30)`, [org]))).rejects.toThrow(/forbidden/);
  });
});
