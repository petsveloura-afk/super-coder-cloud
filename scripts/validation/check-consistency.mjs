#!/usr/bin/env node
// Guards that need no install (plain Node): catches drift between UI, server, dictionaries and docs.
//   1) API-key scopes in the UI == scopes the server accepts
//   2) every inbox channel has an icon, a label (3 languages) and is allowed by the DB check constraint
//   3) i18n dictionaries have identical key sets
//   4) every env var read by the code is documented in .env.example
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(join(root, p), "utf8");
const errors = [];
const fail = (m) => errors.push(m);

const list = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
};

// 1) scopes
const apiScopes = list(read("apps/web/lib/public-api.ts"), "API_SCOPES");
const uiScopes = list(read("apps/web/components/integrations/developer.tsx"), "SCOPES");
for (const s of apiScopes) if (!uiScopes.includes(s)) fail(`scope "${s}" is accepted by the server but missing from the API-key form`);
for (const s of uiScopes) if (!apiScopes.includes(s)) fail(`scope "${s}" is offered in the UI but unknown to the server`);

// 2) channels
const inboxChannels = list(read("apps/web/lib/inbox/sla.ts"), "INBOX_CHANNELS");
const page = read("apps/web/app/[locale]/(dashboard)/inbox/page.tsx");
const iconMap = (page.match(/const CHANNEL_ICON = \{([^}]*)\}/) ?? [, ""])[1];
const dicts = Object.fromEntries(["he", "en", "ar"].map((l) => [l, JSON.parse(read(`apps/web/lib/i18n/dictionaries/${l}.json`))]));
const migrations = readdirSync(join(root, "supabase/migrations")).sort().map((f) => read(`supabase/migrations/${f}`)).join("\n");
const checks = [...migrations.matchAll(/add constraint conversations_channel_check\s+check \(channel in \(([^)]*)\)\)/g)];
const lastCheck = checks.length ? [...checks.at(-1)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
for (const ch of inboxChannels) {
  if (!new RegExp(`\\b${ch}\\s*:`).test(iconMap)) fail(`inbox channel "${ch}" has no icon in CHANNEL_ICON`);
  for (const l of Object.keys(dicts)) {
    if (!dicts[l]?.campaigns?.channels?.[ch]) fail(`campaigns.channels.${ch} missing in ${l}.json`);
    if (!dicts[l]?.timeline?.channels?.[ch]) fail(`timeline.channels.${ch} missing in ${l}.json`);
  }
  if (lastCheck.length && !lastCheck.includes(ch)) fail(`channel "${ch}" is not allowed by the latest conversations.channel DB check`);
}
for (const c of ["voice"]) if (!inboxChannels.includes(c)) fail(`channel "${c}" is created by the server but not shown in the inbox`);

// 3) i18n parity
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const base = new Set(flat(dicts.he));
for (const l of ["en", "ar"]) {
  const k = new Set(flat(dicts[l]));
  for (const x of base) if (!k.has(x)) fail(`${l}.json is missing key ${x}`);
  for (const x of k) if (!base.has(x)) fail(`${l}.json has extra key ${x}`);
}

// 4) env documentation
const SKIP = new Set(["NODE_ENV", "CI", "PORT", "VERCEL", "VERCEL_ENV", "NEXT_RUNTIME", "NEXT_PHASE", "VERCEL_URL", "VERCEL_GIT_COMMIT_SHA", "VERCEL_REGION", "VERCEL_PROJECT_PRODUCTION_URL", "TZ", "PW_CHROMIUM_ARGS", "PW_CHROMIUM_PATH", "SCC_ANSWERS", "SCC_SKIP_DEPLOY", "PLAYWRIGHT_TEST_BASE_URL"]);
const used = new Set();
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "tests", "dist"].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(f)) for (const m of readFileSync(p, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
  }
};
for (const d of ["apps", "packages", "services", "scripts"]) walk(join(root, d));
const documented = new Set([...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
// override lines such as "# A= B= C=" list several names
for (const m of read(".env.example").matchAll(/\b([A-Z][A-Z0-9_]+)=/g)) documented.add(m[1]);
for (const v of used) if (!SKIP.has(v) && !documented.has(v)) fail(`env var ${v} is read by the code but not listed in .env.example`);

if (errors.length) {
  console.error(`✗ consistency check failed (${errors.length})\n` + errors.map((e) => " - " + e).join("\n"));
  process.exit(1);
}
console.log(`✓ consistency OK — ${apiScopes.length} scopes, ${inboxChannels.length} channels, ${base.size} i18n keys × 3 languages, ${used.size} env vars`);
