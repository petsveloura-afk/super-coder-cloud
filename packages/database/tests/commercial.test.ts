import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

d("commercial layer: plans, limits, AI credits, billing (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let sales: string;
  let viewer: string;
  let stranger: string;
  let admin: string;
  let org: string;

  const denied = async (uid: string | null, sql: string, params: unknown[] = [], match?: RegExp) => {
    const p = db.as(uid, (q) => q(sql, params));
    if (match) await expect(p).rejects.toThrow(match);
    else await expect(p).rejects.toThrow();
  };

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@c.test");
    sales = await db.createUser("sales@c.test");
    viewer = await db.createUser("viewer@c.test");
    stranger = await db.createUser("stranger@c.test");
    admin = await db.createUser("admin@platform.test");
    await db.q(`insert into platform_admins (user_id) values ($1)`, [admin]);
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Comm Org', 'comm-org') as id`))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("seeds the plan catalogue, readable even anonymously; new orgs start on free", async () => {
    const plans = await db.as(null, (q) => q<{ key: string }>(`select key from plans order by sort`));
    expect(plans.map((p) => p.key)).toEqual(["free", "pro", "business", "enterprise"]);
    const o = await db.q(`select plan from organizations where id = $1`, [org]);
    expect(o[0]?.plan).toBe("free");
  });

  it("ping() works for anonymous keep-alive probes", async () => {
    const r = await db.as(null, (q) => q(`select public.ping() as ok`));
    expect(r[0]?.ok).toBe(true);
  });

  it("org_entitlements returns limits + usage for members only", async () => {
    const e = await db.as(owner, (q) => q(`select * from org_entitlements($1)`, [org]));
    expect(e[0]?.plan_key).toBe("free");
    expect(Number(e[0]?.limits.contacts)).toBe(250);
    expect(Number(e[0]?.members_used)).toBe(1);
    await denied(stranger, `select * from org_entitlements($1)`, [org], /forbidden/);
  });

  it("free plan: member limit counts pending invitations, enforced in the DB", async () => {
    await db.as(owner, (q) =>
      q(`insert into invitations (organization_id, email, role, token_hash, invited_by) values ($1, 'a@x.io', 'sales', repeat('1', 64), $2)`, [org, owner]), true);
    await denied(
      owner,
      `insert into invitations (organization_id, email, role, token_hash, invited_by) values ($1, 'b@x.io', 'sales', repeat('2', 64), $2)`,
      [org, owner],
      /plan_limit:members/,
    );
    await db.q(`delete from invitations where organization_id = $1`, [org]);
  });

  it("free plan: contact limit (250) is enforced on insert", async () => {
    await db.q(
      `insert into contacts (organization_id, first_name, email)
       select $1, 'C' || g, 'c' || g || '@x.io' from generate_series(1, 250) g`,
      [org],
    );
    await denied(owner, `insert into contacts (organization_id, first_name, email) values ($1, 'Over', 'over@x.io')`, [org], /plan_limit:contacts/);
    await db.q(`delete from contacts where organization_id = $1`, [org]);
  });

  it("tenants cannot set their own plan; apply_subscription is not callable by users", async () => {
    await denied(owner, `update organizations set plan = 'business' where id = $1`, [org], /protected organization column/);
    await denied(owner, `select public.apply_subscription($1, 'business', 'active', 'stripe')`, [org], /permission denied/);
    await denied(owner, `select public.admin_set_plan($1, 'business')`, [org], /forbidden/);
  });

  it("server-side (service role) subscription sync upgrades and downgrades the org", async () => {
    await db.q(`select public.apply_subscription($1, 'pro', 'active', 'stripe', 'cus_1', 'sub_1', 'month', now() + interval '30 days', false)`, [org]);
    expect((await db.q(`select plan from organizations where id = $1`, [org]))[0]?.plan).toBe("pro");
    const sub = await db.as(owner, (q) => q(`select plan_key, status from subscriptions where organization_id = $1`, [org]));
    expect(sub[0]).toMatchObject({ plan_key: "pro", status: "active" });
    await db.q(`select public.apply_subscription($1, 'pro', 'canceled', 'stripe')`, [org]);
    expect((await db.q(`select plan from organizations where id = $1`, [org]))[0]?.plan).toBe("free");
    const audit = await db.q(`select count(*)::int as c from audit_logs where organization_id = $1 and action = 'billing.plan_changed'`, [org]);
    expect(audit[0]?.c).toBe(2);
  });

  it("platform admins can assign a plan manually (e.g. paid by bank transfer)", async () => {
    await db.as(admin, (q) => q(`select public.admin_set_plan($1, 'business')`, [org]), true);
    expect((await db.q(`select plan from organizations where id = $1`, [org]))[0]?.plan).toBe("business");
    const sub = await db.q(`select provider from subscriptions where organization_id = $1`, [org]);
    expect(sub[0]?.provider).toBe("manual");
  });

  it("subscriptions are visible to members only; billing events and rate limits to nobody", async () => {
    const other = await db.as(stranger, (q) => q(`select * from subscriptions where organization_id = $1`, [org]));
    expect(other).toEqual([]);
    await denied(owner, `select * from billing_events`);
    await denied(owner, `select * from rate_limits`);
  });

  it("AI agents: only ai.manage can create; ai.use can read", async () => {
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'sales'), ($1, $3, 'read_only')`, [org, sales, viewer]);
    await db.as(owner, (q) => q(`insert into ai_agents (organization_id, name, provider, model) values ($1, 'Lead bot', 'openai', 'gpt-4o-mini')`, [org]), true);
    await denied(sales, `insert into ai_agents (organization_id, name, provider, model) values ($1, 'X', 'openai', 'gpt-4o-mini')`, [org]);
    const seen = await db.as(sales, (q) => q(`select name from ai_agents`));
    expect(seen.map((r) => r.name)).toEqual(["Lead bot"]);
    const notSeen = await db.as(viewer, (q) => q(`select name from ai_agents`));
    expect(notSeen).toEqual([]);
    await denied(owner, `insert into ai_agents (organization_id, name, provider, model) values ($1, 'Bad', 'openai', 'gpt 4; drop')`, [org]);
  });

  it("AI credits: permission, metering, finalize-by-owner-only, monthly cap", async () => {
    await denied(viewer, `select public.reserve_ai_credits($1, 'contact_summary')`, [org], /forbidden/);
    const r = await db.as(sales, (q) => q<{ id: string }>(`select public.reserve_ai_credits($1, 'contact_summary') as id`, [org]), true);
    const usageId = r[0]!.id;
    // another user cannot finalize someone else's reservation
    await db.as(owner, (q) => q(`select public.finalize_ai_usage($1, 'openai', 'gpt-4o-mini', 5000, 5000, true)`, [usageId]), true);
    expect((await db.q(`select status from ai_usage where id = $1`, [usageId]))[0]?.status).toBe("pending");
    await db.as(sales, (q) => q(`select public.finalize_ai_usage($1, 'openai', 'gpt-4o-mini', 1500, 600, true)`, [usageId]), true);
    const row = await db.q(`select status, credits from ai_usage where id = $1`, [usageId]);
    expect(row[0]).toMatchObject({ status: "ok", credits: 3 });
    // sales lacks billing.read → cannot see usage rows
    expect(await db.as(sales, (q) => q(`select id from ai_usage`))).toEqual([]);
    // cap: put the org back on free (50 credits) and exhaust it
    await db.q(`update organizations set plan = 'free' where id = $1`, [org]);
    await db.q(`insert into ai_usage (organization_id, user_id, feature, credits, status) values ($1, $2, 'agent_chat', 47, 'ok')`, [org, owner]);
    await denied(sales, `select public.reserve_ai_credits($1, 'agent_chat')`, [org], /plan_limit:ai_credits/);
  });

  it("AI calls are blocked in demo workspaces", async () => {
    await db.q(`update organizations set is_demo = true, plan = 'business' where id = $1`, [org]);
    await denied(owner, `select public.reserve_ai_credits($1, 'agent_chat')`, [org], /demo_mode/);
    await db.q(`update organizations set is_demo = false where id = $1`, [org]);
  });

  it("rate limiting allows N calls per window, then refuses", async () => {
    const results = await db.as(owner, async (q) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) out.push((await q<{ ok: boolean }>(`select public.check_rate_limit('test', 3, 60) as ok`))[0]!.ok);
      return out;
    }, true);
    expect(results).toEqual([true, true, true, false]);
    await denied(null, `select public.check_rate_limit('test', 3, 60)`);
  });
});
