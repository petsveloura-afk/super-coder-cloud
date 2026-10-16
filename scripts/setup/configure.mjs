#!/usr/bin/env node
/**
 * SUPER CODER CLOUD — one-time production configuration ("paste keys and go").
 *
 *   setup.cmd            (Windows)   or   node scripts/setup/configure.mjs
 *
 * What it does, on YOUR computer, with YOUR logins:
 *   1. asks for the keys (input is hidden; empty answer = skip that feature)
 *   2. generates CRON_SECRET / ENCRYPTION_KEY / BACKUP_PASSPHRASE automatically
 *   3. writes the server-side variables to the linked Vercel project (Production)
 *   4. writes the GitHub Actions secrets with the GitHub CLI (gh) if it is installed
 *      and logged in — otherwise prints exactly what to paste where
 *   5. redeploys to Vercel and verifies /api/health and /api/keepalive
 * Values are never written to any file in the repository and never printed,
 * except generated values you must keep (shown once, clearly marked).
 *
 * Test hooks: SCC_VERCEL_CMD / SCC_GH_CMD override the CLIs; SCC_ANSWERS (JSON)
 * pre-answers the prompts; SCC_SKIP_DEPLOY=1 skips the deploy+verify step.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isWin = process.platform === "win32";
const preset = process.env.SCC_ANSWERS ? JSON.parse(process.env.SCC_ANSWERS) : null;

const c = {
  ok: (s) => console.log(`  ✔ ${s}`),
  warn: (s) => console.log(`  ! ${s}`),
  err: (s) => console.log(`  ✖ ${s}`),
  head: (s) => console.log(`\n=== ${s} ===`),
};

function run(cmd, args, { input, quiet } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    input,
    encoding: "utf8",
    shell: isWin,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], // never wait on a hidden prompt
    timeout: 15 * 60 * 1000,
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
  });
  if (!quiet && r.status !== 0) process.stdout.write((r.stdout || "") + (r.stderr || ""));
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function cli(envName, fallback) {
  const custom = process.env[envName];
  if (custom) return { cmd: process.execPath, pre: [custom] };
  return fallback;
}
const VERCEL = cli("SCC_VERCEL_CMD", { cmd: isWin ? "npx.cmd" : "npx", pre: ["--yes", "vercel@64.2.0"] });
const GH = cli("SCC_GH_CMD", { cmd: "gh", pre: [] });
const vercel = (args, opts) => run(VERCEL.cmd, [...VERCEL.pre, ...args], opts);
const gh = (args, opts) => run(GH.cmd, [...GH.pre, ...args], opts);

function ask(question, { secret = false, key } = {}) {
  if (preset) return Promise.resolve(String(preset[key] ?? "").trim());
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (secret) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (s === "\r\n" || s === "\n") rl.output.write(s);
        else rl.output.write("*".repeat(s.length));
      };
    }
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

const hex = (n) => randomBytes(n).toString("hex");

async function main() {
  console.log("SUPER CODER CLOUD — production setup");
  console.log("Press Enter to skip any optional item. Pasted keys are hidden as ****.\n");

  // ---- Vercel project -------------------------------------------------------
  c.head("1/5 Vercel project");
  const projFile = path.join(root, ".vercel", "project.json");
  if (!existsSync(projFile)) {
    c.err("This folder is not linked to Vercel. Run:  npx vercel link   (Code directory: apps/web), then run setup again.");
    process.exit(1);
  }
  const { orgId, projectId } = JSON.parse(readFileSync(projFile, "utf8"));
  c.ok(`linked project ${projectId}`);
  const who = vercel(["whoami"], { quiet: true });
  if (!who.ok) {
    c.err("Not logged in to Vercel. Run:  npx vercel login   then run setup again.");
    process.exit(1);
  }
  c.ok(`Vercel user: ${who.out.split(/\r?\n/).filter((l) => l.trim() && !/Vercel CLI/.test(l)).pop()?.trim()}`);
  const existing = vercel(["env", "ls", "production"], { quiet: true }).out;
  const hasVar = (name) => new RegExp(`\\b${name}\\b`).test(existing);

  // ---- Keys -----------------------------------------------------------------
  c.head("2/5 Keys");
  const answers = {};
  const prompts = [
    ["SUPABASE_SERVICE_ROLE_KEY", "Supabase secret key (sb_secret_…) [Project Settings → API Keys → Secret keys] REQUIRED: ", true, (v) => /^(sb_secret_|eyJ)/.test(v)],
    ["ANTHROPIC_API_KEY", "Anthropic API key (sk-ant-…) for AI [optional]: ", true, (v) => v.startsWith("sk-ant-")],
    ["OPENAI_API_KEY", "OpenAI API key (sk-…) for AI [optional]: ", true, (v) => v.startsWith("sk-")],
    ["EMAIL_PROVIDER_API_KEY", "Resend API key (re_…) for emails [optional]: ", true, (v) => v.startsWith("re_")],
    ["EMAIL_FROM_ADDRESS", "Email sender, e.g. Super Coder <no-reply@yourdomain.com> [needed with Resend]: ", false, (v) => /@/.test(v)],
    ["VERCEL_TOKEN", "Vercel token for GitHub auto-deploy [vercel.com/account/settings/tokens] [optional]: ", true, (v) => v.length >= 20],
    ["SUPABASE_DB_URL", "Supabase Session-pooler URL with password (for GitHub migrations/backups) [optional]: ", true, (v) => v.startsWith("postgresql://")],
  ];
  for (const [key, q, secret, valid] of prompts) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const v = await ask(q, { secret, key });
      if (!v) break;
      if (valid(v)) {
        answers[key] = v;
        break;
      }
      c.warn("That doesn't look right — check and paste again (or Enter to skip).");
      if (preset) break;
    }
  }
  if (!answers.SUPABASE_SERVICE_ROLE_KEY && !hasVar("SUPABASE_SERVICE_ROLE_KEY")) {
    c.err("The Supabase secret key is required (payments webhook + daily maintenance). Run setup again with it.");
    process.exit(1);
  }
  if (answers.EMAIL_PROVIDER_API_KEY && !answers.EMAIL_FROM_ADDRESS) {
    c.warn("Resend key without a sender address — email stays disabled.");
    delete answers.EMAIL_PROVIDER_API_KEY;
  }

  const generated = {};
  generated.CRON_SECRET = hex(24); // rotated on every run, written to BOTH Vercel and GitHub
  if (!hasVar("ENCRYPTION_KEY")) generated.ENCRYPTION_KEY = hex(32); // never rotated automatically

  // ---- Vercel env -----------------------------------------------------------
  c.head("3/5 Vercel environment (Production)");
  const vercelVars = {
    SUPABASE_SERVICE_ROLE_KEY: answers.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: answers.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: answers.OPENAI_API_KEY,
    EMAIL_PROVIDER_API_KEY: answers.EMAIL_PROVIDER_API_KEY,
    EMAIL_FROM_ADDRESS: answers.EMAIL_PROVIDER_API_KEY ? answers.EMAIL_FROM_ADDRESS : undefined,
    CRON_SECRET: generated.CRON_SECRET,
    ENCRYPTION_KEY: generated.ENCRYPTION_KEY,
  };
  let vercelFailures = 0;
  for (const [name, value] of Object.entries(vercelVars)) {
    if (!value) continue;
    if (hasVar(name)) vercel(["env", "rm", name, "production", "--yes"], { quiet: true });
    const r = vercel(["env", "add", name, "production"], { input: `${value}\n`, quiet: true });
    if (r.ok) c.ok(name);
    else {
      vercelFailures++;
      c.err(`${name} — could not be saved automatically. Add it manually in Vercel → Settings → Environment Variables.`);
    }
  }

  // ---- GitHub secrets -------------------------------------------------------
  c.head("4/5 GitHub Actions secrets");
  const remote = run("git", ["remote", "get-url", "origin"], { quiet: true }).out.trim();
  const repo = remote.match(/github\.com[:/](.+?)(\.git)?$/)?.[1] ?? "petsveloura-afk/super-coder-cloud";
  const ghSecrets = {
    VERCEL_TOKEN: answers.VERCEL_TOKEN,
    VERCEL_ORG_ID: answers.VERCEL_TOKEN ? orgId : undefined,
    VERCEL_PROJECT_ID: answers.VERCEL_TOKEN ? projectId : undefined,
    CRON_SECRET: generated.CRON_SECRET,
    SUPABASE_DB_URL: answers.SUPABASE_DB_URL,
  };
  const ghReady = repo && gh(["auth", "status"], { quiet: true }).ok;
  let backupPassphrase;
  if (ghReady) {
    const list = gh(["secret", "list", "--repo", repo], { quiet: true }).out;
    if (!/\bBACKUP_PASSPHRASE\b/.test(list)) ghSecrets.BACKUP_PASSPHRASE = backupPassphrase = hex(24);
    for (const [name, value] of Object.entries(ghSecrets)) {
      if (!value) continue;
      const r = gh(["secret", "set", name, "--repo", repo], { input: value, quiet: true });
      if (r.ok) c.ok(name);
      else c.err(`${name} — failed (${r.out.trim().split(/\r?\n/).pop()})`);
    }
  } else {
    backupPassphrase = hex(24);
    ghSecrets.BACKUP_PASSPHRASE = backupPassphrase;
    c.warn("GitHub CLI (gh) not installed or not logged in — add these manually:");
    console.log(`    https://github.com/${repo ?? "<owner>/<repo>"}/settings/secrets/actions  →  New repository secret`);
    for (const [name, value] of Object.entries(ghSecrets)) if (value) console.log(`    ${name.padEnd(18)} ${value}`);
    console.log("    (Or install GitHub CLI: winget install GitHub.cli → gh auth login → run setup again.)");
  }
  if (backupPassphrase) {
    console.log("\n  *** SAVE THIS — needed to restore database backups (shown only now) ***");
    console.log(`  BACKUP_PASSPHRASE = ${backupPassphrase}\n`);
  }

  // ---- Deploy + verify ------------------------------------------------------
  c.head("5/5 Deploy and verify");
  if (process.env.SCC_SKIP_DEPLOY === "1") {
    c.warn("deploy skipped (SCC_SKIP_DEPLOY=1)");
  } else {
    const d = vercel(["deploy", "--prod", "--yes"], { quiet: true });
    const url = (d.out.match(/https:\/\/[^\s]+\.vercel\.app/g) || []).find((u) => !/-[a-z0-9]{9}-/.test(u)) || "https://super-coder-cloud.vercel.app";
    if (!d.ok) {
      c.err("deploy failed:");
      console.log(d.out.split(/\r?\n/).slice(-15).join("\n"));
      process.exit(1);
    }
    c.ok(`deployed → ${url}`);
    try {
      const h = await (await fetch(`${url}/api/health`, { cache: "no-store" })).json();
      const flag = (b) => (b ? "on" : "off");
      c.ok(`health: supabase ${flag(h.supabaseConfigured)} · server key ${flag(h.serviceRoleConfigured)} · cron ${flag(h.cronSecretConfigured)} · AI ${flag(h.integrations?.anthropic || h.integrations?.openai)} · email ${flag(h.integrations?.email)} · region ${h.region ?? "?"}`);
      const k = await fetch(`${url}/api/keepalive`, { headers: { Authorization: `Bearer ${generated.CRON_SECRET}` }, cache: "no-store" });
      const kj = await k.json();
      if (k.ok && kj.ok) c.ok(`keep-alive: database reachable (${kj.ms} ms), maintenance ${kj.maintenance}`);
      else c.err(`keep-alive: ${k.status} ${JSON.stringify(kj)}`);
    } catch (e) {
      c.warn(`could not verify automatically (${e.message}). Open ${url}/api/health in a browser.`);
    }
  }

  // ---- Manual follow-ups ----------------------------------------------------
  c.head("Remaining manual steps");
  if (answers.EMAIL_PROVIDER_API_KEY) {
    console.log("  • Signup/password emails for ALL users: Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP:");
    console.log("      Host smtp.resend.com · Port 465 · Username resend · Password = your Resend key · Sender = the address above");
    console.log("    (Resend: verify your domain first at resend.com/domains)");
  } else {
    console.log("  • Emails are off: new users on other addresses won't receive signup confirmation until SMTP is set (see docs/COMMERCIAL.md).");
  }
  if (!answers.VERCEL_TOKEN) console.log("  • GitHub auto-deploy is off (no Vercel token). Until then deploy with:  npx vercel --prod");
  if (vercelFailures) console.log(`  • ${vercelFailures} Vercel variable(s) must be added manually (see above).`);
  console.log("  • Stripe (optional): docs/COMMERCIAL.md → 'Stripe setup'.\n");
  console.log("Done.");
}

main().catch((e) => {
  c.err(e.message);
  process.exit(1);
});
