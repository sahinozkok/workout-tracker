-- =============================================================================
-- İZOLE MANTIK DOĞRULAMASI — sürümlü rank sözleşmesi (v2)
-- Dosya: supabase/migrations/20260909120000_add_versioned_rank_contract.sql
-- =============================================================================
--
-- KAPSAM VE SINIRLAR — ÖNEMLİ
--   * Bu, YENİ migration'ın KENDİ MANTIĞINI (rank_to_v2 eşlemesi + v2
--     sarmalayıcıların gerçekten oluşması ve çıktı kimliğini çevirmesi) izole
--     bir PostgreSQL'de çalıştırıp doğrular.
--   * v1 YÜZEYİ (rank_for_rp ve dört v1 RPC) burada SÖZLEŞMEYE UYGUN STUB'larla
--     kurulur; gerçek üretim gövdeleri (yazma/uzlaştırma/RLS/auth/advisory-lock)
--     BURADA YOKTUR.
--   * Bu dosya BİR STUB DOĞRULAMASIDIR: TAM MIGRATION ZİNCİRİNİN veya
--     GÜVENLİK/RLS ENTEGRASYONUNUN yerini TUTMAZ ve öyle raporlanmamalıdır.
--     Tam güvenlik/entegrasyon, gerçek şema + Supabase rolleri/RLS ile ayrı
--     yapılmalıdır.
--
-- ÇALIŞTIRMA (izole, tek seferlik container):
--   docker run -d --name rankpg -e POSTGRES_PASSWORD=pw postgres:16-alpine
--   # hazır olana kadar bekleyin (docker exec rankpg pg_isready -U postgres)
--   docker cp supabase/tests/rank_contract_v2_isolated.sql rankpg:/tmp/t.sql
--   docker cp supabase/migrations/20260909120000_add_versioned_rank_contract.sql rankpg:/tmp/mig.sql
--   docker exec -e PGPASSWORD=pw rankpg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql
--   docker rm -f rankpg
-- Başarılıysa "TÜM v2 EŞLEME TESTLERİ GEÇTİ" notice'ı basılır; herhangi bir
-- assert düşerse psql sıfırdan farklı kodla çıkar (ON_ERROR_STOP).
--
-- NOT: Bu depodaki JS harness'ları (verify-ranks / verify-rank-leaderboard /
-- verify-rank-experience) sözleşmeyi STATİK + modelle doğrular; bu dosya ise
-- SQL'in gerçek Postgres'te çalıştırılabildiği ORTAM VARSA aynı eşlemeyi CANLI
-- doğrular.

\set ON_ERROR_STOP on

-- Supabase rolleri (grant/revoke hedefleri; çıplak postgres'te yoktur).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

-- v1 rank_for_rp — TARİHSEL migration ile AYNI (ESKİ kimlikler).
create or replace function public.rank_for_rp(rp integer) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(rp,0) >= 1650 then 'rosea'
    when coalesce(rp,0) >= 1350 then 'master'
    when coalesce(rp,0) >= 1050 then 'diamond'
    when coalesce(rp,0) >= 750 then 'platinum'
    when coalesce(rp,0) >= 450 then 'gold'
    when coalesce(rp,0) >= 200 then 'silver'
    else 'bronze' end;
$$;

-- v1 RPC STUB'ları — v2 sarmalayıcıların çağırdığı imza/şekil (ESKİ kimlikler).
create or replace function public.sync_my_rank(client_today date)
returns table (season_index integer, starts_on date, ends_on date, theme_name text,
  starting_rp integer, current_rp integer, peak_rp integer, current_rank text, peak_rank text,
  workouts_completed integer, scheduled_days_total integer, scheduled_days_completed integer, longest_streak integer)
language sql security definer set search_path = '' as $$
  select 3, date '2026-01-05', date '2026-03-01', null::text,
    1150, 1200, 1400, public.rank_for_rp(1200), public.rank_for_rp(1400),  -- diamond, master
    9, 20, 18, 12;
$$;

create or replace function public.get_my_rank_history()
returns table (season_index integer, starts_on date, ends_on date, theme_name text,
  final_rp integer, final_rank text, peak_rank text,
  workouts_completed integer, scheduled_days_total integer, scheduled_days_completed integer, longest_streak integer)
language sql security definer set search_path = '' as $$
  select 2, date '2025-11-10', date '2026-01-04', null::text,
    1400, public.rank_for_rp(1400), public.rank_for_rp(1700),  -- master, rosea
    30, 40, 39, 22;
$$;

create or replace function public.get_friend_rank(target_user_id uuid)
returns table (season_index integer, current_rp integer, current_rank text, peak_rank text)
language sql security definer set search_path = '' as $$
  select 3, 1100, public.rank_for_rp(1100), public.rank_for_rp(1100);  -- diamond, diamond
$$;

create or replace function public.get_friends_rank_leaderboard()
returns table (participant_id uuid, display_name text, username text, avatar_url text,
  season_index integer, current_rp integer, current_rank text, rank_position integer,
  is_self boolean, is_ranked boolean, participant_count integer)
language sql security definer set search_path = '' as $$
  values
    (gen_random_uuid(), 'A', 'a', null::text, 3, 1400, public.rank_for_rp(1400), 1, true, true, 2),   -- master
    (gen_random_uuid(), 'B', 'b', null::text, 3, null::integer, null::text, null::integer, false, false, 2);
$$;

-- === GERÇEK MIGRATION (rank_to_v2 + v2 RPC'ler + gömülü assert'ler) ===
\i /tmp/mig.sql

-- === UÇTAN UCA EŞLEME TESTLERİ (v2 çıktısı YENİ kimlik olmalı) ===
do $$
declare r record;
begin
  select current_rank, peak_rank into r from public.sync_my_rank_v2(current_date);
  assert r.current_rank = 'emerald', 'sync v2: 1200 (eski diamond) -> emerald, gelen: '||r.current_rank;
  assert r.peak_rank    = 'diamond', 'sync v2: 1400 (eski master) -> diamond, gelen: '||r.peak_rank;

  select final_rank, peak_rank into r from public.get_my_rank_history_v2();
  assert r.final_rank = 'diamond', 'history v2: eski master -> diamond, gelen: '||r.final_rank;
  assert r.peak_rank  = 'rosea', 'history v2: rosea korunmali, gelen: '||r.peak_rank;

  select current_rank into r from public.get_friend_rank_v2(gen_random_uuid());
  assert r.current_rank = 'emerald', 'friend v2: eski diamond -> emerald, gelen: '||r.current_rank;

  perform 1 from public.get_friends_rank_leaderboard_v2()
    where current_rank is not null and current_rank <> 'diamond';
  assert found = false, 'leaderboard v2: siralanmis master -> diamond olmali';
  perform 1 from public.get_friends_rank_leaderboard_v2() where is_ranked = false and current_rank is not null;
  assert found = false, 'leaderboard v2: siralanmamis satirda rank NULL kalmali';

  raise notice 'TÜM v2 EŞLEME TESTLERİ GEÇTİ';
end $$;
