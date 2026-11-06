import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Never-lost team alerts (real Postgres): one delivery per recipient + event + message; managers can see them, others cannot. */
d("notify deliveries (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let outsider: string;
  let org: string;
  let rec: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@nd.test", "Owner");
    outsider = await db.createUser("x@nd.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Alerts Biz', 'alerts-biz') as id`))[0]!.id, true);
    rec = (await db.q<{ id: string }>(`insert into public.notify_recipients (organization_id, kind, target, events) values ($1, 'whatsapp', '972501234567', array['messages']) returning id`, [org]))[0]!.id;
  });
  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("the same alert is recorded once; another event or message is a new one", async () => {
    const m = randomUUID();
    const ins = (event: string, msg: string) => db.q(`insert into public.notify_deliveries (organization_id, recipient_id, event, message_id) values ($1, $2, $3, $4)`, [org, rec, event, msg]);
    await ins("messages", m);
    await expect(ins("messages", m)).rejects.toThrow(/duplicate key/);
    await ins("leads", m);
    await ins("messages", randomUUID());
    expect((await db.q(`select 1 from public.notify_deliveries where organization_id = $1`, [org])).length).toBe(3);
  });

  it("only members who manage integrations see the deliveries; a removed recipient takes its deliveries with it", async () => {
    expect((await db.as(owner, (q) => q(`select id from public.notify_deliveries where organization_id = $1`, [org]))).length).toBe(3);
    expect((await db.as(outsider, (q) => q(`select id from public.notify_deliveries where organization_id = $1`, [org]))).length).toBe(0);
    await expect(db.as(owner, (q) => q(`insert into public.notify_deliveries (organization_id, recipient_id, event, message_id) values ($1, $2, 'messages', $3)`, [org, rec, randomUUID()]))).rejects.toThrow(/permission denied/);
    await db.q(`delete from public.notify_recipients where id = $1`, [rec]);
    expect((await db.q(`select 1 from public.notify_deliveries where organization_id = $1`, [org])).length).toBe(0);
  });
});
