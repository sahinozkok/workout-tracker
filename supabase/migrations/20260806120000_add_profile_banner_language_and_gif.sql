begin;

-- 1) Profil kapağı (banner) ve dil tercihi. Her ikisi de geriye uyumludur:
--    mevcut satırlar bozulmaz, avatar_url'e dokunulmaz.
alter table public.profiles
  add column if not exists banner_url text;

alter table public.profiles
  add column if not exists preferred_language text not null default 'tr';

-- Mevcut kullanıcılar Türkçe ile devam eder; yalnızca 'tr' ve 'en' kabul edilir.
do $$
begin
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'profiles'
      and con.conname = 'profiles_preferred_language_check'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_language_check
      check (preferred_language in ('tr', 'en'));
  end if;
end $$;

-- 2) Storage: mevcut 'avatars' alanı korunur, yalnızca GIF desteği ve boyut
--    sınırı güncellenir. Yeni bucket açılmaz, RLS politikaları değişmez;
--    kullanıcı yolları `${auth.uid()}/avatar.*` ve `${auth.uid()}/banner.*`
--    olduğu için mevcut klasör bazlı politikalar aynen geçerlidir.
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif'
    ],
    file_size_limit = 8388608
where id = 'avatars';

commit;
