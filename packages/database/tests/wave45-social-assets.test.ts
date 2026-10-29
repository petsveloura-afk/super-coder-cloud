import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 45 / stage A (real Postgres): social_assets — tenant isolation, https-only, one row per url, audit trigger. */
d("wave 45 social_assets (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let outsider: string;
  let org: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@w45.test", "Owner FortyFive");
    outsider = await db.createUser("x@w45.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('FortyFive', 'fortyfive-biz') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("the owner can save and read an asset; an outsider sees nothing and cannot write", async () => {
    await db.as(owner, (q) => q(`insert into social_assets (organization_id, url, title) values ($1, 'https://cdn.test/a.png', 'לחם')`, [org]), true);
    const mine = await db.as(owner, (q) => q<{ url: string }>(`select url from social_assets where organization_id = $1`, [org]));
    expect(mine).toHaveLength(1);
    const theirs = await db.as(outsider, (q) => q<{ url: string }>(`select url from social_assets`));
    expect(theirs).toHaveLength(0);
    await expect(db.as(outsider, (q) => q(`insert into social_assets (organization_id, url) values ($1, 'https://cdn.test/b.png')`, [org]))).rejects.toThrow();
  });

  it("rejects non-https urls and duplicate urls per business", async () => {
    await expect(db.as(owner, (q) => q(`insert into social_assets (organization_id, url) values ($1, 'http://cdn.test/c.png')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`insert into social_assets (organization_id, url) values ($1, 'https://cdn.test/a.png')`, [org]))).rejects.toThrow();
  });

  it("writes to the audit log", async () => {
    const rows = await db.q<{ n: number }>(`select count(*)::int as n from audit_logs where organization_id = $1 and entity_type = 'social_assets'`, [org]);
    expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it("social_posts still only allows facebook / instagram (the platforms constraint is untouched)", async () => {
    await expect(db.as(owner, (q) => q(`insert into social_posts (organization_id, platforms, body) values ($1, array['tiktok'], 'x')`, [org]))).rejects.toThrow();
  });
});
