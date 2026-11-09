-- The agent stays out of a conversation a person took over until "return to agent" is pressed.
-- Agents saved from the setup screen carry the old DEFAULT (30 minutes) in their profile even though nobody chose it:
-- reset exactly that value to 0 (= never by itself). Any other time a business chose (15, 60, 120 ...) is kept untouched.
update public.ai_agents
   set profile = jsonb_set(coalesce(profile, '{}'::jsonb), '{resume_after_minutes}', '0'::jsonb, true)
 where coalesce(profile, '{}'::jsonb) ->> 'resume_after_minutes' = '30'
    or (coalesce(profile, '{}'::jsonb) ? 'resume_after_minutes') = false;

notify pgrst, 'reload schema';
