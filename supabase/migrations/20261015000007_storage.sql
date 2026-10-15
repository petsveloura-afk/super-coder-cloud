-- ============================================================================
-- SUPER CODER CLOUD — 0007 Private storage bucket + tenant-scoped policies
-- Objects must live under "<organization_id>/...". Skipped automatically
-- when the storage schema is absent (e.g. plain-Postgres CI).
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present — skipping storage policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('org-files', 'org-files', false, 26214400,
          array['image/png','image/jpeg','image/webp','application/pdf','text/csv','text/plain'])
  on conflict (id) do update set public = false;

  execute $p$
    create policy "org files read" on storage.objects for select to authenticated
    using (bucket_id = 'org-files'
      and public.has_permission(((storage.foldername(name))[1])::uuid, 'contacts.read'))
  $p$;
  execute $p$
    create policy "org files write" on storage.objects for insert to authenticated
    with check (bucket_id = 'org-files'
      and public.has_permission(((storage.foldername(name))[1])::uuid, 'contacts.write'))
  $p$;
  execute $p$
    create policy "org files delete" on storage.objects for delete to authenticated
    using (bucket_id = 'org-files'
      and public.has_permission(((storage.foldername(name))[1])::uuid, 'contacts.delete'))
  $p$;
end $$;
