#!/usr/bin/env node
// Validates environment configuration WITHOUT printing any secret values.
// Usage: pnpm check:env            (reads apps/web/.env.local, then process.env)
//        pnpm check:env --prod     (also requires production-only variables)
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prod = process.argv.includes("--prod");

const env = {};
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
Object.assign(env, Object.fromEntries(Object.entries(process.env).filter(([k]) => /^[A-Z0-9_]+$/.test(k) && !(k in env))));

const errors = [];
const warnings = [];
const isUrl = (v) => {
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
};

const required = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
for (const k of required) if (!env[k]) errors.push(`${k} is required`);
for (const k of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]) if (env[k] && !isUrl(env[k])) errors.push(`${k} must be a valid URL`);
if (env.ENCRYPTION_KEY && !/^[A-Fa-f0-9]{64}$/.test(env.ENCRYPTION_KEY)) errors.push("ENCRYPTION_KEY must be 64 hex chars (openssl rand -hex 32)");

for (const k of Object.keys(env)) {
  if (k.startsWith("NEXT_PUBLIC_") && /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|API_KEY)/.test(k)) {
    errors.push(`${k}: secrets must never use the NEXT_PUBLIC_ prefix (they would ship to browsers)`);
  }
}

if (prod) {
  for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "ENCRYPTION_KEY", "CRON_SECRET"]) if (!env[k]) errors.push(`${k} is required in production`);
  if (env.NEXT_PUBLIC_APP_URL && !env.NEXT_PUBLIC_APP_URL.startsWith("https://")) errors.push("NEXT_PUBLIC_APP_URL must be https in production");
} else {
  for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "ENCRYPTION_KEY"]) if (!env[k]) warnings.push(`${k} not set (needed from Phase 3 for integrations/background jobs)`);
}

const optionalGroups = {
  "AI (OpenAI)": ["OPENAI_API_KEY"],
  "AI (Anthropic)": ["ANTHROPIC_API_KEY"],
  Telegram: ["TELEGRAM_BOT_TOKEN"],
  WhatsApp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
  Email: ["EMAIL_PROVIDER_API_KEY", "EMAIL_FROM_ADDRESS"],
  SMS: ["SMS_PROVIDER_API_KEY"],
  Payments: ["PAYMENT_PROVIDER_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET"],
  Queue: ["QUEUE_PROVIDER_URL", "QUEUE_PROVIDER_TOKEN"],
};
const integrations = Object.entries(optionalGroups).map(([name, keys]) => `${keys.every((k) => env[k]) ? "✔" : "·"} ${name}`);

console.log("SUPER CODER CLOUD — environment check" + (prod ? " (production)" : ""));
for (const w of warnings) console.log(`  ! ${w}`);
for (const e of errors) console.log(`  ✖ ${e}`);
console.log("  Integrations (disabled gracefully when missing):");
for (const i of integrations) console.log(`    ${i}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s). See docs/ENVIRONMENT.md`);
  process.exit(1);
}
console.log("\n✔ Required configuration present.");
