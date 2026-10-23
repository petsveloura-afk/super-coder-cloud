-- Wave 16 — follow-ups that adapt to the customer's mood (additive).
-- Same rules as before (one pending follow-up per customer, never on web / opt-out / human),
-- plus: an unhappy customer is not chased by the bot (a person is notified instead),
-- an excited / hot customer gets the follow-up sooner (half the time, at least 1 hour).
create or replace function public.plan_followup(p_conversation uuid, p_hours numeric, p_step int default 1)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
  sid uuid;
  mood text;
  hrs numeric := p_hours;
begin
  if p_hours is null or p_hours <= 0 then return null; end if;
  select * into conv from public.conversations where id = p_conversation;
  if not found or conv.channel = 'web' or conv.opt_out or conv.ai_mode = 'human' then return null; end if;
  if conv.contact_id is not null then
    select ci.sentiment into mood from public.contact_insights ci where ci.contact_id = conv.contact_id;
  end if;
  -- the latest message's mood from v15 (conversations.sentiment; 'angry' counts as unhappy) when there is no analysis yet
  mood := coalesce(mood, case when conv.sentiment = 'angry' then 'negative' else conv.sentiment end);
  -- one pending follow-up per customer: replace the previous plan
  update public.conversation_schedules set status = 'canceled', reason = 'replanned', updated_at = now()
   where organization_id = conv.organization_id and status = 'pending' and kind = 'followup'
     and (conversation_id = conv.id or (conv.contact_id is not null and contact_id = conv.contact_id));
  if mood = 'negative' then
    -- no automated chasing of an unhappy customer: the team gets a heads-up instead (once a day)
    if not exists (select 1 from public.notifications n where n.organization_id = conv.organization_id and n.kind = 'followup'
                    and n.link = '/inbox?c=' || conv.id::text and n.created_at > now() - interval '1 day') then
      begin
        insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
        select conv.organization_id, m.user_id, 'followup', 'followupMood.negativeNotification',
               jsonb_build_object('name', coalesce(nullif(conv.title, ''), '—')), '/inbox?c=' || conv.id::text
          from public.organization_members m
         where m.organization_id = conv.organization_id
           and (m.user_id = conv.assignee_id or (conv.assignee_id is null and m.role in ('agency_owner', 'owner', 'admin', 'manager')));
      exception when others then null; -- best effort, never blocks the conversation
      end;
    end if;
    return null;
  end if;
  if mood = 'positive' or conv.lead_score = 'hot' then
    hrs := greatest(1, round(p_hours * 0.5, 1));
  end if;
  insert into public.conversation_schedules (organization_id, conversation_id, contact_id, kind, run_at, step, cancel_on_reply)
  values (conv.organization_id, conv.id, conv.contact_id, 'followup', now() + make_interval(mins => round(hrs * 60)::int), greatest(1, least(p_step, 20)), true)
  returning id into sid;
  return sid;
end;
$$;
revoke all on function public.plan_followup(uuid, numeric, int) from public, anon, authenticated;
