-- Wave 51 — social posts: link, call-to-action button, video, first comment + uploads from the device.
-- Additive and idempotent: only "add column if not exists", guarded constraints, a new bucket and new policies.
-- Nothing existing is dropped, renamed or rewritten; existing rows keep NULL in the new columns.

alter table public.social_posts add column if not exists link_url text;
alter table public.social_posts add column if not exists video_url text;
alter table public.social_posts add column if not exists cta_type text;
alter table public.social_posts add column if not exists cta_value text;
alter table public.social_posts add column if not exists first_comment text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_posts_link_url_check') then
    alter table public.social_posts add constraint social_posts_link_url_check
      check (link_url is null or (link_url ~ '^https?://' and char_length(link_url) <= 1000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_video_url_check') then
    alter table public.social_posts add constraint social_posts_video_url_check
      check (video_url is null or (video_url ~ '^https://' and char_length(video_url) <= 1000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_cta_type_check') then
    alter table public.social_posts add constraint social_posts_cta_type_check
      check (cta_type is null or cta_type in ('message', 'whatsapp', 'call', 'book', 'learn_more', 'shop', 'sign_up', 'order'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_cta_value_check') then
    alter table public.social_posts add constraint social_posts_cta_value_check
      check (cta_value is null or char_length(cta_value) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_first_comment_check') then
    alter table public.social_posts add constraint social_posts_first_comment_check
      check (first_comment is null or char_length(first_comment) <= 2200);
  end if;
end $$;

-- ---------------------------------------------------------------- public bucket for images / videos uploaded from the device
-- Files live under <organization id>/…; members who manage campaigns may upload / read / delete in their own folder.
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present — skipping social-media bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('social-media', 'social-media', true, 52428800,
          array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'])
  on conflict (id) do nothing;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'social media upload') then
    execute $p$
      create policy "social media upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'social-media' and public.has_permission(((storage.foldername(name))[1])::uuid, 'campaigns.manage'))
    $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'social media read') then
    execute $p$
      create policy "social media read" on storage.objects for select to authenticated
      using (bucket_id = 'social-media' and public.has_permission(((storage.foldername(name))[1])::uuid, 'campaigns.manage'))
    $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'social media delete') then
    execute $p$
      create policy "social media delete" on storage.objects for delete to authenticated
      using (bucket_id = 'social-media' and public.has_permission(((storage.foldername(name))[1])::uuid, 'campaigns.manage'))
    $p$;
  end if;
end $$;

notify pgrst, 'reload schema';
