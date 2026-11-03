-- Self-check for team upgrades 7 and 8. NOT a migration: run it in the Supabase SQL Editor (read-only, changes nothing).
-- Prints one row per table / column / trigger / index / constraint expected by upgrades 7 and 8: status = OK or MISSING.
with expected_tables(name) as (values
  ('team_business_facts'), ('team_business_goals'), ('team_goal_snapshots'), ('team_decisions'), ('team_decision_feedback'),
  ('team_experiments'), ('team_board_notes'), ('team_reports'), ('team_provider_usage')
), expected_columns(tbl, col) as (values
  ('team_tasks', 'attempts'), ('team_tasks', 'merged_into'), ('team_tasks', 'fingerprint'), ('team_tasks', 'failure_kind'), ('team_tasks', 'restarts'), ('team_tasks', 'recipient_key'),
  ('team_business_goals', 'merged_into'),
  ('team_experiments', 'a_trials'), ('team_experiments', 'a_successes'), ('team_experiments', 'b_trials'), ('team_experiments', 'b_successes'),
  ('team_provider_usage', 'calls'), ('team_provider_usage', 'failures'), ('team_provider_usage', 'rest_until')
), expected_indexes(name) as (values
  ('team_business_facts_one_current'), ('team_business_facts_lookup'), ('team_business_facts_history'),
  ('team_business_goals_org'), ('team_goal_snapshots_org'), ('team_decisions_org'), ('team_decisions_task'), ('team_decision_feedback_org'), ('team_decision_feedback_decision'),
  ('team_experiments_org'), ('team_board_notes_org'), ('team_reports_org'), ('team_tasks_fingerprint'), ('team_tasks_board'), ('team_tasks_assignee')
), expected_triggers(tbl, name) as (values
  ('team_activity', 'team_activity_no_update'), ('team_business_facts', 'team_business_facts_guard'),
  ('team_decisions', 'team_decisions_no_change'), ('team_decision_feedback', 'team_decision_feedback_no_change')
), expected_constraints(tbl, name) as (values
  ('team_tasks', 'team_tasks_status_check_v8'), ('team_business_goals', 'team_business_goals_status_check_v8')
)
select 'table' as kind, name as item, case when to_regclass('public.' || name) is not null then 'OK' else 'MISSING' end as status from expected_tables
union all
select 'column', tbl || '.' || col, case when exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = tbl and c.column_name = col) then 'OK' else 'MISSING' end from expected_columns
union all
select 'index', name, case when exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = name) then 'OK' else 'MISSING' end from expected_indexes
union all
select 'trigger', tbl || '.' || name, case when exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname = name and t.tgrelid = to_regclass('public.' || tbl)) then 'OK' else 'MISSING' end from expected_triggers
union all
select 'constraint', tbl || '.' || name, case when exists (select 1 from pg_constraint k where k.conname = name and k.conrelid = to_regclass('public.' || tbl)) then 'OK' else 'MISSING' end from expected_constraints
order by 1, 2;
