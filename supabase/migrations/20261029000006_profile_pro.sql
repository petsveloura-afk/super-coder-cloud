-- Wave 52 — personal profile: job title, phone, short bio + profile pictures.
-- Additive and idempotent: "add column if not exists", guarded constraints, a new bucket and new policies.
-- profiles.avatar_url already exists (phase 1) — it is only used now. Nothing is dropped or rewritten.

alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists bio text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_job_title_check') then
    alter table public.profiles add constraint profiles_job_title_check check (job_title is null or char_length(job_title) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_check') then
    alter table public.profiles add constraint profiles_phone_check check (phone is null or char_length(phone) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_check') then
    alter table public.profiles add constraint profiles_bio_check check (bio is null or char_length(bio) <= 500);
  end if;
end $$;

-- ---------------------------------------------------------------- profile pictures: avatars/<user id>/…
-- Public read (pictures are shown in the app); each person may write only inside their own folder.
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present — skipping avatars bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars own upload') then
    execute $p$
      create policy "avatars own upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars own delete') then
    execute $p$
      create policy "avatars own delete" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
end $$;

notify pgrst, 'reload schema';
