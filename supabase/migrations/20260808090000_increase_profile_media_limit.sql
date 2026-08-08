begin;

-- Profil fotoğrafı ve hareketli kapaklar için dosya sınırını 20 MB'a çıkarır.
-- Supabase Free planın 50 MB global üst sınırının altında kalır.
update storage.buckets
set file_size_limit = 20971520
where id = 'avatars';

commit;
