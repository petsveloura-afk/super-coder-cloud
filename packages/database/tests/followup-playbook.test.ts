import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Follow-up playbook (real Postgres): the workspace policy gets four more settings; every earlier key keeps its meaning. */
d("follow-up playbook policy (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let outsider: string;
  let org: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@fp.test", "Owner Playbook");
    outsider = await db.createUser("x@fp.test", "Outsider");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Playbook Biz', 'playbook-biz') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  const policy = async () => (await db.q<{ p: Record<string, unknown> }>(`select public.conversation_policy($1) as p`, [org]))[0]!.p;

  it("defaults: every earlier key unchanged + playbook, stop-on-convert and night guard on, cross-channel off", async () => {
    expect(await policy()).toMatchObject({
      followup_max: 1,
      followup_gap_hours: 24,
      min_gap_minutes: 2,
      daily_cap: 12,
      quiet_start: null,
      quiet_end: null,
      opt_out_reply: true,
      followup_playbook: true,
      followup_stop_on_convert: true,
      followup_night_guard: true,
      followup_cross_channel: false,
    });
  });

  it("an old caller that sends only the earlier keys keeps the new defaults; limits still apply", async () => {
    const r = await db.as(owner, async (q) => (await q<{ r: Record<string, unknown> }>(`select public.set_conversation_policy($1, '{"followup_max": 9, "followup_gap_hours": 0, "quiet_start": "22:00", "quiet_end": "08:00", "opt_out_reply": false}'::jsonb) as r`, [org]))[0]!.r, true);
    expect(r).toMatchObject({ followup_max: 5, followup_gap_hours: 1, quiet_start: "22:00", quiet_end: "08:00", opt_out_reply: false, followup_playbook: true, followup_cross_channel: false });
    expect(await policy()).toMatchObject({ followup_max: 5, quiet_start: "22:00", followup_night_guard: true });
  });

  it("the new settings are saved; bad times are dropped as before; only settings.manage may change them", async () => {
    const r = await db.as(owner, async (q) => (await q<{ r: Record<string, unknown> }>(`select public.set_conversation_policy($1, '{"followup_max": 3, "quiet_start": "25:00", "followup_playbook": false, "followup_stop_on_convert": false, "followup_night_guard": false, "followup_cross_channel": true}'::jsonb) as r`, [org]))[0]!.r, true);
    expect(r).toMatchObject({ followup_max: 3, quiet_start: null, followup_playbook: false, followup_stop_on_convert: false, followup_night_guard: false, followup_cross_channel: true });
    await expect(db.as(outsider, (q) => q(`select public.set_conversation_policy($1, '{"followup_cross_channel": false}'::jsonb)`, [org]))).rejects.toThrow(/forbidden/);
    expect((await policy()).followup_cross_channel).toBe(true);
  });

  it("the guard still enforces the business's own quiet hours (unchanged)", async () => {
    await db.as(owner, (q) => q(`select public.set_conversation_policy($1, '{"quiet_start": "00:00", "quiet_end": "23:59"}'::jsonb)`, [org]), true);
    const contact = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone, marketing_consent) values ($1, 'דנה', '+972501234567', true) returning id`, [org]))[0]!.id;
    const conv = (await db.q<{ id: string }>(`insert into conversations (organization_id, channel, external_id, contact_id) values ($1, 'telegram', 'tg-1', $2) returning id`, [org, contact]))[0]!.id;
    await db.q(`insert into messages (organization_id, conversation_id, direction, body) values ($1, $2, 'in', 'היי')`, [org, conv]);
    const g = (await db.q<{ r: { allowed: boolean; reason: string } }>(`select public.outbound_guard($1, 'followup', null, false) as r`, [conv]))[0]!.r;
    expect(g).toMatchObject({ allowed: false, reason: "quiet_hours" });
  });
});
