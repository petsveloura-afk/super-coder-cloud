import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 54: long-term customer memory, operator runs and the two new team agents (real Postgres + RLS). */
d("agents memory + operator (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let owner: string;
  let analyst: string;
  let outsider: string;
  let contact: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@mem.test", "Mem Owner");
    analyst = await db.createUser("analyst@mem.test", "Mem Analyst");
    outsider = await db.createUser("out@mem.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Mem', 'mem-biz') as id`))[0]!.id, true);
    await db.as(outsider, async (q) => q(`select public.create_organization('Other', 'other-biz')`), true);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'analyst')`, [org, analyst]);
    contact = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone) values ($1, 'Dana', '0541234567') returning id`, [org]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("the team saves memories; duplicates (case-insensitive) are rejected", async () => {
    await db.as(owner, (q) => q(`insert into contact_memories (organization_id, contact_id, fact, source, created_by) values ($1, $2, 'Prefers evening calls', 'team', $3)`, [org, contact, owner]), true);
    await expect(db.as(owner, (q) => q(`insert into contact_memories (organization_id, contact_id, fact, source) values ($1, $2, 'prefers EVENING calls', 'team')`, [org, contact]))).rejects.toThrow();
    await expect(db.q(`insert into contact_memories (organization_id, contact_id, fact, kind) values ($1, $2, 'x', 'fact')`, [org, contact])).rejects.toThrow();
    await expect(db.q(`insert into contact_memories (organization_id, contact_id, fact, kind) values ($1, $2, 'valid fact', 'nonsense')`, [org, contact])).rejects.toThrow();
  });

  it("RLS: other businesses see nothing and cannot write", async () => {
    const seen = await db.as(outsider, (q) => q(`select id from contact_memories`));
    expect(seen).toHaveLength(0);
    await expect(db.as(outsider, (q) => q(`insert into contact_memories (organization_id, contact_id, fact, source) values ($1, $2, 'injected fact', 'team')`, [org, contact]))).rejects.toThrow();
    const ownerSees = await db.as(owner, (q) => q(`select id from contact_memories`));
    expect(ownerSees).toHaveLength(1);
  });

  it("operator runs are private to the user", async () => {
    await db.as(owner, (q) => q(`insert into operator_runs (organization_id, user_id, instruction, plan) values ($1, $2, 'create a task', '{"actions":[]}')`, [org, owner]), true);
    expect(await db.as(outsider, (q) => q(`select id from operator_runs`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`insert into operator_runs (organization_id, user_id, instruction) values ($1, $2, 'spoof')`, [org, analyst]))).rejects.toThrow();
  });

  it("the new agents are accepted by the existing agent tables", async () => {
    await db.q(`insert into agent_settings (organization_id, agent, enabled, config) values ($1, 'reviews_requester', true, '{}'), ($1, 'reengage', true, '{}')`, [org]);
    await db.q(`insert into agent_runs (organization_id, agent, summary) values ($1, 'reengage', 'ok'), ($1, 'operator', 'ok')`, [org]);
    const claimed = await db.q<{ organization_id: string }>(`select * from public.claim_due_agents('reviews_requester', 60, 5)`);
    expect(claimed.map((r) => r.organization_id)).toContain(org);
  });
});
