begin;

-- Profil fotoğrafı ve kapak görsellerinin ortak alanı. Migration daha önce
-- kısmen uygulanmış olsa da tekrar çalıştırılabilir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  8388608,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar_images_public_read" on storage.objects;
drop policy if exists "users_insert_own_avatar" on storage.objects;
drop policy if exists "users_update_own_avatar" on storage.objects;
drop policy if exists "users_delete_own_avatar" on storage.objects;

create policy "avatar_images_public_read"
on storage.objects for select
to public
using (bucket_id = 'avatars');

create policy "users_insert_own_avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('avatar', 'banner')
);

create policy "users_update_own_avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('avatar', 'banner')
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('avatar', 'banner')
);

create policy "users_delete_own_avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('avatar', 'banner')
);

commit;
