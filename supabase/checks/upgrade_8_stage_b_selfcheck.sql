-- Self-check for team upgrade 8, stage B (departments, procedures, RACI, SLA, job profiles). NOT a migration: run it in the Supabase SQL Editor
-- (read-only, changes nothing). Prints one row per table / column / index / constraint / trigger / policy / RLS flag: status = OK or MISSING.
with expected_tables(name) as (values
  ('team_departments'), ('team_dept_members'), ('team_sops'), ('team_raci_roles'), ('team_raci_matrix'), ('team_dept_sla'), ('team_sla_alerts'), ('team_job_profiles')
), expected_columns(tbl, col) as (values
  ('team_departments', 'dept_key'), ('team_departments', 'head_member_id'), ('team_departments', 'credit_budget'),
  ('team_dept_members', 'member_id'), ('team_dept_members', 'dept_key'), ('team_dept_members', 'manual'),
  ('team_sops', 'sop_key'), ('team_sops', 'version'), ('team_sops', 'status'), ('team_sops', 'source'), ('team_sops', 'dept_key'), ('team_sops', 'lang'),
  ('team_sops', 'title'), ('team_sops', 'trigger_text'), ('team_sops', 'steps'), ('team_sops', 'owner_role'), ('team_sops', 'approvals'), ('team_sops', 'valid_from'), ('team_sops', 'valid_to'),
  ('team_raci_roles', 'sop_key'), ('team_raci_roles', 'r_role'), ('team_raci_roles', 'a_role'), ('team_raci_roles', 'c_roles'), ('team_raci_roles', 'i_roles'),
  ('team_raci_matrix', 'rule_id'), ('team_raci_matrix', 'enabled'), ('team_raci_matrix', 'threshold'),
  ('team_dept_sla', 'sla_id'), ('team_dept_sla', 'minutes'), ('team_dept_sla', 'enabled'),
  ('team_sla_alerts', 'alert_key'), ('team_sla_alerts', 'line'),
  ('team_job_profiles', 'member_id'), ('team_job_profiles', 'responsibilities'), ('team_job_profiles', 'authority'), ('team_job_profiles', 'forbidden_extra'), ('team_job_profiles', 'lang')
), expected_indexes(name) as (values
  ('team_departments_org'), ('team_dept_members_org'), ('team_sops_one_current'), ('team_sops_org'), ('team_raci_roles_org'), ('team_raci_matrix_org'),
  ('team_dept_sla_org'), ('team_sla_alerts_org'), ('team_job_profiles_org')
), expected_constraints(tbl, name) as (values
  ('team_departments', 'team_departments_unique'), ('team_sops', 'team_sops_version'), ('team_raci_roles', 'team_raci_roles_unique'), ('team_raci_matrix', 'team_raci_matrix_unique'),
  ('team_dept_sla', 'team_dept_sla_unique'), ('team_sla_alerts', 'team_sla_alerts_unique'), ('team_job_profiles', 'team_job_profiles_unique')
), expected_triggers(tbl, name) as (values
  ('team_sops', 'team_sops_guard')
), expected_policies(tbl, name) as (values
  ('team_departments', 'team_departments_read'), ('team_dept_members', 'team_dept_members_read'), ('team_dept_sla', 'team_dept_sla_read'), ('team_sla_alerts', 'team_sla_alerts_read'), ('team_job_profiles', 'team_job_profiles_read')
)
select 'table' as kind, name as item, case when to_regclass('public.' || name) is not null then 'OK' else 'MISSING' end as status from expected_tables
union all
select 'column', tbl || '.' || col, case when exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = tbl and c.column_name = col) then 'OK' else 'MISSING' end from expected_columns
union all
select 'index', name, case when exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = name) then 'OK' else 'MISSING' end from expected_indexes
union all
select 'constraint', tbl || '.' || name, case when exists (select 1 from pg_constraint k where k.conname = name and k.conrelid = to_regclass('public.' || tbl)) then 'OK' else 'MISSING' end from expected_constraints
union all
select 'trigger', tbl || '.' || name, case when exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname = name and t.tgrelid = to_regclass('public.' || tbl)) then 'OK' else 'MISSING' end from expected_triggers
union all
select 'policy', tbl || '.' || name, case when exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = tbl and p.policyname = name) then 'OK' else 'MISSING' end from expected_policies
union all
select 'rls', name, case when exists (select 1 from pg_class c where c.oid = to_regclass('public.' || name) and c.relrowsecurity) then 'OK' else 'MISSING' end from expected_tables
order by 1, 2;
