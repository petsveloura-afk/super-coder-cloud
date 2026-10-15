-- ============================================================================
-- SUPER CODER CLOUD — 0006 Row Level Security
-- Default-deny: RLS is enabled on EVERY public table. Access is granted
-- only through has_permission(organization_id, '<perm>').
-- ============================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles --------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations ---------------------------------------------------------------
-- No INSERT policy: organizations are created only via create_organization().
create policy organizations_select on public.organizations for select to authenticated
  using (deleted_at is null and public.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_permission(id, 'org.update'))
  with check (public.has_permission(id, 'org.update'));
create policy organizations_delete on public.organizations for delete to authenticated
  using (public.has_permission(id, 'org.delete'));

-- Prevent tenants from tampering with privileged org columns.
create or replace function public.guard_org_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_platform_admin() then
    if new.plan is distinct from old.plan
       or new.parent_organization_id is distinct from old.parent_organization_id
       or new.created_by is distinct from old.created_by then
      raise exception 'protected organization column' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
create trigger organizations_guard before update on public.organizations
  for each row execute function public.guard_org_columns();

-- organization_members --------------------------------------------------------
create policy members_select on public.organization_members for select to authenticated
  using (user_id = auth.uid() or public.has_permission(organization_id, 'members.read'));
create policy members_insert on public.organization_members for insert to authenticated
  with check (public.has_permission(organization_id, 'members.manage'));
create policy members_update on public.organization_members for update to authenticated
  using (public.has_permission(organization_id, 'members.manage'))
  with check (public.has_permission(organization_id, 'members.manage'));
create policy members_delete on public.organization_members for delete to authenticated
  using (user_id = auth.uid() or public.has_permission(organization_id, 'members.manage'));

-- RBAC catalogue: readable by any signed-in user, writable by nobody (service role only).
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy roles_select on public.roles for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- platform_admins: a user may only see their own row.
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- invitations -----------------------------------------------------------------
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_permission(organization_id, 'members.invite'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (invited_by = auth.uid() and public.can_assign_role(organization_id, role));
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.has_permission(organization_id, 'members.invite'));

-- CRM tables: generic read/write/delete policies -------------------------------
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('contacts',        'contacts.read',  'contacts.write',  'contacts.delete'),
      ('companies',       'companies.read', 'companies.write', 'companies.delete'),
      ('deals',           'deals.read',     'deals.write',     'deals.delete'),
      ('pipelines',       'deals.read',     'settings.manage', 'settings.manage'),
      ('pipeline_stages', 'deals.read',     'settings.manage', 'settings.manage'),
      ('tasks',           'tasks.read',     'tasks.write',     'tasks.write'),
      ('notes',           'contacts.read',  'contacts.write',  'contacts.delete'),
      ('activities',      'contacts.read',  'contacts.write',  'settings.manage'),
      ('tags',            'contacts.read',  'contacts.write',  'contacts.delete'),
      ('contact_tags',    'contacts.read',  'contacts.write',  'contacts.write'),
      ('custom_fields',   'contacts.read',  'settings.manage', 'settings.manage'),
      ('files',           'contacts.read',  'contacts.write',  'contacts.delete'),
      ('integrations',    'settings.manage','integrations.manage','integrations.manage'),
      ('api_keys',        'settings.manage','settings.manage', 'settings.manage')
    ) as v(tbl, r, w, d)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_permission(organization_id, %L))',
      spec.tbl || '_select', spec.tbl, spec.r);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(organization_id, %L))',
      spec.tbl || '_insert', spec.tbl, spec.w);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(organization_id, %L)) with check (public.has_permission(organization_id, %L))',
      spec.tbl || '_update', spec.tbl, spec.w, spec.w);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(organization_id, %L))',
      spec.tbl || '_delete', spec.tbl, spec.d);
  end loop;
end $$;

-- audit_logs: readable with audit.read; no client inserts (triggers/RPCs only).
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id is not null and public.has_permission(organization_id, 'audit.read'));

-- notifications: strictly per user, scoped to orgs they belong to.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- feature_flags: members read their org flags + global flags; writes service role only.
create policy feature_flags_select on public.feature_flags for select to authenticated
  using (organization_id is null or public.is_org_member(organization_id));

-- integration_credentials: intentionally NO policy for authenticated/anon → deny all.

-- ---------------------------------------------------------------------------
-- Grants. anon gets nothing on tenant tables. authenticated gets table
-- privileges, but RLS above decides which rows are visible.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on public.integration_credentials from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.integration_credentials from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.permissions, public.roles, public.role_permissions, public.platform_admins, public.feature_flags from authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_organization(text, text, text, text, text),
  public.accept_invitation(text),
  public.has_permission(uuid, text),
  public.is_org_member(uuid),
  public.current_role_in(uuid),
  public.is_platform_admin(),
  public.shares_org_with(uuid),
  public.can_assign_role(uuid, public.org_role),
  public.dashboard_kpis(uuid, timestamptz),
  public.contacts_daily(uuid, int)
to authenticated;
