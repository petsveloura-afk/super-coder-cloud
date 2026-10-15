-- ============================================================================
-- SUPER CODER CLOUD — 0009 Application audit events
-- Clients cannot INSERT into audit_logs directly. This RPC lets a member
-- record a whitelisted application event in an org they belong to.
-- ============================================================================
create or replace function public.log_event(
  p_org uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action not in ('contacts.exported', 'invitation.created', 'invitation.revoked', 'settings.updated', 'member.role_changed', 'member.removed') then
    raise exception 'action not allowed' using errcode = '22023';
  end if;
  if pg_column_size(p_metadata) > 4096 then
    raise exception 'metadata too large' using errcode = '22023';
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), p_action, left(p_entity_type, 40), p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke execute on function public.log_event(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.log_event(uuid, text, text, uuid, jsonb) to authenticated;
