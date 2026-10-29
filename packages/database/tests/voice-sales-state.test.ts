import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 55: voice persona column + sales funnel state with a logged, permission-checked manual override (real Postgres + RLS). */
d("voice persona + sales state (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let org: string;
  let owner: string;
  let analyst: string;
  let outsider: string;
  let conv: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@funnel.test", "Funnel Owner");
    analyst = await db.createUser("analyst@funnel.test", "Funnel Analyst");
    outsider = await db.createUser("out@funnel.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Funnel', 'funnel-biz') as id`))[0]!.id, true);
    await db.as(outsider, async (q) => q(`select public.create_organization('Other', 'other-funnel')`), true);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'analyst')`, [org, analyst]);
    conv = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, title) values ($1, 'telegram', '5551', 'Dana') returning id`, [org]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("agents get a voice object (default empty) and invalid states are rejected", async () => {
    const a = (await db.q<{ voice: Record<string, unknown> }>(`insert into ai_agents (organization_id, name, model) values ($1, 'A', 'gemini-flash-latest') returning voice`, [org]))[0]!;
    expect(a.voice).toEqual({});
    await expect(db.q(`update ai_agents set voice = '[]'::jsonb where organization_id = $1`, [org])).rejects.toThrow();
    await expect(db.q(`update conversations set sales_state = 'WHATEVER' where id = $1`, [conv])).rejects.toThrow();
  });

  it("the team moves the state by hand — logged; others cannot", async () => {
    const r = await db.as(owner, async (q) => (await q<{ r: { ok: boolean; changed: boolean } }>(`select public.set_sales_state($1, 'CLOSING', 'manual') as r`, [conv]))[0]!.r, true);
    expect(r).toMatchObject({ ok: true, changed: true });
    const row = (await db.q<{ sales_state: string }>(`select sales_state from conversations where id = $1`, [conv]))[0]!;
    expect(row.sales_state).toBe("CLOSING");
    const ev = await db.as(owner, (q) => q<{ to_state: string; source: string }>(`select to_state, source from conversation_state_events where conversation_id = $1`, [conv]));
    expect(ev).toEqual([{ to_state: "CLOSING", source: "team" }]);
    const denied = await db.as(outsider, async (q) => (await q<{ r: { ok: boolean; error: string } }>(`select public.set_sales_state($1, 'NEW_LEAD') as r`, [conv]))[0]!.r);
    expect(denied).toMatchObject({ ok: false, error: "errors.forbidden" });
    const bad = await db.as(owner, async (q) => (await q<{ r: { ok: boolean } }>(`select public.set_sales_state($1, 'nope') as r`, [conv]))[0]!.r);
    expect(bad.ok).toBe(false);
    expect(await db.as(outsider, (q) => q(`select id from conversation_state_events`))).toHaveLength(0);
  });

  it("paid features: plans include them, a free business gets one 7-day trial per feature", async () => {
    const plans = await db.q<{ key: string; f: string[] }>(`select key, features as f from plans order by sort`);
    const by = Object.fromEntries(plans.map((p) => [p.key, p.f]));
    expect(by.free).not.toContain("voice_notes");
    expect(by.pro).toEqual(expect.arrayContaining(["voice_notes", "ai_operator", "ai_team"]));
    expect(by.pro).not.toContain("ai_team_plus");
    expect(by.business).toEqual(expect.arrayContaining(["voice_notes", "ai_operator", "ai_team", "ai_team_plus"]));

    const access = async (uid: string) => db.as(uid, async (q) => (await q<{ a: { allowed: boolean; via: string | null; trial_available: boolean } }>(`select public.feature_access($1, 'voice_notes') as a`, [org]))[0]!.a);
    expect(await access(owner)).toMatchObject({ allowed: false, via: null, trial_available: true });
    // an analyst cannot start a trial; an outsider cannot either
    const denied = await db.as(analyst, async (q) => (await q<{ r: { ok: boolean; error: string } }>(`select public.start_feature_trial($1, 'voice_notes') as r`, [org]))[0]!.r);
    expect(denied).toMatchObject({ ok: false, error: "errors.forbidden" });
    const started = await db.as(owner, async (q) => (await q<{ r: { ok: boolean } }>(`select public.start_feature_trial($1, 'voice_notes') as r`, [org]))[0]!.r, true);
    expect(started.ok).toBe(true);
    expect(await access(owner)).toMatchObject({ allowed: true, via: "trial", trial_available: false });
    const has = (await db.q<{ h: boolean }>(`select public.has_feature($1, 'voice_notes') as h`, [org]))[0]!.h;
    expect(has).toBe(true);
    const again = await db.as(owner, async (q) => (await q<{ r: { ok: boolean; error: string } }>(`select public.start_feature_trial($1, 'voice_notes') as r`, [org]))[0]!.r);
    expect(again).toMatchObject({ ok: false, error: "trial.used" });
    const notTrialable = await db.as(owner, async (q) => (await q<{ r: { ok: boolean; error: string } }>(`select public.start_feature_trial($1, 'api_access') as r`, [org]))[0]!.r);
    expect(notTrialable).toMatchObject({ ok: false, error: "trial.notAvailable" });
    // the trial ends → locked again (and no second trial)
    await db.q(`update feature_trials set ends_at = now() - interval '1 minute' where organization_id = $1`, [org]);
    expect((await db.q<{ h: boolean }>(`select public.has_feature($1, 'voice_notes') as h`, [org]))[0]!.h).toBe(false);
    expect(await access(owner)).toMatchObject({ allowed: false, trial_available: false });
    // members see their own business' trials only
    expect(await db.as(outsider, (q) => q(`select feature from feature_trials`))).toHaveLength(0);
  });
});
