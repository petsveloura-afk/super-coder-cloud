import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;
const migration = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations/20261108000001_fk_index_coverage.sql");

/** [index name, table] — every index added by the wave-2 migration */
const INDEXES: [string, string][] = [
  ["jobs_campaign_recipient_idx", "jobs"],
  ["team_tasks_parent_idx", "team_tasks"],
  ["team_tasks_merged_into_idx", "team_tasks"],
  ["team_approvals_task_idx", "team_approvals"],
  ["calendar_busy_connection_idx", "calendar_busy"],
  ["conversations_contact_idx", "conversations"],
  ["conversations_deal_idx", "conversations"],
  ["messages_ai_agent_idx", "messages"],
  ["jobs_automation_idx", "jobs"],
  ["jobs_webhook_idx", "jobs"],
  ["automation_runs_automation_idx", "automation_runs"],
  ["activities_deal_idx", "activities"],
  ["notes_deal_idx", "notes"],
  ["tasks_deal_idx", "tasks"],
  ["tasks_contact_idx", "tasks"],
  ["deals_contact_idx", "deals"],
  ["deals_company_idx", "deals"],
  ["appointments_contact_idx", "appointments"],
  ["appointments_type_idx", "appointments"],
  ["ai_usage_agent_idx", "ai_usage"],
  ["documents_contact_idx", "documents"],
  ["documents_deal_idx", "documents"],
  ["documents_company_idx", "documents"],
  ["tickets_contact_idx", "tickets"],
  ["files_contact_idx", "files"],
];

const Z = "00000000-0000-0000-0000-000000000000";

/** Wave 2 (real Postgres): the foreign-key columns that used to be read with a full table scan now have an index, and Postgres really uses it. */
d("foreign-key index coverage (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("every index exists on the table it was meant for", async () => {
    const rows = await db.q<{ indexname: string; tablename: string }>(`select indexname, tablename from pg_indexes where schemaname = 'public'`);
    const have = new Set(rows.map((r) => `${r.indexname}@${r.tablename}`));
    for (const [name, table] of INDEXES) expect(have.has(`${name}@${table}`), `${name} on ${table}`).toBe(true);
  });

  it("the migration can run again without error (idempotent)", async () => {
    await expect(db.client.query(readFileSync(migration, "utf8"))).resolves.toBeDefined();
  });

  it("the foreign-key check uses the new index instead of reading the whole table", async () => {
    const probes: [string, string, string[]][] = [
      ["jobs_campaign_recipient_idx", `select 1 from only public.jobs x where campaign_recipient_id = $1 for key share of x`, [Z]],
      ["team_tasks_parent_idx", `select 1 from only public.team_tasks x where parent_id = $1 for key share of x`, [Z]],
      ["team_tasks_merged_into_idx", `select 1 from only public.team_tasks x where merged_into = $1 for key share of x`, [Z]],
      ["team_approvals_task_idx", `select 1 from only public.team_approvals x where task_id = $1 for key share of x`, [Z]],
      ["calendar_busy_connection_idx", `select 1 from only public.calendar_busy x where connection_id = $1 for key share of x`, [Z]],
      ["conversations_contact_idx", `select 1 from only public.conversations x where organization_id = $1 and contact_id = $2 for key share of x`, [Z, Z]],
      ["messages_ai_agent_idx", `select 1 from only public.messages x where organization_id = $1 and ai_agent_id = $2 for key share of x`, [Z, Z]],
      ["deals_contact_idx", `select 1 from only public.deals x where organization_id = $1 and contact_id = $2 for key share of x`, [Z, Z]],
    ];
    // one session, a generic (parameterised) plan like the foreign-key trigger uses; sequential scans are disabled only to prove the index CAN serve the check on an empty table
    await db.client.query("begin");
    try {
      await db.client.query("set local plan_cache_mode = force_generic_plan");
      await db.client.query("set local enable_seqscan = off");
      let i = 0;
      for (const [index, sql, args] of probes) {
        const name = `fkprobe_${i++}`;
        const types = args.map(() => "uuid").join(",");
        await db.client.query(`prepare ${name}(${types}) as ${sql.replace(/\$(\d)/g, (_m, n) => `$${n}`)}`);
        const plan = await db.client.query<{ "QUERY PLAN": string }>(`explain (costs off) execute ${name}(${args.map((a) => `'${a}'`).join(",")})`);
        const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
        expect(text, `${index}\n${text}`).toContain(index);
      }
    } finally {
      await db.client.query("rollback");
    }
  });
});
