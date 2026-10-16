-- Wave 4 follow-up (additive): the server may rate-limit public actions that call
-- third-party APIs on a tenant's behalf (e.g. creating a Stripe Checkout session
-- from a public invoice page). Still not callable by anon/authenticated.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.public_rate_limit(text, int, int) to service_role;
  end if;
end $$;

-- Platform admin console: list every feature flag (global + per-organization).
create or replace function public.platform_flags()
returns table (key text, organization_id uuid, organization_name text, enabled boolean, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select f.key, f.organization_id, o.name, f.enabled, f.updated_at
    from public.feature_flags f left join public.organizations o on o.id = f.organization_id
   order by f.key, o.name nulls first
   limit 1000;
end;
$$;
revoke execute on function public.platform_flags() from public, anon;
grant execute on function public.platform_flags() to authenticated;

notify pgrst, 'reload schema';
