import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0024: the agent closes the lead (contact, tags, deal, task, note, notification) and follows up. */
d("AI sales agent (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let org: string;
  let agent: string;
  let conv: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@sales.test", "Sales Owner");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Pet Line', 'pet-sales') as id`))[0]!.id, true);
    agent = (await db.q<{ id: string }>(`insert into ai_agents (organization_id, name, model, autopilot_channels, followup_hours, lead_goal, profile) values ($1, 'נועה', 'gemini-flash-latest', array['telegram','web'], 3, 'booking', '{"services":"תספורת 150"}') returning id`, [org]))[0]!.id;
    const tok = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'telegram', 'bot') returning webhook_token`, [org]))[0]!.webhook_token;
    conv = (await db.q<{ r: { conversation_id: string } }>(`select public.ingest_channel_message($1, 'telegram', '777', 'רון', null, 'כמה עולה?', '1') as r`, [tok]))[0]!.r.conversation_id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("rejects bad agent settings", async () => {
    await expect(db.q(`update ai_agents set followup_hours = 500 where id = $1`, [agent])).rejects.toThrow();
    await expect(db.q(`update ai_agents set lead_goal = 'spam' where id = $1`, [agent])).rejects.toThrow();
    await expect(db.q(`update ai_agents set profile = '[]' where id = $1`, [agent])).rejects.toThrow();
  });

  it("captures a hot lead: contact enriched + qualified, tags, deal, task, note, conversation fields, notification", async () => {
    const r = (await db.q<{ r: { ok: boolean; contact_id: string; deal_id: string; first: boolean; score: string } }>(
      `select public.ai_capture_lead($1, '{"name":"רון לוי","phone":"0541112233","need":"תספורת לכלב","budget":"150 ₪","score":"hot","summary":"רוצה תור מחר בבוקר"}') as r`,
      [conv],
    ))[0]!.r;
    expect(r).toMatchObject({ ok: true, first: true, score: "hot" });
    const c = (await db.q<{ phone: string; status: string }>(`select phone, status::text from contacts where id = $1`, [r.contact_id]))[0]!;
    expect(c).toEqual({ phone: "0541112233", status: "qualified" });
    const tags = (await db.q<{ name: string }>(`select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 order by t.name`, [r.contact_id])).map((x) => x.name);
    expect(tags).toEqual(["ai-lead", "lead-hot"]);
    const deal = (await db.q<{ title: string; value: number; contact_id: string }>(`select title, value::float8 as value, contact_id from deals where id = $1`, [r.deal_id]))[0]!;
    expect(deal).toEqual({ title: "תספורת לכלב · AI", value: 150, contact_id: r.contact_id });
    expect(await db.q(`select 1 from tasks where contact_id = $1 and title like '🔥 Follow up:%' and assignee_id = $2`, [r.contact_id, owner])).toHaveLength(1);
    expect(await db.q(`select 1 from notes where contact_id = $1 and body like '🤖 רוצה תור%'`, [r.contact_id])).toHaveLength(1);
    const cv = (await db.q<{ lead_score: string; summary: string; deal_id: string }>(`select lead_score, summary, deal_id from conversations where id = $1`, [conv]))[0]!;
    expect(cv).toEqual({ lead_score: "hot", summary: "רוצה תור מחר בבוקר", deal_id: r.deal_id });
    expect(await db.q(`select 1 from notifications where organization_id = $1 and kind = 'lead' and user_id = $2`, [org, owner])).toHaveLength(1);
  });

  it("an update re-scores without duplicating the deal, task or notification", async () => {
    const r = (await db.q<{ r: { first: boolean; deal_id: string; contact_id: string } }>(`select public.ai_capture_lead($1, '{"email":"ron@mail.com","score":"warm","summary":"עדכון"}') as r`, [conv]))[0]!.r;
    expect(r.first).toBe(false);
    expect(await db.q(`select 1 from deals where organization_id = $1`, [org])).toHaveLength(1);
    expect(await db.q(`select 1 from tasks where organization_id = $1`, [org])).toHaveLength(1);
    expect(await db.q(`select 1 from notifications where organization_id = $1 and kind = 'lead'`, [org])).toHaveLength(1);
    const tags = (await db.q<{ name: string }>(`select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 order by t.name`, [r.contact_id])).map((x) => x.name);
    expect(tags).toEqual(["ai-lead", "lead-warm"]);
    expect((await db.q<{ email: string }>(`select email::text as email from contacts where id = $1`, [r.contact_id]))[0]!.email).toBe("ron@mail.com");
    // server only
    await expect(db.as(owner, (q) => q(`select public.ai_capture_lead($1, '{}')`, [conv]))).rejects.toThrow();
  });

  it("follow-ups: only after the agent answered last and the delay passed, once", async () => {
    expect(await db.q(`select * from public.ai_followup_candidates(10)`)).toHaveLength(0); // last message is the customer's
    await db.q(`insert into messages (organization_id, conversation_id, direction, body, status, ai_agent_id) values ($1, $2, 'out', 'תספורת 150', 'sent', $3)`, [org, conv, agent]);
    await db.q(`update conversations set last_message_at = now() - interval '1 hour' where id = $1`, [conv]);
    expect(await db.q(`select * from public.ai_followup_candidates(10)`)).toHaveLength(0); // delay is 3h
    await db.q(`update conversations set last_message_at = now() - interval '4 hours' where id = $1`, [conv]);
    const c = await db.q<{ conversation_id: string; agent_id: string }>(`select * from public.ai_followup_candidates(10)`);
    expect(c).toEqual([expect.objectContaining({ conversation_id: conv, agent_id: agent })]);
    await db.q(`update conversations set followup_count = 1 where id = $1`, [conv]);
    expect(await db.q(`select * from public.ai_followup_candidates(10)`)).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`select * from public.ai_followup_candidates(10)`))).rejects.toThrow();
  });
});
