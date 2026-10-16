-- Additive: allow Google Gemini (free tier available) as an AI agent provider.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.ai_agents'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.ai_agents drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_agents
  add constraint ai_agents_provider_check check (provider in ('openai', 'anthropic', 'gemini'));

notify pgrst, 'reload schema';
