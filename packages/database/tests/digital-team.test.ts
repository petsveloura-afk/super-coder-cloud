import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** The digital team tables: tenant isolation, read-only from the browser, append-only activity, constraints. */
d("digital team (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let other: string;
  let owner: string;
  let outsider: string;
  let member: string;
  let task: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@team.test", "Owner");
    outsider = await db.createUser("out@team.test", "Out");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('TEAM', 'team-biz') as id`))[0]!.id, true);
    other = await db.as(outsider, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'team-other') as id`))[0]!.id, true);
    member = (await db.q<{ id: string }>(`insert into team_members (organization_id, role_key, name, tools) values ($1, 'sales', 'Daniel', array['crm.find_contacts']) returning id`, [org]))[0]!.id;
    task = (await db.q<{ id: string }>(`insert into team_tasks (organization_id, title, assignee_id) values ($1, 'Call Dana', $2) returning id`, [org, member]))[0]!.id;
    await db.q(`insert into team_settings (organization_id, enabled) values ($1, true)`, [org]);
    await db.q(`insert into team_memory (organization_id, member_id, layer, kind, content) values ($1, $2, 'semantic', 'preference', 'Use the customer''s first name')`, [org, member]);
    await db.q(`insert into team_approvals (organization_id, task_id, member_id, tool, payload) values ($1, $2, $3, 'inbox.send_message', '{"text":"hi"}')`, [org, task, member]);
    await db.q(`insert into team_activity (organization_id, task_id, member_id, phase, summary) values ($1, $2, $3, 'plan', 'planned')`, [org, task, member]);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("members of the business read their team; another business sees nothing", async () => {
    for (const t of ["team_members", "team_tasks", "team_memory", "team_approvals", "team_activity", "team_settings"]) {
      expect((await db.as(owner, (q) => q(`select 1 from ${t}`))).length, t).toBeGreaterThan(0);
      expect(await db.as(outsider, (q) => q(`select 1 from ${t}`)), t).toHaveLength(0);
    }
  });

  it("nothing is written from the browser (server-only writes after permission checks)", async () => {
    await expect(db.as(owner, (q) => q(`insert into team_members (organization_id, role_key, name) values ($1, 'sales', 'x')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`update team_approvals set status = 'approved'`))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`update team_settings set emergency_stop = true`))).rejects.toThrow();
    await expect(db.as(outsider, (q) => q(`insert into team_tasks (organization_id, title) values ($1, 'steal')`, [org]))).rejects.toThrow();
  });

  it("the activity log is append-only — even for the server", async () => {
    await expect(db.q(`update team_activity set summary = 'rewritten'`)).rejects.toThrow(/append-only/);
    await expect(db.q(`delete from team_activity`)).rejects.toThrow(/append-only/);
    // deleting a task keeps its log (no foreign key rewrites the history)
    await db.q(`delete from team_approvals where task_id = $1`, [task]);
    await db.q(`delete from team_tasks where id = $1`, [task]);
    expect(await db.q(`select summary from team_activity where organization_id = $1`, [org])).toEqual([{ summary: "planned" }]);
  });

  it("constraints: roles, autonomy, statuses, tool names, memory layers", async () => {
    await expect(db.q(`insert into team_members (organization_id, role_key, name, autonomy) values ($1, 'sales', 'x', 'yolo')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into team_members (organization_id, role_key, name) values ($1, 'Bad Role!', 'x')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into team_tasks (organization_id, title, status) values ($1, 'x', 'teleported')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into team_approvals (organization_id, tool) values ($1, 'rm -rf')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into team_memory (organization_id, layer, kind, content) values ($1, 'working', 'fact', 'xx')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into team_settings (organization_id, max_depth) values ($1, 99)`, [other])).rejects.toThrow();
  });

  it("model routing is platform-admin only; the team clock is not callable by users", async () => {
    await db.q(`insert into ai_routing (task_kind, models) values ('plan', '[{"provider":"anthropic","model":"claude-sonnet-5-5"}]')`);
    expect(await db.as(owner, (q) => q(`select task_kind from ai_routing`))).toHaveLength(0);
    await expect(db.q(`select public.schedule_team_job('http://insecure', 'secret-12345')`)).rejects.toThrow(/https/);
    await expect(db.as(owner, (q) => q(`select public.schedule_team_job('https://x.example', 'secret-12345')`))).rejects.toThrow();
  });

  it("deleting a business removes its whole team (the log cascade is allowed)", async () => {
    // a bare business row (businesses are normally soft-deleted; this checks the cascade path of the log trigger)
    const tmp = (await db.q<{ id: string }>(`insert into organizations (name, slug) values ('Tmp', 'team-tmp') returning id`))[0]!.id;
    await db.q(`insert into team_activity (organization_id, phase, summary) values ($1, 'system', 'x')`, [tmp]);
    await db.q(`delete from organizations where id = $1`, [tmp]);
    expect(await db.q(`select 1 from team_activity where organization_id = $1`, [tmp])).toHaveLength(0);
  });
});
