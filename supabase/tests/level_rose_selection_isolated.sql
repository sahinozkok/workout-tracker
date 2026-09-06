-- =============================================================================
-- İZOLE DAVRANIŞ TESTİ — seviye gülü seçimi RPC'leri
-- Dosya: supabase/migrations/20260910120000_add_level_rose_selection.sql
-- =============================================================================
--
-- KAPSAM VE SINIRLAR
--   * Bu, YENİ migration'ın RPC MANTIĞINI (bilinmeyen/kilitli reddi, sunucu
--     seviyesi, oturumsuz reddi, yalnız kendi satırı, katalog CHECK'i) izole bir
--     PostgreSQL'de GERÇEKTEN çalıştırıp doğrular.
--   * Bağımlılıklar (auth.uid, user_progress, level_progress, ensure_user_progress,
--     are_friends) SÖZLEŞMEYE UYGUN STUB'larla kurulur. Bu bir STUB testidir; TAM
--     Supabase/RLS/JWT entegrasyonu DEĞİLDİR ve öyle raporlanmamalıdır.
--   * `auth.uid()` oturumu, `set test.uid = '<uuid>'` ile taklit edilir. Gerçek
--     RLS (istemcinin doğrudan UPDATE'i) tarihsel migrationdaki policy YOKLUĞUyla
--     sağlanır ve burada test edilmez.
--
-- İKİ MIGRATION — bu test HEM `20260910...` (skaler get_friend_level_rose) HEM
-- de `20260911..._upgrade_friend_level_rose_to_table` (tabloya yükseltme)
-- migration'larını SIRAYLA uygular ve YÜKSELTME YOLUNU açıkça doğrular:
--   * mig 10 sonrası imza SKALER (`returns text`),
--   * mig 11 sonrası imza TABLO (`returns table`),
--   * tablo sözleşmesi erişim reddini otomatik null'dan ayırır.
-- Bu sıra hem TEMİZ KURULUM (10→11) hem de ESKİ SÖZLEŞMEDEN YÜKSELTME (skaler
-- zaten varken 11'in drop+recreate'i) yolunu kapsar.
--
-- ÇALIŞTIRMA (Docker daemon çalışıyorsa):
--   docker run -d --name lrpg -e POSTGRES_PASSWORD=pw postgres:16-alpine
--   docker cp supabase/tests/level_rose_selection_isolated.sql lrpg:/tmp/t.sql
--   docker cp supabase/migrations/20260910120000_add_level_rose_selection.sql lrpg:/tmp/mig10.sql
--   docker cp supabase/migrations/20260911120000_upgrade_friend_level_rose_to_table.sql lrpg:/tmp/mig11.sql
--   docker exec -e PGPASSWORD=pw lrpg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql
--   docker rm -f lrpg
-- Başarılıysa "TÜM SEÇİM DAVRANIŞ TESTLERİ GEÇTİ" basılır.

\set ON_ERROR_STOP on

-- Supabase rolleri (grant/revoke hedefleri; çıplak postgres'te yoktur).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;

-- auth.uid() — oturum-ayarlanabilir taklit.
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

-- user_progress — migration `selected_level_rose` kolonunu EKLER (kolon burada YOK).
create table public.user_progress (
  user_id uuid primary key,
  lifetime_xp integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

-- level_progress(total_xp) — STUB: level := total_xp (deterministik testler için).
create or replace function public.level_progress(total_xp integer)
returns table (level integer, xp_into_level integer, xp_for_next integer)
language sql immutable as $$ select coalesce(total_xp,0), 0, 100 $$;

-- ensure_user_progress(uuid) — satırı yoksa açar.
create or replace function public.ensure_user_progress(target_user uuid)
returns void language sql as $$
  insert into public.user_progress (user_id) values (target_user)
  on conflict (user_id) do nothing;
$$;

-- are_friends(a,b) — STUB: test.friends='on' iken true.
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable as $$
  select current_setting('test.friends', true) = 'on'
$$;

-- === GERÇEK MIGRATION (1/2): skaler sözleşme ===
\i /tmp/mig10.sql

-- YÜKSELTME ÖNCESİ: imza SKALER olmalı (`returns text`).
do $$
begin
  assert (
    select pg_get_function_result(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_friend_level_rose'
  ) = 'text', 'mig10 sonrası get_friend_level_rose SKALER (returns text) olmalı';
end $$;

-- === GERÇEK MIGRATION (2/2): tabloya yükseltme ===
\i /tmp/mig11.sql

-- YÜKSELTME SONRASI: imza TABLO olmalı (`returns table(selected_level_rose text)`).
do $$
begin
  assert (
    select pg_get_function_result(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_friend_level_rose'
  ) = 'TABLE(selected_level_rose text)',
    'mig11 sonrası get_friend_level_rose TABLO (returns table) olmalı';
end $$;

-- === TEST KULLANICILARI ===
-- A: seviye 13 (lifetime_xp=13 → stub level 13). B: seviye 200.
set test.uid = '11111111-1111-1111-1111-111111111111';
select public.ensure_user_progress(auth.uid());
update public.user_progress set lifetime_xp = 13 where user_id = auth.uid();

set test.uid = '22222222-2222-2222-2222-222222222222';
select public.ensure_user_progress(auth.uid());
update public.user_progress set lifetime_xp = 200 where user_id = auth.uid();

-- Yardımcı: beklenen mesajla düşen çağrıyı doğrular.
create or replace function pg_temp.expect_error(sql text, needle text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
    raise exception 'BEKLENEN HATA OLMADI (% içermeliydi): %', needle, sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'YANLIŞ HATA: "%" beklendi, gelen "%"', needle, sqlerrm;
    end if;
  end;
end $$;

do $$
declare r text;
begin
  -- 1) OTURUMSUZ: auth.uid null → not_authenticated
  perform set_config('test.uid', '', true);
  perform pg_temp.expect_error($q$ select public.set_my_level_rose('rose_1') $q$, 'not_authenticated');
  perform pg_temp.expect_error($q$ select public.get_my_level_rose() $q$, 'not_authenticated');

  -- A (seviye 13) bağlamı
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

  -- 2) BİLİNMEYEN kimlik reddi
  perform pg_temp.expect_error($q$ select public.set_my_level_rose('rose_999') $q$, 'unknown_level_rose');
  perform pg_temp.expect_error($q$ select public.set_my_level_rose('rose_14') $q$, 'unknown_level_rose');

  -- 3) KİLİTLİ (seviye 13 < 15) reddi
  perform pg_temp.expect_error($q$ select public.set_my_level_rose('rose_15') $q$, 'level_rose_locked');
  perform pg_temp.expect_error($q$ select public.set_my_level_rose('rose_200') $q$, 'level_rose_locked');

  -- 4) GEÇERLİ (açık) seçim kabul edilir; kalıcı olur
  r := public.set_my_level_rose('rose_13');
  assert r = 'rose_13', 'geçerli seçim döndürülmeli';
  assert public.get_my_level_rose() = 'rose_13', 'seçim okunabilmeli';

  -- 5) KAZANILMIŞ ESKİ gül (rose_1) seçilebilir; seviye DEĞİŞMEZ
  r := public.set_my_level_rose('rose_1');
  assert r = 'rose_1', 'eski gül seçilebilmeli';
  assert (select lifetime_xp from public.user_progress where user_id = auth.uid()) = 13,
    'seçim lifetime_xp/seviyeyi değiştirmemeli';

  -- 6) null → otomatik moda dönüş
  r := public.set_my_level_rose(null);
  assert r is null, 'null otomatik moda dönmeli';
  assert public.get_my_level_rose() is null, 'otomatik modda seçim null';

  -- 7) YALNIZ KENDİ SATIRI: A yazınca B etkilenmez
  perform public.set_my_level_rose('rose_5');
  assert (select selected_level_rose from public.user_progress
          where user_id = '22222222-2222-2222-2222-222222222222') is null,
    'A''nın seçimi B''ye yazılmamalı';

  -- 8) B (seviye 200) her gülü seçebilir
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  r := public.set_my_level_rose('rose_200');
  assert r = 'rose_200', 'seviye 200 en yüksek gülü seçebilmeli';

  -- 9) KATALOG CHECK'i (savunma derinliği): doğrudan geçersiz kimlik reddedilir
  perform pg_temp.expect_error(
    $q$ update public.user_progress set selected_level_rose = 'not_a_rose'
        where user_id = '22222222-2222-2222-2222-222222222222' $q$,
    'user_progress_selected_level_rose_known');

  -- 10) ARKADAŞ OKUMASI (YENİ SÖZLEŞME `returns table`): erişim reddi ile
  -- otomatik tercih (null) AYRILIR.
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('test.friends', 'off', true);
  -- Erişim YOK → HİÇ satır. (Skaler sürümdeki gibi "null" DEĞİL: 0 satır.)
  assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 0,
    'arkadaş değilken hiç satır dönmemeli (erişim reddi ≠ otomatik null)';
  perform set_config('test.friends', 'on', true);
  -- Erişim VAR → TAM bir satır; B''nin seçili gülü rose_200 (test 8''den).
  assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 1,
    'arkadaşken tam bir satır dönmeli';
  assert (select selected_level_rose from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 'rose_200',
    'arkadaşken seçili gül okunmalı';

  -- 11) OTOMATİK MOD (null) ile ERİŞİM REDDİ ayrıdır: B otomatik moda dönse bile
  -- arkadaşa 1 satır + null döner (0 satır DEĞİL). Böylece istemci "otomatik
  -- tercih"i "erişim yok"tan ayırt edebilir.
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  perform public.set_my_level_rose(null);
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
  assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 1,
    'otomatik moddaki arkadaş için yine 1 satır (erişim var)';
  assert (select selected_level_rose from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) is null,
    'otomatik modda seçili gül null (ama erişim VAR → 1 satır)';

  raise notice 'TÜM SEÇİM DAVRANIŞ TESTLERİ GEÇTİ';
end $$;
