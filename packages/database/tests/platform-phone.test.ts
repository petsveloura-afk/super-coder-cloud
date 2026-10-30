import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 57: platform phone numbers — one per business, members read their own, only the server writes. */
d("platform phone numbers (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let other: string;
  let owner: string;
  let outsider: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@pp.test", "PP Owner");
    outsider = await db.createUser("out@pp.test", "PP Out");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('PP', 'pp-biz') as id`))[0]!.id, true);
    other = await db.as(outsider, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'pp-other') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("one number per business, unique across businesses, E.164 only", async () => {
    await db.q(`insert into org_phone_numbers (organization_id, phone_number, source) values ($1, '+15551230001', 'platform')`, [org]);
    await expect(db.q(`insert into org_phone_numbers (organization_id, phone_number) values ($1, '+15551230001')`, [other])).rejects.toThrow();
    await expect(db.q(`insert into org_phone_numbers (organization_id, phone_number) values ($1, '0501234567')`, [other])).rejects.toThrow();
  });

  it("members read their own number; nobody writes from the browser", async () => {
    expect(await db.as(owner, (q) => q(`select phone_number from org_phone_numbers`))).toHaveLength(1);
    expect(await db.as(outsider, (q) => q(`select phone_number from org_phone_numbers`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`insert into org_phone_numbers (organization_id, phone_number) values ($1, '+15551230002')`, [org]))).rejects.toThrow();
  });

  it("calls record which account carried them", async () => {
    const c = (await db.q<{ via: string }>(`insert into voice_calls (organization_id, direction) values ($1, 'in') returning via`, [org]))[0]!;
    expect(c.via).toBe("own");
    await expect(db.q(`insert into voice_calls (organization_id, direction, via) values ($1, 'in', 'other')`, [org])).rejects.toThrow();
  });
});
