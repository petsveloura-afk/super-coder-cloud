#!/usr/bin/env node
// Runs the Postgres RLS / tenant-isolation suite and worker DB tests.
// Default target: the Supabase CLI local database (`supabase start`).
// Each run creates and drops its own throwaway database.
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`Using DATABASE_ADMIN_URL=${url.replace(/:[^:@/]+@/, ":****@")}`);
const env = { ...process.env, DATABASE_ADMIN_URL: url };
let failed = false;
for (const pkg of ["@scc/database", "@scc/worker"]) {
  const r = spawnSync("pnpm", ["--filter", pkg, "test"], { stdio: "inherit", env });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
