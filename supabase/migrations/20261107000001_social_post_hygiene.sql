-- Post hygiene (additive, idempotent).
-- 1) social_posts.agent_name — which AI employee wrote the post (shown to the people who manage the posts board).
-- 2) Tidy what is already on the board: agent DRAFTS / not-yet-published SCHEDULED posts that are not posts at all (the employee's notes / assumptions, or a
--    report such as "scheduling confirmation, post id …") are set aside as canceled (nothing is deleted — a canceled post can
--    be duplicated back), and markdown bold ("**…**") is removed from agent drafts / scheduled posts (networks print it as is).
alter table public.social_posts add column if not exists agent_name text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_posts_agent_name_check') then
    alter table public.social_posts add constraint social_posts_agent_name_check check (agent_name is null or char_length(agent_name) <= 80);
  end if;
end $$;

-- the board's two orders (newest first / by planned time) — both served by an index
create index if not exists social_posts_org_created on public.social_posts (organization_id, created_at desc);

update public.social_posts
   set status = 'canceled', updated_at = now()
 where source = 'agent'
   and status in ('draft', 'scheduled')
   and (
        body ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
     or body ~* '^[[:space:]*#_>-]*(הנחות|הערות|assumptions?|notes?|ملاحظات|افتراضات)[[:space:]*_]*:'
     or body ~* '(מזהה[[:space:]]+(ה)?פוסט|אישור[[:space:]]+תזמון|post[[:space:]]+id|draft[[:space:]]+saved)'
   );

update public.social_posts
   set body = btrim(regexp_replace(body, '\*\*', '', 'g')), updated_at = now()
 where source = 'agent'
   and status in ('draft', 'scheduled')
   and position('**' in body) > 0
   and char_length(btrim(regexp_replace(body, '\*\*', '', 'g'))) > 0;
