-- Follow-up playbook (additive): the workspace rules for automated messages get four more settings.
--   followup_playbook       true  — every follow-up of a silence has its own job: 1st = short personal nudge,
--                                   middle = a new angle (one real benefit / answer to the doubt), last = a respectful
--                                   "closing the loop" message that leaves the door open
--   followup_stop_on_convert true — a customer who booked (upcoming appointment) or bought (deal won in the last 30
--                                   days) gets no more sales follow-ups
--   followup_night_guard    true  — when no quiet hours were set, follow-ups and sequences still wait for the
--                                   morning (21:30 – 08:30 business time)
--   followup_cross_channel  false — (opt-in) when the official WhatsApp 24-hour window has closed, the follow-up may go
--                                   to another conversation the SAME customer opened with the business (Telegram,
--                                   e-mail, Messenger…), only where every guard rule allows it there too
-- Every existing key, default and limit stays exactly as it was (superset). Nothing else changes.

create or replace function public.conversation_policy(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
      'followup_max', 1,          -- follow-ups per silence (after the customer's last message)
      'followup_gap_hours', 24,   -- between two follow-ups of the same silence
      'min_gap_minutes', 2,       -- between two automated messages to the same customer
      'daily_cap', 12,            -- automated messages per customer per 24h (all channels)
      'quiet_start', null,        -- "22:00": no follow-ups / scheduled marketing at night
      'quiet_end', null,          -- "08:00"
      'opt_out_reply', true,      -- confirm the opt-out once
      -- follow-up playbook (this migration)
      'followup_playbook', true,
      'followup_stop_on_convert', true,
      'followup_night_guard', true,
      'followup_cross_channel', false
    ) || coalesce((select conversation_policy from public.organizations where id = p_org), '{}'::jsonb);
$$;
revoke all on function public.conversation_policy(uuid) from public, anon;
grant execute on function public.conversation_policy(uuid) to authenticated, service_role;

create or replace function public.set_conversation_policy(p_org uuid, p_policy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean jsonb;
begin
  if not public.has_permission(p_org, 'settings.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  clean := jsonb_build_object(
    'followup_max', greatest(1, least(coalesce((p_policy ->> 'followup_max')::int, 1), 5)),
    'followup_gap_hours', greatest(1, least(coalesce((p_policy ->> 'followup_gap_hours')::numeric, 24), 168)),
    'min_gap_minutes', greatest(0, least(coalesce((p_policy ->> 'min_gap_minutes')::int, 2), 1440)),
    'daily_cap', greatest(1, least(coalesce((p_policy ->> 'daily_cap')::int, 12), 100)),
    'quiet_start', case when p_policy ->> 'quiet_start' ~ '^([01]\d|2[0-3]):[0-5]\d$' then p_policy ->> 'quiet_start' end,
    'quiet_end', case when p_policy ->> 'quiet_end' ~ '^([01]\d|2[0-3]):[0-5]\d$' then p_policy ->> 'quiet_end' end,
    'opt_out_reply', coalesce((p_policy ->> 'opt_out_reply')::boolean, true),
    -- follow-up playbook (this migration); a caller that does not send them keeps the defaults
    'followup_playbook', coalesce((p_policy ->> 'followup_playbook')::boolean, true),
    'followup_stop_on_convert', coalesce((p_policy ->> 'followup_stop_on_convert')::boolean, true),
    'followup_night_guard', coalesce((p_policy ->> 'followup_night_guard')::boolean, true),
    'followup_cross_channel', coalesce((p_policy ->> 'followup_cross_channel')::boolean, false));
  update public.organizations set conversation_policy = clean where id = p_org;
  return clean;
end;
$$;
revoke all on function public.set_conversation_policy(uuid, jsonb) from public, anon;
grant execute on function public.set_conversation_policy(uuid, jsonb) to authenticated;
