# Installation (local development)

## 1. Prerequisites
```bash
node -v          # 22.18 or newer (TypeScript type stripping is used by scripts/worker)
corepack enable  # provides pnpm
corepack prepare pnpm@10.28.0 --activate
docker -v        # required by the Supabase CLI
```

## 2. Extract and install
```bash
unzip super-coder-cloud-enterprise.zip
cd super-coder-cloud
pnpm install --frozen-lockfile
```

## 3. Start Supabase locally
```bash
npx supabase start
# applies supabase/migrations/* and supabase/seed.sql
npx supabase status            # shows API URL, anon key, service_role key, DB URL
```
Local Studio: http://127.0.0.1:54323 · Local mail catcher (Inbucket/Mailpit): see `supabase status`.

## 4. Configure environment
```bash
cp .env.local.example apps/web/.env.local
# paste the anon key and service_role key from `supabase status`
pnpm check:env
```

## 5. Run
```bash
pnpm dev
# open http://localhost:3000  → redirects to /he (or /en, /ar by browser language)
```
Sign up → create a workspace → optionally click **טעינת נתוני דמו** on the dashboard.

## 6. Make yourself Platform Super Admin (optional)
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v email='you@example.com' -f scripts/setup/create-platform-admin.sql
```

## 7. Tests
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm build
pnpm --filter @scc/web exec playwright install chromium
pnpm --filter @scc/web build && pnpm --filter @scc/web start &   # in another terminal
pnpm test:e2e
```

## Resetting the local database
```bash
npx supabase db reset     # drops, re-applies migrations and seed
```
