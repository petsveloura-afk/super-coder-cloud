/**
 * SUPER CODER CLOUD — background worker (Phase 1 scope).
 *
 * Long-running process for a container host (Railway, Fly.io, Render, a VM)
 * — NOT for Vercel serverless. Phase 1 runs periodic maintenance jobs only.
 * The workflow/automation engine (queues, retries, dead-letter) is Phase 3;
 * see BUILD_STATUS.md.
 *
 *   DATABASE_URL=postgres://...  node --experimental-strip-types src/index.ts
 *   WORKER_ONCE=true             run all jobs once and exit (cron-style)
 */
import pg from "pg";
import { JOBS } from "./jobs/maintenance.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[worker] DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });
const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 60 * 60 * 1000);
let stopping = false;

async function runAll() {
  for (const [name, job] of Object.entries(JOBS)) {
    const started = Date.now();
    try {
      const n = await job(pool);
      console.log(JSON.stringify({ level: "info", job: name, affected: n, ms: Date.now() - started }));
    } catch (err) {
      console.error(JSON.stringify({ level: "error", job: name, error: (err as Error).message }));
    }
  }
}

async function main() {
  await runAll();
  if (process.env.WORKER_ONCE === "true") {
    await pool.end();
    return;
  }
  const timer = setInterval(() => {
    if (!stopping) void runAll();
  }, intervalMs);
  const shutdown = async () => {
    stopping = true;
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

void main();
