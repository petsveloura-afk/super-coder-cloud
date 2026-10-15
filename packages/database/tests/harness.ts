/**
 * Throwaway-database harness for RLS / tenant-isolation tests.
 *
 * Requires DATABASE_ADMIN_URL pointing at a Postgres 15+ server where the
 * user can CREATE DATABASE (e.g. postgres://postgres@localhost:54322/postgres,
 * the Supabase CLI local DB, or a CI service container).
 * If unset, the suite is skipped — and reported as skipped, never as passed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
export const dbAvailable = Boolean(ADMIN_URL);

export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  if (!ADMIN_URL) throw new Error("DATABASE_ADMIN_URL not set");
  const name = `scc_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  const url = u.toString();

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`alter database ${name} set search_path = public, extensions`);
  await c.end();

  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  await setup.query(readFileSync(path.join(repoRoot, "supabase/tests/supabase_stub.sql"), "utf8"));
  const migDir = path.join(repoRoot, "supabase/migrations");
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    await setup.query(readFileSync(path.join(migDir, f), "utf8"));
  }
  await setup.end();

  return {
    url,
    drop: async () => {
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/** Superuser connection (acts like the Supabase service role / migrations). */
export class Db {
  constructor(public readonly client: pg.Client) {}

  static async connect(url: string): Promise<Db> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return new Db(client);
  }

  async createUser(email: string, fullName = "Test User"): Promise<string> {
    const r = await this.client.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
      [email, fullName],
    );
    return r.rows[0]!.id;
  }

  /**
   * Run `fn` inside a transaction as role `authenticated` with JWT sub = uid
   * (or as `anon` when uid is null) — exactly how PostgREST executes requests.
   * Always rolls back unless `commit` is true.
   */
  async as<T>(uid: string | null, fn: (q: Db["q"]) => Promise<T>, commit = false): Promise<T> {
    await this.client.query("begin");
    try {
      await this.client.query(`set local role ${uid ? "authenticated" : "anon"}`);
      await this.client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" }),
      ]);
      const result = await fn(this.q);
      await this.client.query(commit ? "commit" : "rollback");
      return result;
    } catch (e) {
      await this.client.query("rollback");
      throw e;
    }
  }

  q = async <R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    (await this.client.query<R>(sql, params)).rows;

  async end() {
    await this.client.end();
  }
}
