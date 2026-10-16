import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0022: persistent AI conversations, agent tools, metered site/image features, plan features. */
d("AI studio: conversations, tools, features (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let analyst: string;
  let outsider: string;
  let org: string;
  let other: string;
  let agent: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@ai.test", "AI Owner");
    analyst = await db.createUser("analyst@ai.test");
    outsider = await db.createUser("out@ai.test");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('AI Org', 'ai-org') as id`))[0]!.id, true);
    other = await db.as(outsider, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'other-org') as id`))[0]!.id, true);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'analyst')`, [org, analyst]);
    agent = (await db.q<{ id: string }>(`insert into ai_agents (organization_id, name, model, allowed_tools) values ($1, 'Agent', 'gemini-flash-latest', array['crm_lookup','draft_message','site_builder','image_gen']) returning id`, [org]))[0]!.id;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("members with ai.use keep conversations; the title comes from the first user message; other orgs see nothing", async () => {
    const conv = await db.as(
      owner,
      async (q) => {
        const c = (await q<{ id: string }>(`insert into ai_conversations (organization_id, agent_id, created_by) values ($1, $2, $3) returning id`, [org, agent, owner]))[0]!.id;
        await q(`insert into ai_messages (organization_id, conversation_id, role, content) values ($1, $2, 'user', '  בנה לי   דף נחיתה  '), ($1, $2, 'assistant', 'בשמחה')`, [org, c]);
        return c;
      },
      true,
    );
    const row = (await db.q<{ title: string }>(`select title from ai_conversations where id = $1`, [conv]))[0]!;
    expect(row.title).toBe("בנה לי דף נחיתה");
    expect(await db.as(owner, (q) => q(`select id from ai_messages where conversation_id = $1`, [conv]))).toHaveLength(2);
    expect(await db.as(outsider, (q) => q(`select id from ai_conversations where id = $1`, [conv]))).toHaveLength(0);
    expect(await db.as(outsider, (q) => q(`select id from ai_messages where conversation_id = $1`, [conv]))).toHaveLength(0);
    // cannot write into another org's conversation
    await expect(db.as(outsider, (q) => q(`insert into ai_messages (organization_id, conversation_id, role, content) values ($1, $2, 'user', 'x')`, [org, conv]))).rejects.toThrow();
    // deleting the conversation removes its messages
    await db.as(owner, (q) => q(`delete from ai_conversations where id = $1`, [conv]), true);
    expect(await db.q(`select 1 from ai_messages where conversation_id = $1`, [conv])).toHaveLength(0);
  });

  it("cannot create a conversation on someone else's behalf", async () => {
    await expect(db.as(owner, (q) => q(`insert into ai_conversations (organization_id, agent_id, created_by) values ($1, $2, $3)`, [org, agent, analyst]))).rejects.toThrow();
  });

  it("allows the new agent tools and rejects unknown ones", async () => {
    await expect(db.q(`update ai_agents set allowed_tools = array['hack'] where id = $1`, [agent])).rejects.toThrow();
    await db.q(`update ai_agents set allowed_tools = array['site_builder','image_gen'] where id = $1`, [agent]);
  });

  it("meters site_builder and image_gen like other AI features", async () => {
    const usage = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.reserve_ai_credits($1, 'site_builder', $2) as id`, [org, agent]))[0]!.id, true);
    expect(usage).toBeTruthy();
    await db.as(owner, (q) => q(`select public.finalize_ai_usage($1, 'gemini', 'gemini-flash-latest', 1500, 900, true)`, [usage]), true);
    expect((await db.q<{ credits: number; feature: string }>(`select credits, feature from ai_usage where id = $1`, [usage]))[0]).toEqual({ credits: 3, feature: "site_builder" });
    await db.as(owner, (q) => q(`select public.reserve_ai_credits($1, 'image_gen', null)`, [org]), true);
    await expect(db.as(owner, (q) => q(`select public.reserve_ai_credits($1, 'mining', null)`, [org]))).rejects.toThrow();
  });

  it("plans: landing pages everywhere; full sites + AI images only on paid plans", async () => {
    const rows = await db.q<{ key: string; features: string[] }>(`select key, features from plans order by sort`);
    for (const r of rows) expect(r.features).toContain("ai_site_landing");
    expect(rows.find((r) => r.key === "free")!.features).not.toContain("ai_site_full");
    expect(rows.find((r) => r.key === "free")!.features).not.toContain("ai_images");
    for (const k of ["pro", "business", "enterprise"]) {
      expect(rows.find((r) => r.key === k)!.features).toEqual(expect.arrayContaining(["ai_site_full", "ai_images"]));
    }
    const ent = await db.as(owner, (q) => q<{ features: string[] }>(`select features from public.org_entitlements($1)`, [org]));
    expect(ent[0]!.features).toContain("ai_site_landing");
    expect(other).toBeTruthy();
  });
});
