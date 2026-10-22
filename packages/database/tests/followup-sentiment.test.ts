import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 16: the follow-up adapts to the customer's mood (real Postgres). */
d("follow-up by sentiment (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let owner: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@mood.test", "Mood Owner");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Mood', 'mood-biz') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  async function setup(name: string, phone: string, sentiment: string | null, leadScore: string | null = null) {
    const c = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone) values ($1, $2, $3) returning id`, [org, name, phone]))[0]!.id;
    if (sentiment) await db.q(`insert into contact_insights (contact_id, organization_id, sentiment) values ($1, $2, $3)`, [c, org, sentiment]);
    const conv = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, contact_id, title, lead_score) values ($1, 'telegram', $2, $3, $4, $5) returning id`, [org, phone, c, name, leadScore]))[0]!.id;
    return conv;
  }
  const hoursAhead = async (conv: string) => {
    const r = await db.q<{ h: number }>(`select extract(epoch from run_at - now()) / 3600 as h from conversation_schedules where conversation_id = $1 and kind = 'followup' and status = 'pending'`, [conv]);
    return r.length ? Number(r[0]!.h) : null;
  };

  it("neutral: the normal delay", async () => {
    const conv = await setup("Neutral", "0541000001", "neutral");
    await db.q(`select public.plan_followup($1, 3, 1)`, [conv]);
    expect(await hoursAhead(conv)).toBeCloseTo(3, 1);
  });

  it("positive or hot: sooner (half, at least 1 hour)", async () => {
    const pos = await setup("Happy", "0541000002", "positive");
    await db.q(`select public.plan_followup($1, 3, 1)`, [pos]);
    expect(await hoursAhead(pos)).toBeCloseTo(1.5, 1);
    const hot = await setup("Hot", "0541000003", null, "hot");
    await db.q(`select public.plan_followup($1, 1, 1)`, [hot]);
    expect(await hoursAhead(hot)).toBeCloseTo(1, 1);
  });

  it("negative: no automated chasing, the team gets one heads-up", async () => {
    const conv = await setup("Angry", "0541000004", "negative");
    const r = (await db.q<{ id: string | null }>(`select public.plan_followup($1, 3, 1) as id`, [conv]))[0]!.id;
    expect(r).toBeNull();
    expect(await hoursAhead(conv)).toBeNull();
    await db.q(`select public.plan_followup($1, 3, 1)`, [conv]);
    const n = await db.q<{ title_key: string }>(`select title_key from notifications where organization_id = $1 and link = $2`, [org, `/inbox?c=${conv}`]);
    expect(n).toHaveLength(1);
    expect(n[0]!.title_key).toBe("followupMood.negativeNotification");
  });

  it("the mood changes → a pending plan is replaced on the next AI answer", async () => {
    const conv = await setup("Turn", "0541000005", "neutral");
    await db.q(`select public.plan_followup($1, 3, 1)`, [conv]);
    expect(await hoursAhead(conv)).not.toBeNull();
    await db.q(`update contact_insights set sentiment = 'negative' where contact_id = (select contact_id from conversations where id = $1)`, [conv]);
    await db.q(`select public.plan_followup($1, 3, 1)`, [conv]);
    expect(await hoursAhead(conv)).toBeNull();
  });
});
