# Architecture

## Overview
```
Browser (he/ar/en, RTL/LTR, PWA)
   │  HTTPS (CSP, HSTS)
   ▼
Vercel — Next.js 16 (apps/web)
   proxy.ts            locale prefix · session refresh · route gating
   Server Components   read data AS THE USER (anon key + user JWT) → RLS applies
   Server Actions      Zod validation · assertCan(permission) · scoped writes
   Route handlers      /api/health · /api/v1/contacts/export · /auth/confirm
   │
   ▼
Supabase
   Auth (GoTrue)       sessions, email verification, OAuth
   PostgREST           every query evaluated under RLS
   Postgres            RLS + has_permission() + composite tenant FKs + audit triggers
   Storage             private bucket "org-files", paths prefixed by organization_id
   ▲
   │ DATABASE_URL (server-side only)
Worker (apps/worker) — long-running container: maintenance jobs (Phase 1),
                       workflow engine / queues (Phase 3)
```

## Authorization: three layers
1. **Postgres RLS** — final authority. Every tenant table has `organization_id`; policies call
   `public.has_permission(organization_id, '<perm>')`, a `SECURITY DEFINER` function that looks only at
   `auth.uid()`'s membership. RLS is enabled on every public table (tested).
2. **Server** — `getOrgContext()` resolves the active org (cookie is only a hint, re-validated against
   memberships); `ctx.can()` / `assertCan()` guard actions. `organization_id` is never read from forms.
3. **UI** — hides controls the role cannot use. Convenience only.

The permission matrix lives once in `packages/shared/src/permissions.ts`; migration
`20261015000003_permissions_seed.sql` is **generated** from it (`pnpm gen:permissions`) and a DB test
asserts they are identical.

## Tenant integrity
Cross-row references use composite foreign keys `(organization_id, x_id) → x(organization_id, id)`.
Even with a guessed UUID, a row cannot reference another tenant's record (tested).

## Privilege escalation guard
Trigger `guard_membership_change` rejects: assigning a role above your own, changing your own role,
modifying a member ranked above you, and removing/demoting the last owner. Organization `plan`,
`parent_organization_id`, `created_by` are protected columns.

## Localization
Route segment `[locale]` (`he` default, `ar`, `en`). `proxy.ts` adds the prefix (cookie → Accept-Language).
Root layout sets `<html lang dir>`. Dictionaries in `apps/web/lib/i18n/dictionaries/*.json`, typed keys
(`TKey`), error messages are keys resolved on render. LTR fragments (phones, emails, amounts) use `<Ltr>`
(`<bdi dir="ltr">`). Tailwind logical utilities (`ms-`, `ps-`, `start-`, `end-`) throughout.

## Data honesty
Dashboard KPIs come from `dashboard_kpis()` / `contacts_daily()` — `SECURITY INVOKER` SQL functions, so RLS
applies. No figure is invented. Demo data is explicit, flagged `is_demo`, and visible as a banner.
Unbuilt modules render a "not implemented — phase N" screen via `(dashboard)/[module]/page.tsx`.

## Why a separate worker
Vercel functions are short-lived. Anything long-running (schedules, retries, queues) runs in
`apps/worker` on a container host. Phase 1 jobs: purge expired invitations, purge old read notifications.
