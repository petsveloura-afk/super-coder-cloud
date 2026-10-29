import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 56: the agent's voice clips are server-only; calls record how they ran (turn / realtime). */
d("voice live calls (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let owner: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@live.test", "Live Owner");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Live', 'live-biz') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("clips are readable by the server only", async () => {
    await db.q(`insert into voice_clips (organization_id, audio_b64) values ($1, 'AAAA')`, [org]);
    await expect(db.as(owner, (q) => q(`select id from voice_clips`))).rejects.toThrow();
    await expect(db.q(`insert into voice_clips (organization_id, mime, audio_b64) values ($1, 'video/mp4', 'AA')`, [org])).rejects.toThrow();
  });

  it("calls default to turn mode and accept realtime only", async () => {
    const c = (await db.q<{ mode: string; id: string }>(`insert into voice_calls (organization_id, direction) values ($1, 'in') returning id, mode`, [org]))[0]!;
    expect(c.mode).toBe("turn");
    await db.q(`update voice_calls set mode = 'realtime' where id = $1`, [c.id]);
    await expect(db.q(`update voice_calls set mode = 'video' where id = $1`, [c.id])).rejects.toThrow();
  });
});
