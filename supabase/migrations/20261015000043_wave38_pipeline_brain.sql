-- =============================================================================
-- Wave 38 — Pipeline brain: real stage history.
--  * deal_stage_history: one row every time a deal enters a stage (and one when it is created),
--    so the app can measure time-in-stage, stage-to-stage conversion, bottlenecks and sales velocity.
--  * Filled by a trigger on deals; existing deals are back-filled with their current stage.
--  * Readable by whoever may read deals. Nobody writes it directly (trigger only).
-- Additive: no existing table, column, policy or trigger changes.
-- =============================================================================

create table if not exists public.deal_stage_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id uuid not null,
  pipeline_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid not null,
  entered_at timestamptz not null default now(),
  foreign key (organization_id, deal_id) references public.deals (organization_id, id) on delete cascade
);
create index if not exists deal_stage_history_deal on public.deal_stage_history (organization_id, deal_id, entered_at);
create index if not exists deal_stage_history_pipeline on public.deal_stage_history (organization_id, pipeline_id, entered_at desc);

alter table public.deal_stage_history enable row level security;
drop policy if exists deal_stage_history_read on public.deal_stage_history;
create policy deal_stage_history_read on public.deal_stage_history for select to authenticated
  using (public.has_permission(organization_id, 'deals.read'));
grant select on public.deal_stage_history to authenticated;
revoke insert, update, delete on public.deal_stage_history from authenticated;
revoke all on public.deal_stage_history from anon;

create or replace function public.deals_stage_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deal_stage_history (organization_id, deal_id, pipeline_id, from_stage_id, to_stage_id, entered_at)
    values (new.organization_id, new.id, new.pipeline_id, null, new.stage_id, new.created_at);
  elsif new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history (organization_id, deal_id, pipeline_id, from_stage_id, to_stage_id)
    values (new.organization_id, new.id, new.pipeline_id, old.stage_id, new.stage_id);
  end if;
  return null;
end;
$$;
revoke all on function public.deals_stage_history() from public, anon, authenticated;

drop trigger if exists deals_stage_history on public.deals;
create trigger deals_stage_history after insert or update of stage_id on public.deals
  for each row execute function public.deals_stage_history();

-- back-fill: every existing deal "entered" its current stage when it was last touched
insert into public.deal_stage_history (organization_id, deal_id, pipeline_id, from_stage_id, to_stage_id, entered_at)
select d.organization_id, d.id, d.pipeline_id, null, d.stage_id, d.updated_at
  from public.deals d
 where not exists (select 1 from public.deal_stage_history h where h.deal_id = d.id);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.deal_stage_history to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
