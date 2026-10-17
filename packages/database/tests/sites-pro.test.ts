import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0030: professional websites — plan features, published-site limit, protected domains, public reads, domain orders. */
d("websites pro + domains + plan features (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let stranger: string;
  let org: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@sites.test", "Sites Owner");
    stranger = await db.createUser("stranger@sites.test", "Stranger");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Sites Org', 'sites-org') as id`))[0]!.id, true);
    await db.as(stranger, async (q) => q(`select public.create_organization('Other', 'other-sites')`), true);
  });
  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  const feature = async (f: string) => (await db.as(owner, (q) => q<{ v: boolean }>(`select public.has_feature($1, $2) as v`, [org, f])))[0]!.v;
  const site = (slug: string, status = "draft") =>
    db.as(owner, (q) => q<{ id: string }>(`insert into sites (organization_id, name, slug, status, blocks) values ($1, 'Site', $2, $3, '[{"type":"hero","data":{"title":"Hi"}}]') returning id`, [org, slug, status]), true);

  it("plans: free has csv export, not the API / audit log / pro sites; Business has them all", async () => {
    expect(await feature("csv_export")).toBe(true);
    for (const f of ["api_access", "audit_log", "site_pro_templates", "site_ai_editor", "site_custom_domain"]) expect(await feature(f)).toBe(false);
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'paypal', null, 'order:X', 'month', now() + interval '30 days', false)`, [org]);
    expect(await feature("audit_log")).toBe(true);
    expect(await feature("site_custom_domain")).toBe(true);
    expect(await feature("api_access")).toBe(false); // API is Business+
    await db.q(`select public.apply_subscription($1, 'business', 'active', 'paypal', null, 'order:Y', 'month', now() + interval '30 days', false)`, [org]);
    expect(await feature("api_access")).toBe(true);
    await db.q(`select public.apply_subscription($1, 'business', 'canceled', 'paypal')`, [org]);
    expect(await feature("api_access")).toBe(false);
  });

  it("free plan publishes 1 site; drafts are unlimited; existing published sites stay", async () => {
    await site("first-site", "published");
    await site("draft-two");
    await expect(site("second-pub", "published")).rejects.toThrow(/plan_limit:sites_published/);
    const draft = (await db.q<{ id: string }>(`select id from sites where slug = 'draft-two'`))[0]!.id;
    await expect(db.as(owner, (q) => q(`update sites set status = 'published' where id = $1`, [draft]), true)).rejects.toThrow(/plan_limit:sites_published/);
    // a paid plan lifts it
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'nowpayments', null, null, 'month', now() + interval '30 days', false)`, [org]);
    await db.as(owner, (q) => q(`update sites set status = 'published' where id = $1`, [draft]), true);
    // the first site edits normally even when the plan goes back to free
    await db.q(`select public.apply_subscription($1, 'pro', 'canceled', 'nowpayments')`, [org]);
    await db.as(owner, (q) => q(`update sites set name = 'Renamed', settings = '{"legal_name":"X Ltd","lang":"en"}', pages = '{"privacy":"## Hi"}' where slug = 'first-site'`), true);
  });

  it("members cannot set a custom domain themselves; the server can", async () => {
    await expect(db.as(owner, (q) => q(`update sites set custom_domain = 'evil.com' where slug = 'first-site'`), true)).rejects.toThrow(/protected site column/);
    await db.q(`update sites set custom_domain = 'pet-line.co.il', domain_status = 'active' where slug = 'first-site'`);
    await expect(db.q(`update sites set custom_domain = 'pet-line.co.il', domain_status = 'pending' where slug = 'draft-two'`)).rejects.toThrow(/sites_custom_domain_once|duplicate/);
    await expect(db.q(`update sites set custom_domain = 'Not A Domain' where slug = 'draft-two'`)).rejects.toThrow();
  });

  it("public reads: v2 with settings, legal pages, active domain and branding; host → slug + language", async () => {
    const v2 = (await db.as(null, (q) => q<{ r: Record<string, unknown> }>(`select public.get_public_site_v2('first-site') as r`)))[0]!.r;
    expect(v2).toMatchObject({ name: "Renamed", custom_domain: "pet-line.co.il", branding: true, settings: { legal_name: "X Ltd" }, pages: { privacy: "## Hi" } });
    expect((await db.as(null, (q) => q<{ r: unknown }>(`select public.get_public_site_v2('draft-x') as r`)))[0]!.r).toBeNull();
    const host = await db.as(null, (q) => q<{ slug: string; lang: string }>(`select * from public.site_slug_for_host('www.Pet-Line.co.il')`));
    expect(host).toEqual([{ slug: "first-site", lang: "en" }]);
    expect(await db.as(null, (q) => q(`select * from public.site_slug_for_host('unknown.com')`))).toHaveLength(0);
    // white label (Business) removes the badge
    await db.q(`select public.apply_subscription($1, 'business', 'active', 'paypal', null, 'order:Z', 'month', now() + interval '30 days', false)`, [org]);
    expect(((await db.as(null, (q) => q<{ r: { branding: boolean } }>(`select public.get_public_site_v2('first-site') as r`)))[0]!.r).branding).toBe(false);
  });

  it("domain orders: written by the server only, readable by members, price never below cost", async () => {
    const siteId = (await db.q<{ id: string }>(`select id from sites where slug = 'first-site'`))[0]!.id;
    await db.q(`insert into domain_orders (organization_id, site_id, domain, cost, price, provider_order_id) values ($1, $2, 'pet-line.com', 11.25, 16.25, 'PAYPAL1')`, [org, siteId]);
    await expect(db.q(`insert into domain_orders (organization_id, domain, cost, price) values ($1, 'cheap.com', 10, 9)`, [org])).rejects.toThrow();
    await expect(db.q(`insert into domain_orders (organization_id, domain, cost, price, provider_order_id) values ($1, 'dup.com', 10, 12, 'PAYPAL1')`, [org])).rejects.toThrow();
    expect(await db.as(owner, (q) => q(`select domain from domain_orders`))).toHaveLength(1);
    expect(await db.as(stranger, (q) => q(`select domain from domain_orders`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`insert into domain_orders (organization_id, domain, cost, price) values ($1, 'mine.com', 1, 1)`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`update domain_orders set status = 'active'`))).rejects.toThrow();
  });
});
