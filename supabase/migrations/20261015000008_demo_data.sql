-- ============================================================================
-- SUPER CODER CLOUD — 0008 Optional demo data loader
-- Fictional data, clearly flagged (organizations.is_demo + contacts.is_demo).
-- Only an owner/admin (settings.manage) of an EMPTY organization may load it.
-- Demo organizations must never trigger outbound messages/payments/AI —
-- every outbound adapter checks organizations.is_demo first.
-- ============================================================================
create or replace function public.load_demo_data(org uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  pipe uuid;
  st_new uuid; st_q uuid; st_p uuid; st_n uuid;
  co1 uuid; co2 uuid; co3 uuid;
  c record;
  inserted int := 0;
begin
  if not public.has_permission(org, 'settings.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from contacts where organization_id = org) then
    raise exception 'organization already has contacts' using errcode = '23505';
  end if;

  update organizations set is_demo = true where id = org;

  select id into pipe from pipelines where organization_id = org and is_default;
  select id into st_new from pipeline_stages where pipeline_id = pipe and position = 0;
  select id into st_q   from pipeline_stages where pipeline_id = pipe and position = 1;
  select id into st_p   from pipeline_stages where pipeline_id = pipe and position = 2;
  select id into st_n   from pipeline_stages where pipeline_id = pipe and position = 3;

  insert into companies (organization_id, name, industry, created_by) values (org, '[DEMO] אור שמש בע"מ', 'אנרגיה', uid) returning id into co1;
  insert into companies (organization_id, name, industry, created_by) values (org, '[DEMO] גלבוע טכנולוגיות', 'תוכנה', uid) returning id into co2;
  insert into companies (organization_id, name, industry, created_by) values (org, '[DEMO] Cedar Logistics', 'Logistics', uid) returning id into co3;

  for c in
    select * from (values
      ('נועה', 'כהן', 'noa.demo@example.com', '+972500000001', 'qualified'::contact_status, 'website', co1, 2),
      ('יוסי', 'לוי', 'yossi.demo@example.com', '+972500000002', 'lead', 'form', co1, 5),
      ('מאיה', 'אברהם', 'maya.demo@example.com', '+972500000003', 'customer', 'referral', co2, 12),
      ('עומר', 'מזרחי', 'omer.demo@example.com', '+972500000004', 'lead', 'whatsapp', co2, 1),
      ('ליאת', 'פרץ', 'liat.demo@example.com', '+972500000005', 'qualified', 'facebook', null, 8),
      ('أحمد', 'خليل', 'ahmad.demo@example.com', '+972500000006', 'lead', 'telegram', co3, 3),
      ('Daniel', 'Green', 'daniel.demo@example.com', '+972500000007', 'customer', 'google', co3, 20),
      ('שירה', 'בן דוד', 'shira.demo@example.com', '+972500000008', 'inactive', 'import', null, 40)
    ) as v(fn, ln, em, ph, st, src, comp, age)
  loop
    insert into contacts (organization_id, company_id, first_name, last_name, email, phone, status, source,
                          is_demo, created_by, created_at, marketing_consent)
    values (org, c.comp, c.fn, c.ln, c.em, c.ph, c.st, c.src, true, uid, now() - make_interval(days => c.age), c.age % 2 = 0);
    inserted := inserted + 1;
  end loop;

  insert into deals (organization_id, pipeline_id, stage_id, company_id, title, value, status, created_by, expected_close_date)
  values
    (org, pipe, st_new, co1, '[DEMO] מערכת סולארית למשרדים', 48000, 'open', uid, current_date + 30),
    (org, pipe, st_q,   co2, '[DEMO] רישוי שנתי', 120000, 'open', uid, current_date + 45),
    (org, pipe, st_p,   co3, '[DEMO] Fleet tracking rollout', 76000, 'open', uid, current_date + 20),
    (org, pipe, st_n,   co2, '[DEMO] הרחבת חוזה תמיכה', 32000, 'open', uid, current_date + 10);

  insert into deals (organization_id, pipeline_id, stage_id, company_id, title, value, status, created_by, closed_at)
  values (org, pipe, st_n, co3, '[DEMO] Pilot project', 18000, 'won', uid, now() - interval '6 days');

  insert into tasks (organization_id, title, status, due_at, assignee_id, created_by)
  values
    (org, '[DEMO] להתקשר לנועה בנוגע להצעת מחיר', 'open', now() + interval '1 day', uid, uid),
    (org, '[DEMO] לשלוח חוזה לגלבוע', 'open', now() - interval '1 day', uid, uid),
    (org, '[DEMO] Follow up with Daniel', 'in_progress', now() + interval '3 days', uid, uid);

  return inserted;
end;
$$;

revoke execute on function public.load_demo_data(uuid) from public, anon;
grant execute on function public.load_demo_data(uuid) to authenticated;
