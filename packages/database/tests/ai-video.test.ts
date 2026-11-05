import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** AI video (real Postgres): N credits in one usage row, exact pack refunds on failure, server-only job writes. */
d("AI video — bulk credits and video jobs (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let outsider: string;
  let org: string;
  const bal = async () => Number((await db.q<{ b: string }>(`select public.ai_credit_balance($1) as b`, [org]))[0]!.b);

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@vid.test", "Owner Video");
    outsider = await db.createUser("x@vid.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Video Biz', 'video-biz') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("inside the monthly allowance: one usage row worth N credits; success keeps them, failure makes them 0", async () => {
    const id = (await db.q<{ id: string }>(`select public.reserve_ai_credits_bulk($1, 'video_gen', 5) as id`, [org]))[0]!.id;
    const row = (await db.q<{ credits: number; status: string; feature: string }>(`select credits, status, feature from ai_usage where id = $1`, [id]))[0]!;
    expect(row).toMatchObject({ credits: 5, status: "pending", feature: "video_gen" });
    await db.q(`select public.finalize_ai_usage_bulk($1, 'replicate', 'wan', true)`, [id]);
    expect((await db.q<{ credits: number; status: string }>(`select credits, status from ai_usage where id = $1`, [id]))[0]).toMatchObject({ credits: 5, status: "ok" });
    const id2 = (await db.q<{ id: string }>(`select public.reserve_ai_credits_bulk($1, 'video_gen', 5) as id`, [org]))[0]!.id;
    await db.q(`select public.finalize_ai_usage_bulk($1, 'replicate', 'wan', false)`, [id2]);
    expect((await db.q<{ credits: number; status: string }>(`select credits, status from ai_usage where id = $1`, [id2]))[0]).toMatchObject({ credits: 0, status: "error" });
    // finalizing twice changes nothing
    await db.q(`select public.finalize_ai_usage_bulk($1, 'replicate', 'wan', true)`, [id2]);
    expect((await db.q<{ status: string }>(`select status from ai_usage where id = $1`, [id2]))[0]!.status).toBe("error");
  });

  it("beyond the allowance the credits come from a pack — and a failed clip gives every one of them back (no double refund)", async () => {
    // use up the monthly allowance
    const lim = Number((await db.q<{ l: string }>(`select public.plan_limit($1, 'ai_credits_monthly') as l`, [org]))[0]!.l);
    const used = Number((await db.q<{ u: string }>(`select public.ai_credits_used($1) as u`, [org]))[0]!.u);
    if (lim > used) await db.q(`insert into ai_usage (organization_id, feature, credits, status) values ($1, 'insights', $2, 'ok')`, [org, lim - used]);
    await expect(db.q(`select public.reserve_ai_credits_bulk($1, 'video_gen', 8)`, [org])).rejects.toThrow(/plan_limit:ai_credits/);
    await db.q(`insert into credit_ledger (organization_id, kind, delta, reason) values ($1, 'ai', 20, 'admin')`, [org]);
    expect(await bal()).toBe(20);
    const ok = (await db.q<{ id: string }>(`select public.reserve_ai_credits_bulk($1, 'video_gen', 8) as id`, [org]))[0]!.id;
    expect(await bal()).toBe(12);
    await db.q(`select public.finalize_ai_usage_bulk($1, 'google', 'omni', true)`, [ok]);
    expect(await bal()).toBe(12);
    const bad = (await db.q<{ id: string }>(`select public.reserve_ai_credits_bulk($1, 'video_gen', 8) as id`, [org]))[0]!.id;
    expect(await bal()).toBe(4);
    await db.q(`select public.finalize_ai_usage_bulk($1, 'google', 'omni', false)`, [bad]);
    expect(await bal()).toBe(12);
    // not enough left in the pack for another clip
    await db.q(`insert into credit_ledger (organization_id, kind, delta, reason) values ($1, 'ai', -10, 'admin')`, [org]);
    await expect(db.q(`select public.reserve_ai_credits_bulk($1, 'video_gen', 8)`, [org])).rejects.toThrow(/plan_limit:ai_credits/);
  });

  it("signed-in users cannot reserve bulk credits themselves", async () => {
    await expect(db.as(owner, (q) => q(`select public.reserve_ai_credits_bulk($1, 'video_gen', 1)`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`select public.finalize_ai_usage_bulk(1, 'x', 'y', true)`))).rejects.toThrow();
  });

  it("video jobs: the team reads its own, an outsider sees nothing, nobody signed-in can write", async () => {
    await db.q(`insert into social_video_jobs (organization_id, request, prompt, aspect, seconds, status, credits) values ($1, 'פוסט על תספורת', 'Video: a groomer', '9:16', 8, 'running', 15)`, [org]);
    expect(await db.as(owner, (q) => q(`select id from social_video_jobs where organization_id = $1`, [org]))).toHaveLength(1);
    expect(await db.as(outsider, (q) => q(`select id from social_video_jobs`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`update social_video_jobs set status = 'done' where organization_id = $1`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`insert into social_video_jobs (organization_id, request, prompt) values ($1, 'xx', 'yy')`, [org]))).rejects.toThrow();
    // a finished clip must have an https link
    await expect(db.q(`insert into social_video_jobs (organization_id, request, prompt, video_url) values ($1, 'xx', 'yy', 'http://x/v.mp4')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into social_video_jobs (organization_id, request, prompt, aspect) values ($1, 'xx', 'yy', '4:3')`, [org])).rejects.toThrow();
  });

  it("the feature list is a superset: every earlier feature still works", async () => {
    for (const f of ["agent_chat", "image_gen", "social", "review_reply", "video_gen"]) {
      await db.q(`insert into ai_usage (organization_id, feature, credits, status) values ($1, $2, 0, 'ok')`, [org, f]);
    }
    await expect(db.q(`insert into ai_usage (organization_id, feature, credits, status) values ($1, 'nope', 0, 'ok')`, [org])).rejects.toThrow();
  });
});
