import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Agent coordination (real Postgres): one agent per customer per purpose at a time; overlaps avoided are counted; members see the board. */
d("agent coordination (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let outsider: string;
  let org: string;
  let contact: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@co.test", "Owner Coord");
    outsider = await db.createUser("x@co.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Coord Biz', 'coord-biz') as id`))[0]!.id, true);
    contact = (await db.q<{ id: string }>(`insert into public.contacts (organization_id, first_name, last_name) values ($1, 'דנה', 'כהן') returning id`, [org]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  const claim = async (owner_: string, lane = "outreach", force = false, minutes = 60) =>
    (await db.q<{ r: { granted: boolean; holder: string } }>(`select public.agent_claim($1, 'contact', $2, $3, $4, $5, 'note', $6) as r`, [org, contact, lane, owner_, minutes, force]))[0]!.r;

  it("first agent gets the customer; a second agent with the same purpose steps aside; the same agent can renew", async () => {
    expect(await claim("smart:reengage")).toMatchObject({ granted: true, holder: "smart:reengage" });
    expect(await claim("team:employee")).toMatchObject({ granted: false, holder: "smart:reengage" });
    expect(await claim("smart:reengage")).toMatchObject({ granted: true });
    // another purpose on the same customer is independent
    expect(await claim("smart:collections", "money")).toMatchObject({ granted: true });
    // a person's explicit action always goes through (and takes the claim)
    expect(await claim("team:employee", "outreach", true)).toMatchObject({ granted: true, holder: "team:employee" });
  });

  it("an ended window frees the customer; release gives a fresh claim back", async () => {
    await db.q(`update public.agent_claims set until = now() - interval '1 minute' where organization_id = $1 and lane = 'outreach'`, [org]);
    expect(await claim("smart:reviews")).toMatchObject({ granted: true, holder: "smart:reviews" });
    const rel = (await db.q<{ r: boolean }>(`select public.agent_release($1, 'contact', $2, 'outreach', 'smart:reviews') as r`, [org, contact]))[0]!.r;
    expect(rel).toBe(true);
    expect(await claim("smart:reengage")).toMatchObject({ granted: true });
  });

  it("members see who handles what + overlaps avoided; outsiders and the app cannot claim", async () => {
    await claim("team:employee");
    const o = await db.as(owner, async (q) => (await q<{ o: { active_count: number; prevented_7d: number; active: { name: string; owner: string }[] } }>(`select public.agent_coordination_overview($1) as o`, [org]))[0]!.o);
    expect(Number(o.active_count)).toBeGreaterThanOrEqual(2);
    expect(Number(o.prevented_7d)).toBeGreaterThanOrEqual(2);
    expect(o.active.some((a) => a.name === "דנה כהן")).toBe(true);
    await expect(db.as(outsider, (q) => q(`select public.agent_coordination_overview($1)`, [org]))).rejects.toThrow(/forbidden/);
    await expect(db.as(owner, (q) => q(`select public.agent_claim($1, 'contact', $2, 'outreach', 'person:owner', 10, null, false)`, [org, randomUUID()]))).rejects.toThrow(/permission denied/);
    const rows = await db.as(outsider, (q) => q(`select * from public.agent_claims where organization_id = $1`, [org]));
    expect(rows).toHaveLength(0);
  });
});
