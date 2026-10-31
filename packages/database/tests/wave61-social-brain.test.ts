import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/**
 * Wave 61: the social brain — autopilot settings (validated, tenant-isolated), one claim per day (no double
 * posts), learning table written only by the server, new post columns validated, existing posts untouched.
 */
d("wave 61 social brain (real Postgres)", () => {
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
    owner = await db.createUser("owner@w61.test", "W61 Owner");
    outsider = await db.createUser("out@w61.test", "W61 Out");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('W61', 'w61-biz') as id`))[0]!.id, true);
    other = await db.as(outsider, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'w61-other') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("autopilot settings: the manager writes their own business only, with sane defaults and validation", async () => {
    await db.as(owner, (q) => q(`insert into social_autopilot (organization_id, enabled, pillars, hashtags) values ($1, true, '{טיפים,מבצעים}', '{#טיפוח}')`, [org]), true);
    const row = (await db.as(owner, (q) => q<{ mode: string; post_time: string; media: string; days: number[] }>(`select mode, post_time, media, days from social_autopilot`)))[0]!;
    expect(row).toMatchObject({ mode: "draft", post_time: "10:00", media: "image" });
    expect(row.days).toEqual([0, 1, 2, 3, 4, 5]);
    await expect(db.as(owner, (q) => q(`insert into social_autopilot (organization_id) values ($1)`, [other]))).rejects.toThrow();
    expect(await db.as(outsider, (q) => q(`select organization_id from social_autopilot`))).toHaveLength(0);
    await expect(db.q(`update social_autopilot set post_time = '25:00' where organization_id = $1`, [org])).rejects.toThrow();
    await expect(db.q(`update social_autopilot set days = '{7}' where organization_id = $1`, [org])).rejects.toThrow();
    await expect(db.q(`update social_autopilot set media = 'hologram' where organization_id = $1`, [org])).rejects.toThrow();
  });

  it("one claim per business per day — never two posts for the same day", async () => {
    const a = await db.q<{ ok: boolean }>(`select public.claim_social_autopilot($1, '2026-11-02') as ok`, [org]);
    const b = await db.q<{ ok: boolean }>(`select public.claim_social_autopilot($1, '2026-11-02') as ok`, [org]);
    const c = await db.q<{ ok: boolean }>(`select public.claim_social_autopilot($1, '2026-11-03') as ok`, [org]);
    expect([a[0]!.ok, b[0]!.ok, c[0]!.ok]).toEqual([true, false, true]);
    // a business that did not enable the autopilot is never claimed
    expect((await db.q<{ ok: boolean }>(`select public.claim_social_autopilot($1, '2026-11-02') as ok`, [other]))[0]!.ok).toBe(false);
    await expect(db.as(owner, (q) => q(`select public.claim_social_autopilot($1, '2026-11-09')`, [org]))).rejects.toThrow();
  });

  it("the brain's learning is private and written only by the server", async () => {
    await db.q(`insert into social_brain (organization_id, learned, posts_analyzed) values ($1, '{"bestHours":[19]}', 4)`, [org]);
    expect(await db.as(owner, (q) => q(`select posts_analyzed from social_brain`))).toEqual([{ posts_analyzed: 4 }]);
    expect(await db.as(outsider, (q) => q(`select organization_id from social_brain`))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`update social_brain set posts_analyzed = 99`))).rejects.toThrow();
  });

  it("new post columns are validated; an old-style post still works unchanged", async () => {
    const old = (await db.q<{ id: string; metrics: unknown; origin: string | null }>(`insert into social_posts (organization_id, body) values ($1, 'פוסט רגיל') returning id, metrics, origin`, [org]))[0]!;
    expect(old.metrics).toEqual({});
    expect(old.origin).toBeNull();
    await db.q(`insert into social_posts (organization_id, body, origin, pillar, media_pending, telegram_chat, engagement, metrics) values ($1, 'יומי', 'autopilot', 'טיפים', 'image', '@mychannel', 12, '{"likes":10,"comments":1}')`, [org]);
    await expect(db.q(`insert into social_posts (organization_id, body, origin) values ($1, 'x', 'spam')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into social_posts (organization_id, body, media_pending) values ($1, 'x', 'gif')`, [org])).rejects.toThrow();
    await expect(db.q(`insert into social_posts (organization_id, body, metrics) values ($1, 'x', '[]')`, [org])).rejects.toThrow();
  });
});
