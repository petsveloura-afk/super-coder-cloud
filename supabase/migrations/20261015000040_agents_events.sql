-- Platform upgrade (wave 19) — events raised by the AI agents (for automations + REST hooks).
-- Only the agents' own event types; at most once per entity per day.
create or replace function public.agent_emit(p_org uuid, p_type text, p_entity_type text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_type not in ('deal.stuck', 'invoice.overdue') then raise exception 'invalid_event' using errcode = '22023'; end if;
  if exists (select 1 from public.events e where e.organization_id = p_org and e.type = p_type and e.entity_id = p_entity_id and e.created_at > now() - interval '1 day') then
    return false;
  end if;
  perform public.emit_event(p_org, p_type, left(coalesce(p_entity_type, 'deal'), 40), p_entity_id, case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end);
  return true;
end;
$fn$;
revoke all on function public.agent_emit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.agent_emit(uuid, text, text, uuid, jsonb) to service_role';
  end if;
end $$;
