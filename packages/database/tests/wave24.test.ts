import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 24 (real Postgres): saved replies — members read, only repliers write, other orgs see nothing. */
d("wave 24 — saved replies (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string, analyst: string, outsider: string;
  let org: string, other: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@w24.test", "Owner TwentyFour");
    analyst = await db.createUser("analyst@w24.test", "Analyst TwentyFour");
    outsider = await db.createUser("out@w24.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('TwentyFour', 'twentyfour-biz') as id`))[0]!.id, true);
    other = await db.as(outsider, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'other-w24') as id`))[0]!.id, true);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'analyst')`, [org, analyst]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("an owner adds a reply; the shortcut is unique per business and validated", async () => {
    const id = await db.as(owner, async (q) => (await q<{ id: string }>(`insert into saved_replies (organization_id, title, body, shortcut, created_by) values ($1, 'מחירון', 'היי {name}, מצרף מחירון', 'מחיר', $2) returning id`, [org, owner]))[0]!.id, true);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(db.as(owner, (q) => q(`insert into saved_replies (organization_id, title, body, shortcut) values ($1, 'שוב', 'x', 'מחיר')`, [org]))).rejects.toThrow(/duplicate|unique/);
    await expect(db.as(owner, (q) => q(`insert into saved_replies (organization_id, title, body, shortcut) values ($1, 'רע', 'x', 'bad shortcut!')`, [org]))).rejects.toThrow(/check/);
    await expect(db.as(owner, (q) => q(`insert into saved_replies (organization_id, title, body) values ($1, '', 'x')`, [org]))).rejects.toThrow(/check/);
  });

  it("an analyst reads but cannot write; use_saved_reply does nothing for him", async () => {
    const rows = await db.as(analyst, (q) => q<{ id: string; use_count: number }>(`select id, use_count from saved_replies where organization_id = $1`, [org]));
    expect(rows).toHaveLength(1);
    await expect(db.as(analyst, (q) => q(`insert into saved_replies (organization_id, title, body) values ($1, 't', 'b')`, [org]))).rejects.toThrow(/row-level security/);
    await db.as(analyst, (q) => q(`select public.use_saved_reply($1)`, [rows[0]!.id]), true);
    const del = await db.as(analyst, (q) => q(`delete from saved_replies where id = $1 returning id`, [rows[0]!.id]), true);
    expect(del).toHaveLength(0);
    expect((await db.q<{ use_count: number }>(`select use_count from saved_replies where id = $1`, [rows[0]!.id]))[0]!.use_count).toBe(0);
  });

  it("the owner's use counts; another business sees and changes nothing", async () => {
    const id = (await db.q<{ id: string }>(`select id from saved_replies where organization_id = $1`, [org]))[0]!.id;
    await db.as(owner, (q) => q(`select public.use_saved_reply($1)`, [id]), true);
    await db.as(outsider, (q) => q(`select public.use_saved_reply($1)`, [id]), true);
    expect((await db.q<{ use_count: number }>(`select use_count from saved_replies where id = $1`, [id]))[0]!.use_count).toBe(1);
    expect(await db.as(outsider, (q) => q(`select id from saved_replies`))).toHaveLength(0);
    await expect(db.as(outsider, (q) => q(`insert into saved_replies (organization_id, title, body) values ($1, 't', 'b')`, [org]))).rejects.toThrow(/row-level security/);
    expect(other).toBeTruthy();
    // anonymous visitors have no access at all
    await expect(db.as(null, (q) => q(`select id from saved_replies`))).rejects.toThrow(/permission denied/);
  });
});
