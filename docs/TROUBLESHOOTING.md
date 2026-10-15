# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every page redirects to `/he/setup` | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` missing | set them in `apps/web/.env.local` or Vercel, restart/redeploy |
| Login loops back to `/login` | cookies blocked, or `NEXT_PUBLIC_SUPABASE_URL` points at a different project than the user | check browser cookies; verify env |
| Email link says "expired or invalid" | Redirect URL not allowed in Supabase | Supabase → Auth → URL Configuration: add `https://<domain>/auth/confirm` |
| Signup shows "check your inbox" locally but no mail | local mail catcher | open the Inbucket/Mailpit URL from `supabase status`, or set `enable_confirmations = false` |
| "permission denied for table …" | migrations partially applied, or grants missing | `npx supabase db reset` locally; `npx supabase migration list` in prod |
| `create_organization` fails with slug taken | slug is globally unique | choose another identifier |
| Dashboard shows 0 everywhere | the workspace is genuinely empty (KPIs are never faked) | add contacts or load demo data |
| "Load demo data" missing | workspace not empty, or your role lacks `settings.manage` | use an empty workspace as owner/admin |
| Export CSV button missing / 403 | role lacks `contacts.export` | ask an owner/admin/manager |
| CI step "Permission matrix SQL is in sync" fails | `permissions.ts` changed without regenerating | `pnpm gen:permissions`, then add a new migration for prod |
| Worker exits: `DATABASE_URL is required` | env not set | use the Session pooler URL from Supabase → Connect |
| `next build` warns about `middleware` | Next 16 renamed it to `proxy` | this repo already uses `apps/web/proxy.ts` |
| Hebrew/Arabic show as boxes in CSV | file opened without UTF-8 | export includes a BOM; open with Excel's import if needed |
