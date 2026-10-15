import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { ORG_ROLES, ROLE_PERMISSIONS } from "@scc/shared/permissions";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

d("tenant isolation & RLS (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let alice: string; // owner of org A
  let bob: string; // owner of org B
  let rita: string; // read_only in org A
  let mark: string; // manager in org A
  let orgA: string;
  let orgB: string;
  let contactA: string;
  let contactB: string;

  const denied = async (uid: string | null, sql: string, params: unknown[] = []) => {
    await expect(db.as(uid, (q) => q(sql, params))).rejects.toThrow();
  };

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    alice = await db.createUser("alice@a.test", "Alice");
    bob = await db.createUser("bob@b.test", "Bob");
    rita = await db.createUser("rita@a.test", "Rita");
    mark = await db.createUser("mark@a.test", "Mark");

    orgA = await db.as(alice, async (q) => (await q<{ id: string }>(`select public.create_organization('Org A', 'org-a') as id`))[0]!.id, true);
    orgB = await db.as(bob, async (q) => (await q<{ id: string }>(`select public.create_organization('Org B', 'org-b') as id`))[0]!.id, true);

    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'read_only'), ($1, $3, 'manager')`, [orgA, rita, mark]);

    contactA = await db.as(alice, async (q) =>
      (await q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Dana', 'dana@x.test') returning id`, [orgA]))[0]!.id, true);
    contactB = await db.as(bob, async (q) =>
      (await q<{ id: string }>(`insert into contacts (organization_id, first_name, email) values ($1, 'Eli', 'eli@x.test') returning id`, [orgB]))[0]!.id, true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("SQL role_permissions matches the TypeScript matrix exactly", async () => {
    const rows = await db.q<{ role: string; permission: string }>(`select role::text, permission from role_permissions`);
    const sql = new Set(rows.map((r) => `${r.role}:${r.permission}`));
    const ts = new Set(ORG_ROLES.flatMap((r) => ROLE_PERMISSIONS[r].map((p) => `${r}:${p}`)));
    expect([...sql].sort()).toEqual([...ts].sort());
  });

  it("RLS is enabled on every public table", async () => {
    const rows = await db.q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("create_organization makes caller owner and seeds a default pipeline", async () => {
    const m = await db.q(`select role::text from organization_members where organization_id = $1 and user_id = $2`, [orgA, alice]);
    expect(m[0]?.role).toBe("owner");
    const stages = await db.q(`select s.name from pipeline_stages s join pipelines p on p.id = s.pipeline_id where p.organization_id = $1`, [orgA]);
    expect(stages.length).toBe(4);
  });

  it("anonymous users see nothing", async () => {
    await denied(null, `select * from contacts`);
    await denied(null, `select * from organizations`);
  });

  it("users only see their own organizations and contacts", async () => {
    const orgs = await db.as(bob, (q) => q(`select id from organizations`));
    expect(orgs.map((o) => o.id)).toEqual([orgB]);
    const contacts = await db.as(bob, (q) => q(`select id from contacts`));
    expect(contacts.map((c) => c.id)).toEqual([contactB]);
  });

  it("direct-id access (IDOR) to another tenant's contact returns nothing", async () => {
    const rows = await db.as(bob, (q) => q(`select * from contacts where id = $1`, [contactA]));
    expect(rows).toEqual([]);
    const upd = await db.as(bob, (q) => q(`update contacts set first_name = 'pwned' where id = $1 returning id`, [contactA]));
    expect(upd).toEqual([]);
    const del = await db.as(bob, (q) => q(`delete from contacts where id = $1 returning id`, [contactA]));
    expect(del).toEqual([]);
  });

  it("cannot insert rows into another tenant", async () => {
    await denied(bob, `insert into contacts (organization_id, first_name, email) values ($1, 'X', 'x@x.test')`, [orgA]);
  });

  it("cannot move a row to another tenant via update", async () => {
    await denied(alice, `update contacts set organization_id = $1 where id = $2`, [orgB, contactA]);
  });

  it("composite FKs block cross-tenant references even with known ids", async () => {
    // Bob owns org B and tries to attach a deal to Alice's contact.
    await denied(
      bob,
      `insert into deals (organization_id, pipeline_id, stage_id, contact_id, title)
       select $1, p.id, s.id, $2, 'steal' from pipelines p join pipeline_stages s on s.pipeline_id = p.id
       where p.organization_id = $1 limit 1`,
      [orgB, contactA],
    );
  });

  it("read_only members can read but not write", async () => {
    const rows = await db.as(rita, (q) => q(`select id from contacts`));
    expect(rows.length).toBe(1);
    await denied(rita, `insert into contacts (organization_id, first_name, email) values ($1, 'R', 'r@x.test')`, [orgA]);
    const upd = await db.as(rita, (q) => q(`update contacts set first_name = 'Z' where id = $1 returning id`, [contactA]));
    expect(upd).toEqual([]);
  });

  it("members cannot escalate privileges", async () => {
    // Without members.manage the UPDATE matches zero rows (RLS-filtered) — nothing changes.
    const self = await db.as(mark, (q) =>
      q(`update organization_members set role = 'admin' where organization_id = $1 and user_id = $2 returning role`, [orgA, mark]));
    expect(self).toEqual([]);
    const other = await db.as(mark, (q) =>
      q(`update organization_members set role = 'owner' where organization_id = $1 and user_id = $2 returning role`, [orgA, rita]));
    expect(other).toEqual([]);
    const roles = await db.q(`select role::text from organization_members where user_id in ($1, $2) order by role`, [mark, rita]);
    expect(roles.map((r) => r.role)).toEqual(["manager", "read_only"]);
    // An admin (has members.manage) still cannot grant owner, nor change own role.
    const adam = await db.createUser("adam@a.test");
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'admin')`, [orgA, adam]);
    await denied(adam, `update organization_members set role = 'owner' where organization_id = $1 and user_id = $2`, [orgA, rita]);
    await denied(adam, `update organization_members set role = 'read_only' where organization_id = $1 and user_id = $2`, [orgA, alice]);
    // Manager has no members.manage → cannot even insert members
    await denied(mark, `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [orgA, bob]);
  });

  it("the last owner cannot leave or be demoted", async () => {
    await denied(alice, `delete from organization_members where organization_id = $1 and user_id = $2`, [orgA, alice]);
  });

  it("tenants cannot change their plan (billing-protected column)", async () => {
    await denied(alice, `update organizations set plan = 'enterprise' where id = $1`, [orgA]);
  });

  it("integration credentials are never readable by tenants, even owners", async () => {
    await denied(alice, `select * from integration_credentials`);
  });

  it("audit log is written, append-only, and permission-gated", async () => {
    const logs = await db.as(alice, (q) => q(`select action from audit_logs where organization_id = $1`, [orgA]));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["organization.created", "contacts.insert"]));
    await denied(alice, `delete from audit_logs where organization_id = $1`, [orgA]);
    const asReadOnly = await db.as(rita, (q) => q(`select id from audit_logs`));
    expect(asReadOnly).toEqual([]);
  });

  it("dashboard KPIs only count authorized rows", async () => {
    const own = await db.as(alice, (q) => q(`select total_contacts from dashboard_kpis($1)`, [orgA]));
    expect(Number(own[0]?.total_contacts)).toBe(1);
    const foreign = await db.as(bob, (q) => q(`select total_contacts from dashboard_kpis($1)`, [orgA]));
    expect(Number(foreign[0]?.total_contacts)).toBe(0);
  });

  it("invitations: only the invited email can accept; tokens are stored hashed", async () => {
    const token = randomBytes(24).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    const carol = await db.createUser("carol@c.test");
    await db.as(alice, (q) =>
      q(`insert into invitations (organization_id, email, role, token_hash, invited_by) values ($1, 'carol@c.test', 'sales', $2, $3)`, [orgA, hash, alice]), true);

    await denied(bob, `select public.accept_invitation($1)`, [token]);
    const joined = await db.as(carol, (q) => q(`select public.accept_invitation($1) as org`, [token]), true);
    expect(joined[0]?.org).toBe(orgA);
    await denied(carol, `select public.accept_invitation($1)`, [token]); // single-use
    const role = await db.q(`select role::text from organization_members where organization_id = $1 and user_id = $2`, [orgA, carol]);
    expect(role[0]?.role).toBe("sales");
  });

  it("a manager cannot invite someone as owner", async () => {
    await denied(mark, `insert into invitations (organization_id, email, role, token_hash, invited_by) values ($1, 'x@x.test', 'owner', $2, $3)`, [
      orgA,
      "f".repeat(64),
      mark,
    ]);
  });

  it("demo data loads only for authorized users into an empty org, flagged as demo", async () => {
    await denied(bob, `select public.load_demo_data($1)`, [orgA]);
    await denied(alice, `select public.load_demo_data($1)`, [orgA]); // org A not empty
    const dave = await db.createUser("dave@d.test");
    const orgD = await db.as(dave, async (q) => (await q<{ id: string }>(`select public.create_organization('Demo Co', 'demo-co') as id`))[0]!.id, true);
    const n = await db.as(dave, (q) => q(`select public.load_demo_data($1) as n`, [orgD]), true);
    expect(n[0]?.n).toBe(8);
    const flags = await db.q(`select is_demo from organizations where id = $1`, [orgD]);
    expect(flags[0]?.is_demo).toBe(true);
    const nonDemo = await db.q(`select count(*)::int as c from contacts where organization_id = $1 and not is_demo`, [orgD]);
    expect(nonDemo[0]?.c).toBe(0);
  });

  it("duplicate emails per organization are rejected", async () => {
    await denied(alice, `insert into contacts (organization_id, first_name, email) values ($1, 'Dup', 'DANA@x.test')`, [orgA]);
  });
});
