import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "supabase", "migrations");
const FILE = "20261108000001_fk_index_coverage.sql";
const sql = readFileSync(join(MIGRATIONS, FILE), "utf8");
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

describe("wave B2 — foreign-key index migration is additive only", () => {
  it("is newer than the last migration that existed before wave 2", () => {
    expect(FILE.slice(0, 14) > "20261107000001").toBe(true);
    expect(readdirSync(MIGRATIONS)).toContain("20261107000001_social_post_hygiene.sql");
  });

  it("contains nothing but `create index if not exists` statements", () => {
    expect(statements.length).toBeGreaterThanOrEqual(25);
    for (const s of statements) expect(s, s).toMatch(/^create index if not exists \w+ on public\.\w+ \(/);
    // comments are free text; only the statements themselves are checked
    expect(statements.join(";\n")).not.toMatch(/\b(drop|delete|truncate|alter|update|insert)\b/i);
  });

  it("has no duplicate index names and keeps every name unique against older migrations", () => {
    const names = statements.map((s) => s.match(/^create index if not exists (\w+)/)![1]!);
    expect(new Set(names).size).toBe(names.length);
    const older = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && f !== FILE)
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .join("\n");
    for (const n of names) expect(older.includes(` ${n} on `), `${n} already defined elsewhere`).toBe(false);
  });

  it("covers the five candidates reported by the previous review", () => {
    for (const col of ["jobs (campaign_recipient_id)", "team_tasks (parent_id)", "team_tasks (merged_into)", "team_approvals (task_id", "calendar_busy (connection_id)"]) {
      expect(sql, col).toContain(col);
    }
  });
});
