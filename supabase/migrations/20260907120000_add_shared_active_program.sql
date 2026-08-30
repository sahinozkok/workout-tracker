/**
 * Aktif programı profilde İSTEĞE BAĞLI paylaşma.
 *
 * FAZ 1'DEN (aktivite/kardiyo) SONRA uygulanır ve ona bağımlıdır:
 * `program_exercises.tracking_mode`, `target_duration_seconds`,
 * `target_distance_meters` kolonları
 * `20260905120000_add_activity_tracking_foundation.sql` tarafından kurulur.
 *
 * ÜRÜN KARARI:
 *   - Kullanıcı Ayarlar'dan "Aktif programımı profilimde göster"i açabilir.
 *   - Varsayılan KAPALIDIR (`show_active_program_on_profile = false`).
 *   - Açık + aktif program varsa: kabul edilmiş arkadaşlar aktif programı
 *     arkadaş profilinde SALT OKUNUR görür.
 *   - Kapalı / aktif program yok / arkadaş değil / engel varsa: SIFIR satır.
 *     Dışarıdan "paylaşım kapalı" ile "aktif program yok" AYIRT EDİLEMEZ.
 *
 * GÜVENLİK SINIRLARI (bilinçli):
 *   - `get_friend_profile`in DONDURULMUŞ 11 sütunlu sözleşmesine DOKUNULMAZ;
 *     program için AYRI, salt okunur bir RPC eklenir.
 *   - Arkadaşlara `profiles` veya program tablolarına DOĞRUDAN SELECT açılmaz;
 *     mevcut own-only RLS politikaları gevşetilmez. Erişim yalnızca
 *     `security definer` RPC üzerinden ve yalnızca doğrulanmış koşullarla olur.
 *   - Yeni kolonu YALNIZ sahibi, mevcut `profiles_update_own` politikası
 *     üzerinden güncelleyebilir; bu dosya yeni bir politika EKLEMEZ.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Opt-in bayrağı. Additive ve tekrarlanabilir; varsayılan KAPALI.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists show_active_program_on_profile boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) Salt okunur arkadaş programı RPC'si.
--
--    Yalnızca GÖSTERİM alanları döner. UUID/satır kimliği, owner/user kimliği,
--    timestamp, workout session/set/activity geçmişi, kilo/tekrar/RPE, notlar,
--    XP/gül/rank, `rest_seconds`, görsel/Storage URL'leri HİÇ dönmez.
--
--    `LEFT JOIN program_exercises`: off-day veya egzersizsiz günler kaybolmaz.
--    Sıralama `day_position`, ardından `exercise_position`.
-- ---------------------------------------------------------------------------
create or replace function public.get_friend_active_program(target_user_id uuid)
returns table (
  program_name text,
  day_name text,
  scheduled_weekday smallint,
  is_off_day boolean,
  day_position integer,
  exercise_id text,
  custom_exercise_name text,
  tracking_mode text,
  target_sets smallint,
  target_reps text,
  target_duration_seconds integer,
  target_distance_meters integer,
  exercise_position integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.name as program_name,
    d.name as day_name,
    d.scheduled_weekday,
    d.is_off_day,
    d.position as day_position,
    e.exercise_id,
    e.custom_exercise_name,
    e.tracking_mode,
    e.target_sets,
    e.target_reps,
    e.target_duration_seconds,
    e.target_distance_meters,
    e.position as exercise_position
  from public.programs as p
  join public.profiles as pr on pr.id = p.owner_id
  join public.program_days as d on d.program_id = p.id
  left join public.program_exercises as e on e.program_day_id = d.id
  where (select auth.uid()) is not null
    -- Bu RPC yalnız arkadaş profili içindir; kişinin kendi hesabı için kullanılmaz.
    and (select auth.uid()) <> target_user_id
    -- Yalnız hedef kullanıcının AKTİF programı; aktif olmayan program asla dönmez.
    and p.owner_id = target_user_id
    and p.is_active
    -- Hedef profil paylaşımı AÇIK olmalı.
    and pr.show_active_program_on_profile
    -- Yalnız kabul edilmiş arkadaşlık; pending/nonfriend → sıfır satır.
    and public.are_friends((select auth.uid()), target_user_id)
    -- Taraflardan biri engelliyse → sıfır satır.
    and not public.has_block_between((select auth.uid()), target_user_id)
  order by d.position asc, e.position asc nulls first;
$$;

-- Giriş yapmamış/anon çağrı veri alamaz; yalnız `authenticated` çalıştırabilir.
revoke all on function public.get_friend_active_program(uuid) from public;
revoke all on function public.get_friend_active_program(uuid) from anon;
grant execute on function public.get_friend_active_program(uuid) to authenticated;

commit;
