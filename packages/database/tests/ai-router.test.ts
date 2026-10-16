import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0026: shared AI provider rests — service only, pruning. */
d("AI router rests (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let user: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    user = await db.createUser("router@test.dev", "Router");
  });
  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("stores rests, upserts by id and prunes old ones", async () => {
    await db.q(`insert into ai_provider_rests (id, until, reason) values ('gemini:…abc123|gemini-3.8-flash', now() + interval '30 seconds', 'rate: per-minute limit')`);
    await db.q(`insert into ai_provider_rests (id, until, reason) values ('gemini:…abc123|gemini-3.8-flash', now() + interval '3 hours', 'daily') on conflict (id) do update set until = excluded.until, reason = excluded.reason`);
    const r = (await db.q<{ reason: string }>(`select reason from ai_provider_rests`))[0]!;
    expect(r.reason).toBe("daily");
    await db.q(`insert into ai_provider_rests (id, until) values ('groq|*|old-model', now() - interval '2 days')`);
    const n = (await db.q<{ n: number }>(`select public.ai_provider_rests_prune() as n`))[0]!.n;
    expect(n).toBe(1);
    await expect(db.q(`insert into ai_provider_rests (id, until) values ('x', now())`)).rejects.toThrow();
  });

  it("is invisible to signed-in users and visitors", async () => {
    await expect(db.as(user, (q) => q(`select * from ai_provider_rests`))).rejects.toThrow();
    await expect(db.as(null, (q) => q(`select * from ai_provider_rests`))).rejects.toThrow();
    await expect(db.as(user, (q) => q(`select public.ai_provider_rests_prune()`))).rejects.toThrow();
  });
});
