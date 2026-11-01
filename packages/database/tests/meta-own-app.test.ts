import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** The business's own Meta app + tester requests: readable by integration managers only, written by the server only. */
d("meta own app + tester requests (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let owner: string;
  let outsider: string;
  let admin: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@meta-own.test", "Owner");
    outsider = await db.createUser("out@meta-own.test", "Out");
    admin = await db.createUser("admin@meta-own.test", "Admin");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('MO', 'mo-biz') as id`))[0]!.id, true);
    await db.as(outsider, async (q) => q(`select public.create_organization('Other', 'mo-other')`), true);
    await db.q(`insert into platform_admins (user_id) values ($1) on conflict do nothing`, [admin]).catch(() => undefined);
    await db.q(`insert into meta_own_apps (organization_id, app_id, secret_enc, verify_token_hash) values ($1, '1234567', 'sealed-secret-value', repeat('a', 64))`, [org]);
    await db.q(`insert into meta_tester_requests (organization_id, user_id, profile_ref) values ($1, $2, 'facebook.com/dana')`, [org, owner]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("the business's managers read their own app; other businesses see nothing", async () => {
    expect(await db.as(owner, (q) => q(`select app_id from meta_own_apps`))).toEqual([{ app_id: "1234567" }]);
    expect(await db.as(outsider, (q) => q(`select app_id from meta_own_apps`))).toHaveLength(0);
    expect(await db.as(outsider, (q) => q(`select id from meta_tester_requests`))).toHaveLength(0);
    expect(await db.as(owner, (q) => q(`select profile_ref from meta_tester_requests`))).toEqual([{ profile_ref: "facebook.com/dana" }]);
    // the platform admin sees every waiting request (to add the person by hand), but never the apps' sealed secrets
    expect(await db.as(admin, (q) => q(`select profile_ref from meta_tester_requests`))).toEqual([{ profile_ref: "facebook.com/dana" }]);
    expect(await db.as(admin, (q) => q(`select app_id from meta_own_apps`))).toHaveLength(0);
  });

  it("nobody writes from the browser", async () => {
    await expect(db.as(owner, (q) => q(`update meta_own_apps set app_id = '7654321'`))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`insert into meta_tester_requests (organization_id, profile_ref) values ($1, 'x.y')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`delete from meta_own_apps`))).rejects.toThrow();
  });

  it("bad values are refused", async () => {
    await expect(db.q(`insert into meta_own_apps (organization_id, app_id, secret_enc, verify_token_hash) values ($1, 'abc', 'sealed-secret-value', repeat('b', 64))`, [org])).rejects.toThrow();
    await expect(db.q(`update meta_own_apps set verify_token_hash = 'short' where organization_id = $1`, [org])).rejects.toThrow();
    await expect(db.q(`update meta_tester_requests set status = 'weird'`)).rejects.toThrow();
  });
});
