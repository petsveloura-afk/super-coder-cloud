import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/**
 * 0013 run_maintenance(): the daily cron job that replaces a separate worker.
 * Must only delete what is truly stale, be idempotent, and be callable by the
 * service role only (never by signed-in users or anonymous visitors).
 */
d("scheduled maintenance: run_maintenance() (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let org: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@m.test");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Maint Org', 'maint-org') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'business' where id = $1`, [org]);

    // invitations: one expired long ago (purge), one expired recently (keep), one accepted long ago (keep)
    await db.q(
      `insert into invitations (organization_id, email, token_hash, invited_by, expires_at, accepted_at) values
         ($1, 'old@m.test',      'h-old',      $2, now() - interval '40 days', null),
         ($1, 'recent@m.test',   'h-recent',   $2, now() - interval '5 days',  null),
         ($1, 'accepted@m.test', 'h-accepted', $2, now() - interval '60 days', now() - interval '61 days')`,
      [org, owner],
    );
    // notifications: read+old (purge), unread+old (keep), read+new (keep)
    await db.q(
      `insert into notifications (organization_id, user_id, kind, title_key, read_at, created_at) values
         ($1, $2, 'test', 't.a', now() - interval '91 days', now() - interval '100 days'),
         ($1, $2, 'test', 't.b', null,                        now() - interval '100 days'),
         ($1, $2, 'test', 't.c', now(),                       now() - interval '1 day')`,
      [org, owner],
    );
    // rate limits: old window (purge), current window (keep)
    await db.q(
      `insert into rate_limits (bucket, window_start, count) values
         ('old-bucket', now() - interval '3 days', 5),
         ('new-bucket', now(), 1)`,
    );
    // AI usage: stuck pending > 1h (release), fresh pending (keep), ok (keep)
    await db.q(
      `insert into ai_usage (organization_id, user_id, feature, credits, status, created_at) values
         ($1, $2, 'agent_chat', 3, 'pending', now() - interval '2 hours'),
         ($1, $2, 'agent_chat', 2, 'pending', now() - interval '5 minutes'),
         ($1, $2, 'agent_chat', 4, 'ok',      now() - interval '2 hours')`,
      [org, owner],
    );
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("is not callable by signed-in users or anonymous visitors", async () => {
    await expect(db.as(owner, (q) => q(`select public.run_maintenance()`))).rejects.toThrow(/permission denied/);
    await expect(db.as(null, (q) => q(`select public.run_maintenance()`))).rejects.toThrow(/permission denied/);
  });

  it("is executable by the service role", async () => {
    const r = await db.q<{ ok: boolean }>(
      `select has_function_privilege('service_role', 'public.run_maintenance()', 'execute') as ok`,
    );
    expect(r[0]!.ok).toBe(true);
  });

  it("purges only stale rows and releases stuck AI reservations", async () => {
    await db.q(`set role service_role`);
    const res = (await db.q<{ r: Record<string, unknown> }>(`select public.run_maintenance() as r`))[0]!.r;
    await db.q(`reset role`);
    expect(res).toMatchObject({
      invitations_purged: 1,
      notifications_purged: 1,
      rate_limit_rows_purged: 1,
      ai_pending_released: 1,
    });
    expect(typeof res.ran_at).toBe("string");

    const inv = await db.q<{ email: string }>(`select email::text from invitations where organization_id = $1 order by email`, [org]);
    expect(inv.map((x) => x.email)).toEqual(["accepted@m.test", "recent@m.test"]);

    const notif = await db.q<{ title_key: string }>(`select title_key from notifications where organization_id = $1 order by title_key`, [org]);
    expect(notif.map((x) => x.title_key)).toEqual(["t.b", "t.c"]);

    const rl = await db.q<{ bucket: string }>(`select bucket from rate_limits order by bucket`);
    expect(rl.map((x) => x.bucket)).toEqual(["new-bucket"]);

    const ai = await db.q<{ status: string; credits: number }>(
      `select status, credits from ai_usage where organization_id = $1 order by created_at, id`,
      [org],
    );
    // two rows from 2h ago (released pending + untouched ok), then the fresh pending one
    expect(ai).toEqual(
      expect.arrayContaining([
        { status: "error", credits: 0 },
        { status: "ok", credits: 4 },
        { status: "pending", credits: 2 },
      ]),
    );
    expect(ai).toHaveLength(3);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const res = (await db.q<{ r: Record<string, number> }>(`select public.run_maintenance() as r`))[0]!.r;
    expect(res).toMatchObject({
      invitations_purged: 0,
      notifications_purged: 0,
      rate_limit_rows_purged: 0,
      ai_pending_released: 0,
    });
  });
});
