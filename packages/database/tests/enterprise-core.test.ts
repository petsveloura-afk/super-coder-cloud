import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Enterprise core: job runs (+ no double run), app errors (grouped), saved views, satisfaction surveys. */
d("enterprise core (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let other: string;
  let owner: string;
  let outsider: string;
  let contact: string;
  let conv: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@ent.test", "Ent Owner");
    outsider = await db.createUser("out@ent.test", "Ent Out");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('ENT', 'ent-biz') as id`))[0]!.id, true);
    other = await db.as(outsider, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'ent-other') as id`))[0]!.id, true);
    contact = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name) values ($1, 'Dana') returning id`, [org]))[0]!.id;
    conv = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, title, contact_id) values ($1, 'telegram', 'e1', 'Dana', $2) returning id`, [org, contact]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("job runs: a second start while running is refused; finish records duration and status", async () => {
    const a = (await db.q<{ id: string | null }>(`select public.start_job_run('social', 10) as id`))[0]!.id;
    const b = (await db.q<{ id: string | null }>(`select public.start_job_run('social', 10) as id`))[0]!.id;
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    await db.q(`select public.finish_job_run($1, 'ok', 7, null, '{"x":1}')`, [a]);
    const row = (await db.q<{ status: string; items: number; duration_ms: number }>(`select status, items, duration_ms from job_runs where id = $1`, [a]))[0]!;
    expect(row).toMatchObject({ status: "ok", items: 7 });
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
    expect((await db.q<{ id: string | null }>(`select public.start_job_run('social', 10) as id`))[0]!.id).toBeTruthy();
    // only platform admins read it; nobody writes it from the client
    expect(await db.as(owner, (q) => q(`select id from job_runs`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`select public.start_job_run('x', 10)`))).rejects.toThrow();
  });

  it("the database job clock validates its input and is not callable by users", async () => {
    await expect(db.q(`select public.schedule_platform_jobs('http://insecure', 'secret-12345')`)).rejects.toThrow(/https/);
    await expect(db.q(`select public.schedule_platform_jobs('https://x.example', 'short')`)).rejects.toThrow(/too short/);
    await expect(db.as(owner, (q) => q(`select public.schedule_platform_jobs('https://x.example', 'secret-12345')`))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`select public.unschedule_platform_jobs()`))).rejects.toThrow();
  });

  it("app errors are grouped by fingerprint", async () => {
    await db.q(`select public.record_app_error('fp1', 'server', '/he/inbox', 'boom', 'd1', $1)`, [org]);
    await db.q(`select public.record_app_error('fp1', 'server', '/he/inbox', 'boom', 'd2', $1)`, [org]);
    const r = (await db.q<{ count: number; digest: string }>(`select count, digest from app_errors where fingerprint = 'fp1'`))[0]!;
    expect(r).toEqual({ count: 2, digest: "d2" });
    expect(await db.as(owner, (q) => q(`select id from app_errors`))).toHaveLength(0);
  });

  it("saved views: own or shared only, never another business", async () => {
    await db.as(owner, (q) => q(`insert into saved_views (organization_id, user_id, entity, name, filters) values ($1, $2, 'contacts', 'VIP', '{"tag":"vip"}')`, [org, owner]), true);
    expect(await db.as(owner, (q) => q(`select name from saved_views`))).toEqual([{ name: "VIP" }]);
    expect(await db.as(outsider, (q) => q(`select name from saved_views`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`insert into saved_views (organization_id, user_id, entity, name) values ($1, $2, 'contacts', 'x')`, [other, owner]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`insert into saved_views (organization_id, user_id, entity, name) values ($1, $2, 'contacts', 'x')`, [org, outsider]))).rejects.toThrow();
    await expect(db.q(`insert into saved_views (organization_id, user_id, entity, name) values ($1, $2, 'planets', 'x')`, [org, owner])).rejects.toThrow();
  });

  it("closing a conversation creates one survey; the public answer works once and a low score alerts the team", async () => {
    await db.q(`update conversations set status = 'closed' where id = $1`, [conv]);
    expect(await db.q(`select id from survey_responses`)).toHaveLength(0); // surveys are off by default
    await db.q(`update conversations set status = 'open' where id = $1`, [conv]);
    await db.q(`insert into survey_settings (organization_id, enabled, kind, delay_minutes) values ($1, true, 'csat', 0)`, [org]);
    await db.q(`update conversations set status = 'closed' where id = $1`, [conv]);
    const s = await db.q<{ token: string; kind: string; status: string }>(`select token, kind, status from survey_responses where organization_id = $1`, [org]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "csat", status: "pending" });
    // cooldown: closing again does not ask again
    await db.q(`update conversations set status = 'open' where id = $1`, [conv]);
    await db.q(`update conversations set status = 'closed' where id = $1`, [conv]);
    expect(await db.q(`select id from survey_responses where organization_id = $1`, [org])).toHaveLength(1);
    const token = s[0]!.token;
    expect(await db.as(null, (q) => q<{ kind: string; org_name: string }>(`select kind, org_name from public.survey_by_token($1)`, [token]))).toEqual([expect.objectContaining({ kind: "csat", org_name: "ENT" })]);
    expect((await db.as(null, (q) => q<{ r: string }>(`select public.answer_survey($1, 9) as r`, [token])))[0]!.r).toBe("invalid");
    expect((await db.as(null, (q) => q<{ r: string }>(`select public.answer_survey($1, 1, 'slow reply') as r`, [token]), true))[0]!.r).toBe("ok");
    expect((await db.as(null, (q) => q<{ r: string }>(`select public.answer_survey($1, 5) as r`, [token])))[0]!.r).toBe("already");
    const n = await db.q(`select id from notifications where organization_id = $1 and title_key = 'surveys.lowScoreNotification'`, [org]);
    expect(n.length).toBeGreaterThan(0);
    expect(await db.as(outsider, (q) => q(`select id from survey_responses`))).toHaveLength(0);
    expect(await db.as(owner, (q) => q(`select score from survey_responses`))).toEqual([{ score: 1 }]);
  });
});
