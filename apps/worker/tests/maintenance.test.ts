import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "../../../packages/database/tests/harness.ts";
import { purgeExpiredInvitations, purgeOldNotifications } from "../src/jobs/maintenance.ts";

const d = dbAvailable ? describe : describe.skip;

d("maintenance jobs (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let user: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    user = await db.createUser("worker@test.io");
    org = await db.as(user, async (q) => (await q<{ id: string }>(`select public.create_organization('Worker Org', 'w-org') as id`))[0]!.id, true);
  });
  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("purges only long-expired, unaccepted invitations", async () => {
    await db.q(
      `insert into invitations (organization_id, email, role, token_hash, invited_by, expires_at, accepted_at) values
        ($1, 'old@x.io', 'sales', repeat('a', 64), $2, now() - interval '40 days', null),
        ($1, 'recent@x.io', 'sales', repeat('b', 64), $2, now() - interval '2 days', null),
        ($1, 'accepted@x.io', 'sales', repeat('c', 64), $2, now() - interval '40 days', now() - interval '41 days'),
        ($1, 'valid@x.io', 'sales', repeat('d', 64), $2, now() + interval '3 days', null)`,
      [org, user],
    );
    expect(await purgeExpiredInvitations(db.client)).toBe(1);
    const left = await db.q<{ email: string }>(`select email from invitations order by email`);
    expect(left.map((r) => r.email)).toEqual(["accepted@x.io", "recent@x.io", "valid@x.io"]);
    expect(await purgeExpiredInvitations(db.client)).toBe(0); // idempotent
  });

  it("purges only old, read notifications", async () => {
    await db.q(
      `insert into notifications (organization_id, user_id, kind, title_key, read_at, created_at) values
        ($1, $2, 'k', 'x', now(), now() - interval '100 days'),
        ($1, $2, 'k', 'x', null, now() - interval '100 days'),
        ($1, $2, 'k', 'x', now(), now() - interval '5 days')`,
      [org, user],
    );
    expect(await purgeOldNotifications(db.client)).toBe(1);
  });
});
