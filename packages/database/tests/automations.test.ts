import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0016: automation engine, outbound/inbound webhooks, job queue, API keys. */
d("automations engine, webhooks, jobs, API keys (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let manager: string;
  let sales: string;
  let stranger: string;
  let org: string;
  let otherOrg: string;
  let pipeline: string;
  let stages: string[];

  const auto = async (fields: Record<string, unknown>) =>
    (
      await db.q<{ id: string; inbound_token: string }>(
        `insert into automations (organization_id, name, trigger_type, trigger_config, conditions, actions, enabled)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, coalesce($7, true)) returning id, inbound_token`,
        [
          org,
          fields.name ?? "rule",
          fields.trigger,
          JSON.stringify(fields.config ?? {}),
          JSON.stringify(fields.conditions ?? []),
          JSON.stringify(fields.actions ?? []),
          fields.enabled ?? null,
        ],
      )
    )[0]!;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@a.test", "Owner A");
    manager = await db.createUser("manager@a.test");
    sales = await db.createUser("sales@a.test");
    stranger = await db.createUser("stranger@a.test");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Auto Org', 'auto-org') as id`))[0]!.id, true);
    otherOrg = await db.as(stranger, async (q) => (await q<{ id: string }>(`select public.create_organization('Other', 'other-auto') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'business' where id = any($1)`, [[org, otherOrg]]);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'sales')`, [org, manager, sales]);
    pipeline = (await db.q<{ id: string }>(`select id from pipelines where organization_id = $1`, [org]))[0]!.id;
    stages = (await db.q<{ id: string }>(`select id from pipeline_stages where pipeline_id = $1 order by position`, [pipeline])).map((r) => r.id);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("RLS: only automations.manage can see or create automations; nobody writes events/jobs directly", async () => {
    await db.as(manager, (q) => q(`insert into automations (organization_id, name, trigger_type, actions) values ($1, 'm', 'contact.created', '[]')`, [org]));
    await expect(db.as(sales, (q) => q(`insert into automations (organization_id, name, trigger_type, actions) values ($1, 's', 'contact.created', '[]')`, [org]))).rejects.toThrow();
    await expect(db.as(stranger, (q) => q(`insert into automations (organization_id, name, trigger_type, actions) values ($1, 'x', 'contact.created', '[]')`, [org]))).rejects.toThrow();
    expect(await db.as(sales, (q) => q(`select 1 from automations where organization_id = $1`, [org]))).toHaveLength(0);
    await expect(db.as(owner, (q) => q(`insert into events (organization_id, type, entity_type) values ($1, 'x', 'x')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`insert into jobs (organization_id, kind) values ($1, 'email')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`select public.emit_event($1, 'x', 'x', null, '{}')`, [org]))).rejects.toThrow(/permission denied/);
  });

  it("contact.created → conditions → task + tag + notification + queued e-mail, with templates", async () => {
    const a = await auto({
      name: "Website lead",
      trigger: "contact.created",
      conditions: [{ field: "contact.source", op: "eq", value: "website" }],
      actions: [
        { type: "create_task", config: { title: "Call {{contact.first_name}} {{contact.last_name}}", due_in_days: 1, assignee: "owner" } },
        { type: "add_tag", config: { tag: "web-lead" } },
        { type: "notify", config: { to: "admins", text: "New lead: {{contact.first_name}}" } },
        { type: "send_email", config: { to: "contact", subject: "Hi {{contact.first_name}}", body: "Thanks from {{org.name}}" } },
      ],
    });
    const cid = await db.as(sales, async (q) =>
      (await q<{ id: string }>(`insert into contacts (organization_id, first_name, last_name, email, source, owner_id) values ($1, 'Noa', 'Levi', 'noa@a.test', 'website', $2) returning id`, [org, sales]))[0]!.id,
    true);

    const task = (await db.q<{ title: string; assignee_id: string; due_at: string }>(`select title, assignee_id, due_at from tasks where contact_id = $1`, [cid]))[0]!;
    expect(task.title).toBe("Call Noa Levi");
    expect(task.assignee_id).toBe(sales);
    expect(task.due_at).not.toBeNull();
    expect(await db.q(`select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 and t.name = 'web-lead'`, [cid])).toHaveLength(1);
    const notes = await db.q<{ user_id: string; params: { text: string } }>(`select user_id, params from notifications where organization_id = $1 and kind = 'automation'`, [org]);
    expect(notes.map((n) => n.user_id)).toEqual([owner]);
    expect(notes[0]!.params.text).toBe("New lead: Noa");
    const job = (await db.q<{ kind: string; payload: { to: string; subject: string; text: string } }>(`select kind, payload from jobs where automation_id = $1`, [a.id]))[0]!;
    expect(job.kind).toBe("email");
    expect(job.payload).toMatchObject({ to: "noa@a.test", subject: "Hi Noa", text: "Thanks from Auto Org" });
    const run = (await db.q<{ status: string; steps: unknown[] }>(`select status, steps from automation_runs where automation_id = $1`, [a.id]))[0]!;
    expect(run.status).toBe("success");
    expect(run.steps).toHaveLength(4);
    expect((await db.q<{ run_count: number }>(`select run_count from automations where id = $1`, [a.id]))[0]!.run_count).toBe(1);

    // condition not met → skipped, no side effects
    const other = await db.as(sales, async (q) => (await q<{ id: string }>(`insert into contacts (organization_id, first_name, phone, source) values ($1, 'Manual', '0501112233', 'manual') returning id`, [org]))[0]!.id, true);
    expect(await db.q(`select 1 from tasks where contact_id = $1`, [other])).toHaveLength(0);
    expect((await db.q<{ status: string }>(`select r.status from automation_runs r join events e on e.id = r.event_id where e.entity_id = $1 and r.automation_id = $2`, [other, a.id]))[0]!.status).toBe("skipped");
    await db.q(`update automations set enabled = false where id = $1`, [a.id]);
  });

  it("deal moved to a stage → contact becomes customer → chained rule tags them (nested events)", async () => {
    await auto({ trigger: "deal.stage_changed", config: { stage_id: stages[2] }, actions: [{ type: "set_contact_status", config: { status: "customer" } }] });
    await auto({ trigger: "contact.status_changed", config: { to: "customer" }, actions: [{ type: "add_tag", config: { tag: "customer" } }, { type: "add_note", config: { body: "Became a customer via {{event.type}}" } }] });
    const cid = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Chain', 'chain@a.test') returning id`, [org]))[0]!.id;
    const did = await db.as(sales, async (q) =>
      (await q<{ id: string }>(`insert into deals (organization_id, pipeline_id, stage_id, contact_id, title) values ($1, $2, $3, $4, 'd') returning id`, [org, pipeline, stages[0], cid]))[0]!.id,
    true);
    await db.as(sales, (q) => q(`update deals set stage_id = $1 where id = $2`, [stages[1], did]), true);
    expect((await db.q<{ status: string }>(`select status from contacts where id = $1`, [cid]))[0]!.status).toBe("lead");
    await db.as(sales, (q) => q(`update deals set stage_id = $1 where id = $2`, [stages[2], did]), true);
    expect((await db.q<{ status: string }>(`select status from contacts where id = $1`, [cid]))[0]!.status).toBe("customer");
    expect(await db.q(`select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 and t.name = 'customer'`, [cid])).toHaveLength(1);
    expect((await db.q<{ body: string }>(`select body from notes where contact_id = $1`, [cid]))[0]!.body).toBe("Became a customer via contact.status_changed");
  });

  it("loop guard: a rule that re-triggers itself stops at depth 3, and the save still succeeds", async () => {
    await auto({ name: "loop", trigger: "contact.tagged", actions: [{ type: "add_tag", config: { tag: "loop-{{payload.tag}}" } }] });
    const cid = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Loop', 'loop@a.test') returning id`, [org]))[0]!.id;
    await db.as(owner, (q) => q(`select public.set_contact_tags($1, $2, array['seed'])`, [org, cid]), true);
    const tags = (await db.q<{ name: string }>(`select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 order by length(t.name)`, [cid])).map((r) => r.name);
    expect(tags[0]).toBe("seed");
    expect(tags.length).toBeLessThanOrEqual(5);
    expect(Math.max(...(await db.q<{ depth: number }>(`select depth from events where entity_id = $1`, [cid])).map((r) => r.depth))).toBeLessThanOrEqual(3);
  });

  it("a failing action is logged as partial/failed and never breaks the user's change", async () => {
    const otherStage = (await db.q<{ id: string }>(`select id from pipeline_stages where organization_id = $1 limit 1`, [otherOrg]))[0]!.id;
    const a = await auto({ trigger: "deal.created", actions: [{ type: "set_deal_stage", config: { stage_id: otherStage } }, { type: "add_note", config: { body: "deal {{deal.title}} created" } }] });
    const cid = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Fail', 'fail@a.test') returning id`, [org]))[0]!.id;
    const did = await db.as(sales, async (q) =>
      (await q<{ id: string }>(`insert into deals (organization_id, pipeline_id, stage_id, contact_id, title) values ($1, $2, $3, $4, 'Safe') returning id`, [org, pipeline, stages[0], cid]))[0]!.id,
    true);
    expect((await db.q<{ stage_id: string }>(`select stage_id from deals where id = $1`, [did]))[0]!.stage_id).toBe(stages[0]);
    const run = (await db.q<{ status: string; error: string }>(`select status, error from automation_runs where automation_id = $1`, [a.id]))[0]!;
    expect(run.status).toBe("partial");
    expect(run.error).toBeTruthy();
    expect(await db.q(`select 1 from notes where deal_id = $1 and body = 'deal Safe created'`, [did])).toHaveLength(1);
    await db.q(`update automations set enabled = false where id = $1`, [a.id]);
  });

  it("outbound webhooks: subscribed events become jobs; retry with backoff, then dead-letter", async () => {
    const wh = (await db.as(owner, async (q) => (await q<{ id: string }>(`insert into webhooks (organization_id, url, events) values ($1, 'https://hooks.example.com/x', array['contact.created']) returning id`, [org]))[0]!.id, true));
    await expect(db.as(sales, (q) => q(`insert into webhooks (organization_id, url, events) values ($1, 'https://evil.example.com', array['*'])`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`insert into webhooks (organization_id, url, events) values ($1, 'http://insecure.example.com', array['*'])`, [org]))).rejects.toThrow();
    await db.q(`insert into contacts (organization_id, first_name, email) values ($1, 'Hooked', 'hooked@a.test')`, [org]);
    const job = (await db.q<{ id: number; payload: { type: string; data: { record: { email: string } } } }>(`select id, payload from jobs where webhook_id = $1`, [wh]))[0]!;
    expect(job.payload.type).toBe("contact.created");
    expect(job.payload.data.record.email).toBe("hooked@a.test");

    await db.q(`update jobs set max_attempts = 2 where id = $1`, [job.id]);
    await db.q(`set role service_role`);
    try {
      const claimed = await db.q<{ id: number; attempts: number }>(`select id, attempts from public.claim_jobs(100) where id = $1`, [job.id]);
      expect(claimed[0]!.attempts).toBe(1);
      expect((await db.q<{ s: string }>(`select public.complete_job($1, false, 500, 'boom') as s`, [job.id]))[0]!.s).toBe("queued");
      await db.q(`update jobs set run_after = now() where id = $1`, [job.id]);
      expect(await db.q(`select id from public.claim_jobs(100) where id = $1`, [job.id])).toHaveLength(1);
      expect((await db.q<{ s: string }>(`select public.complete_job($1, false, 500, 'boom again') as s`, [job.id]))[0]!.s).toBe("dead");
    } finally {
      await db.q(`reset role`);
    }
    expect((await db.q<{ failure_count: number; last_status: number }>(`select failure_count, last_status from webhooks where id = $1`, [wh]))[0]).toEqual({ failure_count: 2, last_status: 500 });
    await expect(db.as(owner, (q) => q(`select public.claim_jobs(1)`))).rejects.toThrow(/permission denied/);
  });

  it("inbound webhook creates/matches a contact and fires only its own automation", async () => {
    const a = await auto({ trigger: "webhook.inbound", actions: [{ type: "add_tag", config: { tag: "from-zapier" } }] });
    const b = await auto({ trigger: "webhook.inbound", actions: [{ type: "add_tag", config: { tag: "should-not-run" } }] });
    await db.q(`set role service_role`);
    let res: { ok: boolean; contact_id: string };
    try {
      res = (await db.q<{ r: { ok: boolean; contact_id: string } }>(`select public.ingest_inbound_webhook($1, $2::jsonb) as r`, [a.inbound_token, JSON.stringify({ name: "Zap Lead", email: "ZAP@a.test", phone: "+972 52 000 1111" })]))[0]!.r;
      const again = (await db.q<{ r: { contact_id: string } }>(`select public.ingest_inbound_webhook($1, $2::jsonb) as r`, [a.inbound_token, JSON.stringify({ phone: "0520001111x" , email: "zap@a.test" })]))[0]!.r;
      expect(again.contact_id).toBe(res.contact_id);
      await expect(db.q(`select public.ingest_inbound_webhook('nope', '{}')`)).rejects.toThrow(/not_found/);
    } finally {
      await db.q(`reset role`);
    }
    expect(res.ok).toBe(true);
    const c = (await db.q<{ first_name: string; email: string; phone: string; source: string }>(`select first_name, email::text, phone, source from contacts where id = $1`, [res.contact_id]))[0]!;
    expect(c).toEqual({ first_name: "Zap Lead", email: "zap@a.test", phone: "+972520001111", source: "webhook" });
    const tags = (await db.q<{ name: string }>(`select t.name from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1`, [res.contact_id])).map((r) => r.name);
    expect(tags).toContain("from-zapier");
    expect(tags).not.toContain("should-not-run");
    void b;
    await expect(db.as(owner, (q) => q(`select public.ingest_inbound_webhook($1, '{}')`, [a.inbound_token]))).rejects.toThrow(/permission denied/);
  });

  it("delayed actions are queued and executed later by the dispatcher", async () => {
    const a = await auto({ trigger: "contact.created", conditions: [{ field: "contact.email", op: "contains", value: "@delay.test" }], actions: [{ type: "add_note", config: { body: "1 day later", delay_minutes: 1440 } }] });
    const cid = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Later', 'x@delay.test') returning id`, [org]))[0]!.id;
    expect(await db.q(`select 1 from notes where contact_id = $1`, [cid])).toHaveLength(0);
    const job = (await db.q<{ id: number; run_after: string }>(`select id, run_after from jobs where automation_id = $1 and kind = 'action'`, [a.id]))[0]!;
    expect(new Date(job.run_after).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    await db.q(`set role service_role`);
    try {
      await db.q(`select public.run_delayed_action($1)`, [job.id]);
    } finally {
      await db.q(`reset role`);
    }
    expect((await db.q<{ body: string }>(`select body from notes where contact_id = $1`, [cid]))[0]!.body).toBe("1 day later");
  });

  it("test_automation runs the actions for managers only", async () => {
    const a = await auto({ trigger: "deal.won", actions: [{ type: "notify", config: { to: "all", text: "Test {{deal.title}}" } }] });
    const r = await db.as(manager, async (q) => (await q<{ r: { steps: { status: string }[] } }>(`select public.test_automation($1, $2) as r`, [org, a.id]))[0]!.r, true);
    expect(r.steps[0]!.status).toBe("ok");
    await expect(db.as(sales, (q) => q(`select public.test_automation($1, $2)`, [org, a.id]))).rejects.toThrow(/forbidden/);
  });

  it("API keys: lookup by hash for active keys only, service role only", async () => {
    const key = ["scc", "live", "testkey", "abcdefghijklmnopqrstuvwxyz012345"].join("_"); // fake fixture
    const hash = createHash("sha256").update(key).digest("hex");
    await db.as(owner, (q) => q(`insert into api_keys (organization_id, name, prefix, key_hash, scopes) values ($1, 'zapier', 'scc_live_testkey', $2, array['contacts.read'])`, [org, hash]), true);
    await expect(db.as(sales, (q) => q(`insert into api_keys (organization_id, name, prefix, key_hash) values ($1, 'x', 'p', $2)`, [org, "a".repeat(64)]))).rejects.toThrow();
    await db.q(`set role service_role`);
    try {
      const found = await db.q<{ organization_id: string; scopes: string[] }>(`select * from public.api_key_lookup($1)`, [hash]);
      expect(found[0]).toMatchObject({ organization_id: org, scopes: ["contacts.read"] });
      expect(await db.q(`select * from public.api_key_lookup($1)`, ["b".repeat(64)])).toHaveLength(0);
    } finally {
      await db.q(`reset role`);
    }
    await db.q(`update api_keys set revoked_at = now() where key_hash = $1`, [hash]);
    await db.q(`set role service_role`);
    try {
      expect(await db.q(`select * from public.api_key_lookup($1)`, [hash])).toHaveLength(0);
    } finally {
      await db.q(`reset role`);
    }
    await expect(db.as(owner, (q) => q(`select * from public.api_key_lookup($1)`, [hash]))).rejects.toThrow(/permission denied/);
  });
});
