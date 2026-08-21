-- Seviye / XP / gül ilerleme sistemi.
--
-- GÜVENLİK MODELİ
--   * `public.user_progress` toplamlarına istemcinin YAZMA yolu yoktur:
--     tabloda yalnızca `select own` policy'si vardır, insert/update/delete
--     policy'si HİÇ tanımlanmaz. Toplamları yalnızca bu dosyadaki
--     `security definer` fonksiyonlar değiştirir.
--   * `public.reward_ledger` append-only'dir: istemci yalnızca kendi
--     satırlarını okuyabilir; insert/update/delete policy'si yoktur.
--   * Ödül miktarını her zaman SUNUCU hesaplar. İstemci hiçbir çağrıda
--     xp/gül/streak/off-day sayısı/seviye göndermez.
--   * Idempotency `(user_id, event_type, source_key)` benzersiz indeksiyle
--     sağlanır; her ödül yazımı `pg_advisory_xact_lock` altında yapılır,
--     böylece eşzamanlı istekler ne çift ödül ne de kayıp toplam üretir.
--   * Bütün `security definer` fonksiyonlarda `search_path` boşa sabitlenir ve
--     her nesne şema-nitelikli yazılır.
--
-- ÜRÜN KARARI — Rosea okşama ödülünün günlük/haftalık/toplam sınırı YOKTUR.
-- Yalnızca aynı burst'ün ağ tekrarı `source_key` ile tekilleştirilir.
--
-- ÜRÜN KARARI — Ödüller yalnızca sunucunun `programs` + `workout_sets`'ten
-- kendi türettiği OTOMATİK yeşil günlere verilir. `manual_discipline_statuses`
-- istemciye açık yazma izni verdiği için (bkz. initial_schema RLS) manuel
-- işaretler takvimi boyamaya devam eder ama XP/gül üretmez; aksi hâlde XP tek
-- satırlık bir tablo yazımıyla sınırsız üretilebilirdi.

begin;

-- ---------------------------------------------------------------------------
-- 1) Seviye eğrisi — TEK KAYNAK
-- ---------------------------------------------------------------------------

/** Verilen seviyeden BİR SONRAKİ seviyeye geçmenin XP maliyeti. */
create or replace function public.level_step_cost(current_level integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when current_level < 1 then 0
    when current_level = 1 then 120     -- 1 → 2
    when current_level < 5 then 150     -- 2 → 3, 3 → 4, 4 → 5
    when current_level < 10 then 200    -- 5 → 6 … 9 → 10
    when current_level < 15 then 250    -- 10 → 11 … 14 → 15
    when current_level < 99 then 300    -- 15 → 16 … 98 → 99
    when current_level < 999 then 400   -- 99 → 100 … 998 → 999
    else 0                              -- 999 tavan
  end;
$$;

/**
 * Yaşam boyu XP → seviye + seviye içi ilerleme.
 *
 * Kümülatif eşikler: L2 = 120, L3 = 270, L5 = 570, L10 = 1570, L15 = 2820,
 * L99 = 28020, L999 = 388020. 999'da `xp_for_next = 0` döner (MAX).
 */
create or replace function public.level_progress(total_xp integer)
returns table (level integer, xp_into_level integer, xp_for_next integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  remaining bigint := greatest(coalesce(total_xp, 0), 0);
  current_level integer := 1;
  step_cost integer;
begin
  loop
    if current_level >= 999 then
      level := 999;
      xp_into_level := 0;
      xp_for_next := 0;
      return next;
      return;
    end if;

    step_cost := public.level_step_cost(current_level);

    if remaining < step_cost then
      level := current_level;
      xp_into_level := remaining::integer;
      xp_for_next := step_cost;
      return next;
      return;
    end if;

    remaining := remaining - step_cost;
    current_level := current_level + 1;
  end loop;
end;
$$;

create or replace function public.level_for_xp(total_xp integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select lp.level from public.level_progress(total_xp) as lp;
$$;

-- Eğri, migration'ın kendisi tarafından doğrulanır: yanlışsa migration düşer.
do $$
begin
  assert public.level_for_xp(-50) = 1, 'negatif xp seviye 1 olmalı';
  assert public.level_for_xp(0) = 1, 'L1 tabanı';
  assert public.level_for_xp(119) = 1, 'L1 sınırı';
  assert public.level_for_xp(120) = 2, 'L2 eşiği';
  assert public.level_for_xp(269) = 2, 'L2 sınırı';
  assert public.level_for_xp(270) = 3, 'L3 eşiği';
  assert public.level_for_xp(569) = 4, 'L4 sınırı';
  assert public.level_for_xp(570) = 5, 'L5 eşiği';
  assert public.level_for_xp(1569) = 9, 'L9 sınırı';
  assert public.level_for_xp(1570) = 10, 'L10 eşiği';
  assert public.level_for_xp(2819) = 14, 'L14 sınırı';
  assert public.level_for_xp(2820) = 15, 'L15 eşiği';
  assert public.level_for_xp(28019) = 98, 'L98 sınırı';
  assert public.level_for_xp(28020) = 99, 'L99 eşiği';
  assert public.level_for_xp(388019) = 998, 'L998 sınırı';
  assert public.level_for_xp(388020) = 999, 'L999 eşiği';
  assert public.level_for_xp(999999999) = 999, '999 tavanı aşılmamalı';
  assert (select xp_for_next from public.level_progress(388020)) = 0, '999 MAX';
  assert (select xp_into_level from public.level_progress(120)) = 0, 'L2 başı';
  assert (select xp_into_level from public.level_progress(269)) = 149, 'L2 içi';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Toplamlar ve append-only defter
-- ---------------------------------------------------------------------------

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lifetime_xp integer not null default 0 check (lifetime_xp >= 0),
  rose_balance integer not null default 0 check (rose_balance >= 0),
  /**
   * Reconciliation imleçleri — **yalnızca sunucu** yazar (tabloda istemci için
   * insert/update policy'si yoktur).
   *
   * `days_reconciled_through`: bu tarih dâhil bütün günler uzlaştırıldı.
   * Tarama buradan sonra başlar, böylece her açılışta bütün geçmiş yeniden
   * taranmaz. İmleç yalnızca KESİNLEŞMİŞ güne kadar ilerler (`client_today - 2`):
   * bugün ve dün hâlâ değişebilir, çünkü `sync_workout_rewards` dünü de kabul
   * eder.
   *
   * `weeks_reconciled_through`: bu pazartesiyle başlayan haftaya kadar bütün
   * kapanmış haftalar tüketildi.
   *
   * İmleçler bir HAK KAYBI sınırı DEĞİLDİR: yalnızca "buraya kadar zaten
   * bakıldı" bilgisidir. Progression başladıktan sonraki hiçbir gün veya hafta
   * süre geçti diye düşmez.
   */
  days_reconciled_through date,
  weeks_reconciled_through date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Migration yeniden çalıştırılırsa da imleç kolonları kesin olarak bulunur.
alter table public.user_progress add column if not exists days_reconciled_through date;
alter table public.user_progress add column if not exists weeks_reconciled_through date;

alter table public.user_progress enable row level security;

drop policy if exists "user_progress_select_own" on public.user_progress;
create policy "user_progress_select_own"
on public.user_progress for select
to authenticated
using ((select auth.uid()) = user_id);
-- Bilinçli olarak insert/update/delete policy'si YOK.

drop trigger if exists user_progress_set_updated_at on public.user_progress;
create trigger user_progress_set_updated_at
before update on public.user_progress
for each row execute function public.set_updated_at();

create table if not exists public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in ('set', 'day', 'streak', 'weekly', 'pet', 'daily_login')
  ),
  source_key text not null check (char_length(source_key) between 1 and 200),
  -- Üst sınır yalnızca akıl sağlığı kontrolüdür. Streak bonusunda ÜST SINIR
  -- OLMADIĞI için (401 günlük seri = 401) eski 1000'lik tavan meşru bir seride
  -- check ihlali üretip bütün transaction'ı düşürürdü.
  xp_delta integer not null check (xp_delta >= 0 and xp_delta <= 100000),
  rose_delta integer not null check (rose_delta >= 0 and rose_delta <= 100000),
  awarded_for_date date,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists reward_ledger_event_key_idx
on public.reward_ledger (user_id, event_type, source_key);

create index if not exists reward_ledger_user_created_idx
on public.reward_ledger (user_id, created_at desc);

alter table public.reward_ledger enable row level security;

drop policy if exists "reward_ledger_select_own" on public.reward_ledger;
create policy "reward_ledger_select_own"
on public.reward_ledger for select
to authenticated
using ((select auth.uid()) = user_id);
-- Append-only: istemci için insert/update/delete policy'si YOK.

-- ---------------------------------------------------------------------------
-- 3) Progress satırının oluşturulması ve backfill
-- ---------------------------------------------------------------------------

/** Yarış durumuna dayanıklı; eksik progress satırını güvenle oluşturur. */
create or replace function public.ensure_user_progress(target_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_progress (user_id)
  values (target_user)
  on conflict (user_id) do nothing;
$$;

revoke all on function public.ensure_user_progress(uuid) from public;
revoke all on function public.ensure_user_progress(uuid) from anon;
revoke all on function public.ensure_user_progress(uuid) from authenticated;

-- Yeni kullanıcı akışına progress satırı eklenir. Profil oluşturma mantığı
-- birebir korunur; yalnızca ikinci bir insert eklenir.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Sporcu'
    )
  )
  on conflict (id) do nothing;

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Mevcut kullanıcılar: seviye 1 / XP 0 / gül 0. Var olan satırlar korunur.
insert into public.user_progress (user_id)
select u.id from auth.users as u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Ödül yazımının tek noktası
-- ---------------------------------------------------------------------------

/**
 * Tek bir ödülü defterle toplamı AYNI transaction içinde yazar.
 *
 * Defter satırı yazılamazsa (aynı olay zaten ödüllendirilmiş) toplam da
 * değişmez ve 0 döner. Bu fonksiyon istemciye açılmaz; yalnızca aşağıdaki
 * `security definer` RPC'ler çağırır.
 */
create or replace function public.record_reward(
  target_user uuid,
  target_event_type text,
  target_source_key text,
  target_xp integer,
  target_rose integer,
  target_date date,
  target_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reward_ledger (
    user_id, event_type, source_key, xp_delta, rose_delta, awarded_for_date, metadata
  )
  values (
    target_user, target_event_type, target_source_key,
    greatest(target_xp, 0), greatest(target_rose, 0), target_date, target_metadata
  )
  on conflict (user_id, event_type, source_key) do nothing;

  -- Zaten ödüllendirilmiş: başarıyla dön, hiçbir toplam değişmesin.
  if not found then
    return 0;
  end if;

  if target_xp > 0 or target_rose > 0 then
    update public.user_progress
    set lifetime_xp = lifetime_xp + greatest(target_xp, 0),
        rose_balance = rose_balance + greatest(target_rose, 0)
    where user_id = target_user;
  end if;

  return greatest(target_xp, 0);
end;
$$;

revoke all on function public.record_reward(uuid, text, text, integer, integer, date, jsonb) from public;
revoke all on function public.record_reward(uuid, text, text, integer, integer, date, jsonb) from anon;
revoke all on function public.record_reward(uuid, text, text, integer, integer, date, jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- 5) Disiplin durumunun SUNUCU tarafında yeniden hesaplanması
-- ---------------------------------------------------------------------------

/**
 * Bir TARİH ARALIĞININ otomatik disiplin durumu — bu dosyadaki **tek**
 * disiplin uygulaması.
 *
 * `utils/workout-schedule.ts` içindeki `getScheduledDisciplineStatus` ile
 * birebir aynı kuralları uygular:
 *   * aktif program yoksa hiç satır dönmez (durum yok)
 *   * tarih `active_from`'dan önceyse → durum yok
 *   * o hafta gününe planlanmış program günü yoksa → durum yok
 *     (`program_days` üzerinde `unique (program_id, scheduled_weekday)` olduğu
 *     için hafta gününe düşen en fazla BİR gün vardır)
 *   * gün off day ise → 'completed' (set aranmaz)
 *   * hedef set toplamı 0 ise → durum yok
 *   * bütün hedef setler tamamlanmışsa → 'completed', kısmen → 'partial',
 *     hiç yoksa → durum yok
 *
 * `manual_discipline_statuses` bilinçli olarak OKUNMAZ: o tablo istemciye açık
 * yazma izni verdiği için ödül kaynağı olamaz (dosya başındaki ürün kararı).
 *
 * Aralık tabanlı olması PERFORMANS gereğidir: streak, kaçırılmış gün taraması
 * ve haftalık yeşil gün sayımı gün gün sorgu atmak yerine tek sorguda çözülür.
 */
create or replace function public.auto_discipline_range(
  target_user uuid,
  from_date date,
  to_date date
)
returns table (discipline_date date, status text, is_off_day boolean, off_day_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with active_program as (
    select p.id, p.active_from
    from public.programs as p
    where p.owner_id = target_user and p.is_active
    limit 1
  ),
  off_day_total as (
    select coalesce((
      select count(*)::integer
      from public.program_days as pd
      join active_program as ap on ap.id = pd.program_id
      where pd.is_off_day
    ), 0) as off_days
  ),
  calendar as (
    select generated::date as day_date
    from generate_series(from_date::timestamp, to_date::timestamp, interval '1 day') as generated
  ),
  -- Aralıktaki bütün tamamlanmış setler TEK aggregate ile okunur.
  set_counts as (
    select
      s.workout_date as day_date,
      ws.program_exercise_id as exercise_id,
      count(*)::integer as completed_count
    from public.workout_sets as ws
    join public.workout_sessions as s on s.id = ws.session_id
    where s.user_id = target_user
      and s.workout_date between from_date and to_date
      and ws.program_exercise_id is not null
    group by s.workout_date, ws.program_exercise_id
  ),
  scheduled as (
    select
      c.day_date,
      ap.active_from,
      pd.id as day_id,
      coalesce(pd.is_off_day, false) as day_is_off
    from calendar as c
    cross join active_program as ap
    left join public.program_days as pd
      on pd.program_id = ap.id
     and pd.scheduled_weekday = extract(dow from c.day_date)::smallint
  ),
  -- Korelasyonlu alt sorgu yerine tek join + aggregate: aralık yıllara
  -- uzasa bile gün başına ayrı sorgu üretilmez.
  totals as (
    select
      sc.day_date,
      sc.active_from,
      sc.day_id,
      sc.day_is_off,
      coalesce(sum(e.target_sets), 0)::integer as total_target,
      coalesce(sum(least(coalesce(cnt.completed_count, 0), e.target_sets)), 0)::integer as total_done
    from scheduled as sc
    left join public.program_exercises as e on e.program_day_id = sc.day_id
    left join set_counts as cnt on cnt.exercise_id = e.id and cnt.day_date = sc.day_date
    group by sc.day_date, sc.active_from, sc.day_id, sc.day_is_off
  )
  select
    t.day_date,
    case
      when t.day_id is null then null
      when t.day_date < t.active_from then null
      when t.day_is_off then 'completed'::text
      when t.total_target = 0 then null
      when t.total_done >= t.total_target then 'completed'
      when t.total_done > 0 then 'partial'
      else null
    end,
    t.day_is_off,
    (select off_days from off_day_total)
  from totals as t
  order by t.day_date;
$$;

revoke all on function public.auto_discipline_range(uuid, date, date) from public;
revoke all on function public.auto_discipline_range(uuid, date, date) from anon;
revoke all on function public.auto_discipline_range(uuid, date, date) from authenticated;

/** Tek günlük kısayol. Kuralların ikinci bir kopyası DEĞİLDİR. */
create or replace function public.resolve_auto_day(target_user uuid, target_date date)
returns table (status text, is_off_day boolean, off_day_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.status, r.is_off_day, r.off_day_count
  from public.auto_discipline_range(target_user, target_date, target_date) as r;
$$;

revoke all on function public.resolve_auto_day(uuid, date) from public;
revoke all on function public.resolve_auto_day(uuid, date) from anon;
revoke all on function public.resolve_auto_day(uuid, date) from authenticated;

/** Aktif programdaki haftalık off day sayısına göre off day başına ödül. */
create or replace function public.off_day_reward_amount(off_days integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when off_days <= 2 then 10
    when off_days = 3 then 8
    when off_days = 4 then 6
    when off_days = 5 then 3
    when off_days = 6 then 1
    else 0
  end;
$$;

do $$
begin
  assert public.off_day_reward_amount(1) = 10;
  assert public.off_day_reward_amount(2) = 10;
  assert public.off_day_reward_amount(3) = 8;
  assert public.off_day_reward_amount(4) = 6;
  assert public.off_day_reward_amount(5) = 3;
  assert public.off_day_reward_amount(6) = 1;
  assert public.off_day_reward_amount(7) = 0;
end;
$$;

/**
 * Verilen tarihten geriye doğru aktif seri.
 *
 * `utils/discipline.ts` içindeki `calculateDisciplineStreak` ile aynı kuralı
 * uygular: 'completed' VEYA 'partial' gün seriyi sürdürür, ilk boşlukta durur.
 * Yeşil off day'ler de 'completed' olduğu için seriyi sürdürür.
 *
 * **Seride üst sınır yoktur.** 401 günlük geçerli seri 401, 750 günlük seri
 * 750 döndürür. Sabit 400/366 gibi bir pencere kullanılmaz; doğal alt sınır
 * aktif programın `active_from` tarihidir — ondan önceki günlerin otomatik
 * durumu zaten null olduğu için seri oraya kadar uzayabilir, daha ötesine
 * uzayamaz. Pencere ne kadar uzun olursa olsun TEK küme tabanlı sorguyla
 * okunur; gün başına ayrı sorgu üretilmez.
 */
create or replace function public.resolve_auto_streak(target_user uuid, from_date date)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Pencere PARÇA PARÇA geriye okunur: maliyet serinin gerçek uzunluğuyla
  -- orantılıdır, programın yaşıyla değil. Seri 1 günse tek küçük sorgu yeter;
  -- 750 günse 9 parça okunur. Seride ÜST SINIR yoktur.
  chunk_size constant integer := 90;
  streak_floor date;
  window_end date;
  window_start date;
  day_statuses text[];
  streak integer := 0;
  position_index integer;
  is_broken boolean := false;
begin
  select p.active_from into streak_floor
  from public.programs as p
  where p.owner_id = target_user and p.is_active
  limit 1;

  if streak_floor is null or streak_floor > from_date then
    return 0;
  end if;

  window_end := from_date;

  loop
    window_start := greatest(streak_floor, window_end - (chunk_size - 1));

    select array_agg(r.status order by r.discipline_date desc)
    into day_statuses
    from public.auto_discipline_range(target_user, window_start, window_end) as r;

    exit when day_statuses is null;

    for position_index in 1..array_length(day_statuses, 1) loop
      if day_statuses[position_index] is null
        or day_statuses[position_index] not in ('completed', 'partial') then
        is_broken := true;
        exit;
      end if;
      streak := streak + 1;
    end loop;

    exit when is_broken;
    exit when window_start <= streak_floor;
    window_end := window_start - 1;
  end loop;

  return streak;
end;
$$;

revoke all on function public.resolve_auto_streak(uuid, date) from public;
revoke all on function public.resolve_auto_streak(uuid, date) from anon;
revoke all on function public.resolve_auto_streak(uuid, date) from authenticated;

/**
 * Bir TARİHİN gün/off-day temel ödülü + streak bonusu — tek, istemciye kapalı,
 * tekrar kullanılabilir yardımcı.
 *
 * Hem `sync_workout_rewards` (set kaydından sonra) hem `claim_daily_rewards`
 * (kaçırılmış günler için) bunu çağırır; böylece off day gibi HİÇ set
 * içermeyen günler de ödüllendirilir.
 *
 * Değişmezler:
 *   * antrenman günü ve off day aynı `event_type` + aynı `source_key`'i
 *     paylaşır → aynı tarihte ikisi birden alınamaz;
 *   * aynı kullanıcı/tarih için idempotenttir; tekrar çağrılması toplamı
 *     değiştirmez;
 *   * gün ödülü yazılmış ama streak'i eksik kalmış bir tarih (ör. önceki
 *     çağrıda ağ/işlem hatası) sonraki çağrıda TAMAMLANIR, çünkü streak'in
 *     varlığı doğrudan defterden kontrol edilir;
 *   * tutarların hiçbiri istemciden gelmez.
 */
create or replace function public.reconcile_day_rewards(target_user uuid, target_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Skaler hedefler bilinçli: `resolve_auto_day` hiç satır döndürmediğinde
  -- (aktif program yok) `select into` bunlara NULL yazar. `record` hedefi
  -- aynı durumda "record is not assigned yet" hatası riski taşırdı.
  day_status text;
  day_is_off boolean;
  day_off_count integer;
  day_xp integer;
  streak_value integer;
  awarded integer := 0;
begin
  select d.status, d.is_off_day, d.off_day_count
  into day_status, day_is_off, day_off_count
  from public.resolve_auto_day(target_user, target_date) as d;

  if day_status is distinct from 'completed' then
    return 0;
  end if;

  if coalesce(day_is_off, false) then
    day_xp := public.off_day_reward_amount(coalesce(day_off_count, 0));
  else
    day_xp := 10;
  end if;

  awarded := awarded + public.record_reward(
    target_user, 'day', target_date::text, day_xp, day_xp, target_date,
    jsonb_build_object(
      'kind', case when coalesce(day_is_off, false) then 'off_day' else 'workout_day' end,
      'off_day_count', coalesce(day_off_count, 0)
    )
  );

  -- Streak, tarih başına bir kez. Varlık DOĞRUDAN defterden kontrol edilir:
  -- `record_reward` 0 döndüğünde bunun "zaten yazılmış" mı yoksa "tutar
  -- gerçekten 0" mu olduğu ayırt edilemez (7 off day'li programda gün ödülü
  -- meşru biçimde 0'dır). Bu kontrol eksik kalmış streak'i de tamamlar.
  if not exists (
    select 1 from public.reward_ledger as rl
    where rl.user_id = target_user
      and rl.event_type = 'streak'
      and rl.source_key = target_date::text
  ) then
    streak_value := public.resolve_auto_streak(target_user, target_date);
    if streak_value > 0 then
      awarded := awarded + public.record_reward(
        target_user, 'streak', target_date::text, streak_value, streak_value, target_date,
        jsonb_build_object('streak', streak_value)
      );
    end if;
  end if;

  return awarded;
end;
$$;

revoke all on function public.reconcile_day_rewards(uuid, date) from public;
revoke all on function public.reconcile_day_rewards(uuid, date) from anon;
revoke all on function public.reconcile_day_rewards(uuid, date) from authenticated;

/**
 * Bir tarih ARALIĞINDAKİ bekleyen gün/off-day + streak ödüllerini uzlaştırır.
 *
 * Tek uygulama; üç yerden çağrılır:
 *   * `claim_daily_rewards` — her yeni yerel günün ilk açılışında,
 *   * `activate_program`    — program DEĞİŞMEDEN ÖNCE, eski program penceresi
 *                             için (yoksa o günler geri dönülemez biçimde
 *                             görünmez olurdu),
 *   * `programs` BEFORE DELETE tetikleyicisi — aktif program silinmeden önce.
 *
 * Tüketilmiş tarihler daha SQL katmanında elenir; pahalı olan streak hesabı
 * yalnızca gerçekten ödüllendirilecek tarihler için çalışır.
 *
 * `max_days` tek çağrıda uzlaştırılacak en fazla ADAY GÜN sayısıdır — bir hak
 * kaybı sınırı DEĞİL, tek transaction'ın sınırsız büyümesini engelleyen bir
 * emniyet valfidir.
 *
 * `has_more` **tahminle değil, kesin olarak** belirlenir: sorgu `max_days + 1`
 * aday okur ama en fazla `max_days` tanesini işler. Fazladan bir satır geldiyse
 * gerçekten devam vardır. `processed = max_days` varsayımı yanlış olurdu —
 * tam olarak `max_days` aday bulunup devamı olmayan durumda `has_more` yanlış
 * biçimde `true` dönerdi.
 *
 * Batch dolarsa `reconciled_through` işlenen son tarihte kalır; çağıran ya
 * imleci oraya kadar ilerletir (normal claim) ya da `has_more` false olana
 * kadar döngüyü sürdürür (program değişimi/silme). Hiçbir gün düşmez.
 */
drop function if exists public.reconcile_pending_days(uuid, date, date, integer);
create or replace function public.reconcile_pending_days(
  target_user uuid,
  from_date date,
  to_date date,
  max_days integer default 400
)
returns table (awarded_xp integer, reconciled_through date, has_more boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  awarded integer := 0;
  processed integer := 0;
  batch_limit integer := greatest(coalesce(max_days, 1), 1);
  last_date date;
  overflow boolean := false;
begin
  if target_user is null or from_date is null or to_date is null or from_date > to_date then
    awarded_xp := 0;
    reconciled_through := to_date;
    has_more := false;
    return next;
    return;
  end if;

  for candidate in
    select r.discipline_date
    from public.auto_discipline_range(target_user, from_date, to_date) as r
    where r.status = 'completed'
      -- Gün ödülü VEYA streak bonusu eksikse tarih yeniden uzlaştırılır.
      -- Yeşil bir tarihin streak'i her zaman en az 1'dir, bu yüzden tamamen
      -- uzlaştırılmış tarihler bir daha buraya düşmez.
      and (
        not exists (
          select 1 from public.reward_ledger as rl
          where rl.user_id = target_user
            and rl.event_type = 'day'
            and rl.source_key = r.discipline_date::text
        )
        or not exists (
          select 1 from public.reward_ledger as rl
          where rl.user_id = target_user
            and rl.event_type = 'streak'
            and rl.source_key = r.discipline_date::text
        )
      )
    order by r.discipline_date
    -- BİR fazla okunur; fazladan gelen satır İŞLENMEZ, yalnızca "devamı var"
    -- bilgisini kesinleştirir.
    limit batch_limit + 1
  loop
    if processed >= batch_limit then
      overflow := true;
      exit;
    end if;
    awarded := awarded + public.reconcile_day_rewards(target_user, candidate.discipline_date);
    processed := processed + 1;
    last_date := candidate.discipline_date;
  end loop;

  awarded_xp := awarded;
  has_more := overflow;

  if overflow then
    -- Yalnızca işlenen son tarihe kadar kesinleşti.
    reconciled_through := coalesce(last_date, from_date - 1);
  else
    reconciled_through := to_date;
  end if;

  return next;
end;
$$;

revoke all on function public.reconcile_pending_days(uuid, date, date, integer) from public;
revoke all on function public.reconcile_pending_days(uuid, date, date, integer) from anon;
revoke all on function public.reconcile_pending_days(uuid, date, date, integer) from authenticated;

/**
 * Bir aralığı **sonuna kadar** uzlaştırır: `has_more` false olana dek batch
 * batch ilerler.
 *
 * Program değişimi ve aktif program silinmesi bu yolu kullanır, çünkü o iki
 * işlemden sonra eski dönem otomatik hesapta görünmez olur — tek batch işlenip
 * kalanların bırakılması geri dönülemez hak kaybı demektir.
 *
 * Güvenlik: her turda başlangıç tarihi İLERLEMEK zorundadır. İlerleme olmazsa
 * veya tur sayısı sınırı aşılırsa transaction sessizce devam etmez, **hata
 * verir**; böylece çağıran işlem (program kapatma/silme) da geri alınır ve
 * hiçbir gün kaybolmaz. Aynı ödül defter idempotency'si sayesinde ikinci kez
 * yazılmaz.
 */
create or replace function public.reconcile_pending_days_all(
  target_user uuid,
  from_date date,
  to_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_from date := from_date;
  previous_from date;
  batch_awarded integer;
  batch_through date;
  batch_has_more boolean;
  awarded integer := 0;
  guard integer := 0;
begin
  if target_user is null or from_date is null or to_date is null or from_date > to_date then
    return 0;
  end if;

  loop
    guard := guard + 1;
    if guard > 500 then
      raise exception 'reconciliation_incomplete' using errcode = '55000';
    end if;

    select r.awarded_xp, r.reconciled_through, r.has_more
    into batch_awarded, batch_through, batch_has_more
    from public.reconcile_pending_days(target_user, batch_from, to_date) as r;

    awarded := awarded + coalesce(batch_awarded, 0);

    exit when not coalesce(batch_has_more, false);

    previous_from := batch_from;
    batch_from := coalesce(batch_through, previous_from) + 1;

    -- Açık ilerleme guard'ı: sonsuz döngü yerine kontrollü hata.
    if batch_from <= previous_from then
      raise exception 'reconciliation_stalled' using errcode = '55000';
    end if;
  end loop;

  return awarded;
end;
$$;

revoke all on function public.reconcile_pending_days_all(uuid, date, date) from public;
revoke all on function public.reconcile_pending_days_all(uuid, date, date) from anon;
revoke all on function public.reconcile_pending_days_all(uuid, date, date) from authenticated;

-- ---------------------------------------------------------------------------
-- 6) İstemciye açık ödül RPC'leri
-- ---------------------------------------------------------------------------

/**
 * İstemcinin YEREL günü sunucunun UTC gününden en fazla bir gün sapabilir.
 * `sync_shared_discipline_days` ile aynı doğrulama; istemci pencereyi keyfî
 * biçimde ileri/geri kaydıramaz.
 */
create or replace function public.assert_client_today(client_today date)
returns void
language plpgsql
-- `current_date` okunduğu için IMMUTABLE olamaz: STABLE doğru sınıftır.
stable
set search_path = ''
as $$
begin
  if client_today is null
    or client_today < current_date - 1
    or client_today > current_date + 1 then
    raise exception 'invalid_client_date' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.assert_client_today(date) from public;
revoke all on function public.assert_client_today(date) from anon;
revoke all on function public.assert_client_today(date) from authenticated;

/**
 * Antrenman kaynaklı bütün ödülleri TEK transaction'da uzlaştırır:
 * tamamlanan setler + gün/off-day temel ödülü + streak bonusu.
 *
 * İstemci yalnızca hangi günün uzlaştırılacağını söyler; tutarların hepsini
 * sunucu kendi verisinden hesaplar. Yeniden çağrılması güvenlidir ve hiçbir
 * ödülü ikinci kez yazmaz — bu yüzden ağ tekrarı, çift dokunma ve eşzamanlı
 * istekler tek ödül üretir.
 *
 * Set kimliği `tarih:program_exercise_id:set_number` mantıksal üçlüsüdür,
 * `workout_sets.id` DEĞİL: geri alma satırı sildiği için yeniden tamamlama
 * yeni bir uuid üretir ve id kullanılsaydı aynı set ikinci kez ödüllendirilirdi.
 */
create or replace function public.sync_workout_rewards(client_today date, target_date date)
returns table (
  awarded_xp integer,
  awarded_roses integer,
  lifetime_xp integer,
  rose_balance integer,
  level integer,
  xp_into_level integer,
  xp_for_next integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  total_xp integer := 0;
  set_row record;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform public.assert_client_today(client_today);

  -- Gece yarısını aşan antrenmanlar için dünü de kabul et; daha eskisi
  -- kabul edilmez, böylece istemci geçmişi toplu ödüle çeviremez.
  if target_date is null or target_date > client_today or target_date < client_today - 1 then
    raise exception 'invalid_target_date' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8021));
  perform public.ensure_user_progress(actor);

  -- 1) Tamamlanan setler: +3 XP / +3 gül.
  for set_row in
    select ws.program_exercise_id, ws.set_number
    from public.workout_sets as ws
    join public.workout_sessions as s on s.id = ws.session_id
    where s.user_id = actor
      and s.workout_date = target_date
      and ws.program_exercise_id is not null
    order by ws.program_exercise_id, ws.set_number
  loop
    total_xp := total_xp + public.record_reward(
      actor,
      'set',
      target_date::text || ':' || set_row.program_exercise_id::text || ':' || set_row.set_number::text,
      3, 3, target_date,
      jsonb_build_object('program_exercise_id', set_row.program_exercise_id, 'set_number', set_row.set_number)
    );
  end loop;

  -- 2) Gün/off-day temel ödülü + streak bonusu AYNI transaction içinde, ortak
  --    yardımcıyla. Son sette set + gün + streak tek cevapta döner; birbiriyle
  --    yarışan üç istemci isteği oluşmaz.
  total_xp := total_xp + public.reconcile_day_rewards(actor, target_date);

  return query
  select
    total_xp,
    total_xp,
    up.lifetime_xp,
    up.rose_balance,
    lp.level,
    lp.xp_into_level,
    lp.xp_for_next
  from public.user_progress as up
  cross join lateral public.level_progress(up.lifetime_xp) as lp
  where up.user_id = actor;
end;
$$;

revoke all on function public.sync_workout_rewards(date, date) from public;
revoke all on function public.sync_workout_rewards(date, date) from anon;
grant execute on function public.sync_workout_rewards(date, date) to authenticated;

/**
 * Günlük giriş ödülü + kaçırılmış gün uzlaştırması + kapanmış hafta ödülleri.
 *
 * Kullanıcı uygulamayı her yeni yerel günde (ve aynı gün içinde başarısız kalan
 * denemelerde ön plana dönüşte) buraya uğrar. Üç iş yapar:
 *
 *  1. **Günlük giriş** — takvim günü başına bir kez, yalnızca doğrulanmış
 *     hesap. Anahtar tarihtir; iki cihazdan aynı anda girmek tek ödül verir ve
 *     ağ hatası sonrası tekrar denemek ikinci ödül yazmaz.
 *
 *  2. **Kaçırılmış günler** — `sync_workout_rewards` yalnızca set kaydından
 *     sonra çalıştığı için off day gibi HİÇ set içermeyen günler o yoldan
 *     uzlaştırılamaz. Burada sunucu bekleyen `completed` günleri kendi bulur.
 *
 *  3. **Kapanmış haftalar** — Pazartesi–Pazar. İçinde bulunulan açık hafta
 *     ödüllendirilmez.
 *
 * TARİH SINIRLARI — hepsi sunucuda belirlenir; istemci aralık seçemez:
 *
 *   günler  alt sınır = max(user_progress.created_at,
 *                           aktif programın active_from,
 *                           days_reconciled_through + 1)
 *           üst sınır = client_today
 *
 *   haftalar alt sınır = weeks_reconciled_through + 7, yoksa progression'ın
 *                        başladığı haftanın PAZARTESİSİ
 *            üst sınır = son KAPANMIŞ haftanın pazartesisi
 *
 * **Zaman aşımına dayalı hak kaybı YOKTUR.** Eski sürümdeki `client_today - 366`
 * tabanı ve "son dört hafta" sınırı kaldırıldı: bir yıldan uzun süre uygulamayı
 * açmayan kullanıcının progression başlangıcından sonraki bütün kazanılmış
 * günleri ve haftaları sonraki açılışta uzlaştırılır. İmleçler yalnızca "buraya
 * kadar zaten bakıldı" bilgisidir; hiçbir hafta sessizce düşmez.
 *
 * İlk KISMİ hafta atlanmaz: hafta taraması progression'ın başladığı haftanın
 * pazartesisinden başlar, ama o haftanın yeşil gün sayısı `day` defterinden
 * okunduğu için progression'dan ÖNCEKİ günler sayıya giremez. Çarşamba başlayan
 * progression'ın çarşamba–pazar aralığında 3 yeşil günü varsa ilk pazartesi
 * açılışında +3 verilir.
 *
 * Haftalık yeşil gün sayısı canlı yeniden hesapla DEĞİL, sunucunun daha önce
 * doğrulayıp yazdığı **değişmez `day` defter kayıtlarıyla** bulunur. Bu, aktif
 * program değiştiğinde geçmiş haftanın 0'a düşüp kalıcı olarak tüketilmesini
 * engeller (bkz. `activate_program` ve `programs` silme tetikleyicisi).
 */
-- Dönüş imzası genişlediği için önce düşürülür (re-run güvenliği).
drop function if exists public.claim_daily_rewards(date);

create or replace function public.claim_daily_rewards(client_today date)
returns table (
  awarded_xp integer,
  awarded_roses integer,
  lifetime_xp integer,
  rose_balance integer,
  level integer,
  xp_into_level integer,
  xp_for_next integer,
  /**
   * `true` → gün veya hafta tarafında HÂLÂ uzlaştırılmamış iş var (batch
   * sınırına takıldı). İstemci bu günü tamamlanmış saymaz; sonraki
   * background→foreground geçişi kaldığı yerden devam eder. Polling kurulmaz.
   */
  reconciliation_pending boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  total_xp integer := 0;
  is_verified boolean;
  progress_start date;
  program_start date;
  day_cursor date;
  week_cursor date;
  scan_start date;
  day_awarded integer;
  day_done_through date;
  day_has_more boolean;
  week_pending boolean := false;
  new_day_cursor date;
  week_scan_start date;
  current_week_start date;
  covered_week_start date;
  last_closed_week_start date;
  week_row record;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform public.assert_client_today(client_today);
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8021));
  perform public.ensure_user_progress(actor);

  select (u.email_confirmed_at is not null) into is_verified
  from auth.users as u
  where u.id = actor;

  -- 1) Günlük giriş.
  if coalesce(is_verified, false) then
    total_xp := total_xp + public.record_reward(
      actor, 'daily_login', client_today::text, 5, 5, client_today, null
    );
  end if;

  select
    up.created_at::date,
    up.days_reconciled_through,
    up.weeks_reconciled_through
  into progress_start, day_cursor, week_cursor
  from public.user_progress as up
  where up.user_id = actor;

  select p.active_from into program_start
  from public.programs as p
  where p.owner_id = actor and p.is_active
  limit 1;

  -- 2) Kaçırılmış günler (off day dâhil).
  scan_start := greatest(
    coalesce(progress_start, client_today),
    coalesce(program_start, client_today),
    coalesce(day_cursor + 1, coalesce(progress_start, client_today))
  );

  select r.awarded_xp, r.reconciled_through, r.has_more
  into day_awarded, day_done_through, day_has_more
  from public.reconcile_pending_days(actor, scan_start, client_today) as r;

  total_xp := total_xp + coalesce(day_awarded, 0);

  -- İmleç iki şeyin EN KÜÇÜĞÜNE kadar ilerler:
  --   * uzlaştırmanın gerçekten bitirdiği tarih (batch yarım kalmış olabilir),
  --   * `client_today - 2` — bugün ve dün hâlâ değişebilir, çünkü
  --     `sync_workout_rewards` dünü de kabul eder.
  -- İmleç asla geriye gitmez; kalan günler sonraki açılışta devam eder.
  new_day_cursor := least(coalesce(day_done_through, client_today), client_today - 2);
  update public.user_progress as up
  set days_reconciled_through = new_day_cursor
  where up.user_id = actor
    and (up.days_reconciled_through is null or up.days_reconciled_through < new_day_cursor);

  -- 3) Kapanmış haftalar. Hafta pazartesi başlar, pazar biter.
  --
  -- Hizalama GERİYE doğrudur: progression'ın başladığı haftanın pazartesisi
  -- alınır. İleri hizalama yapılsaydı çarşamba başlayan progression'ın ilk
  -- kısmi haftası sonsuza kadar atlanırdı.
  week_scan_start := coalesce(
    week_cursor + 7,
    coalesce(progress_start, client_today)
      - (extract(isodow from coalesce(progress_start, client_today))::integer - 1)
  );

  current_week_start := client_today - (extract(isodow from client_today)::integer - 1);

  -- Haftalık sayım `day` defterine dayandığı için bir hafta ancak GÜN
  -- uzlaştırması o haftanın tamamını kapsadıysa tüketilebilir. Aksi hâlde
  -- yarım kalmış bir batch haftayı eksik sayıyla KALICI olarak tüketirdi.
  covered_week_start := coalesce(day_done_through, client_today)
    - (extract(isodow from coalesce(day_done_through, client_today))::integer - 1);
  if coalesce(day_done_through, client_today) < covered_week_start + 6 then
    covered_week_start := covered_week_start - 7;
  end if;

  last_closed_week_start := least(current_week_start - 7, covered_week_start);

  if last_closed_week_start >= week_scan_start then
    for week_row in
      select
        weeks.week_start,
        (
          -- Yeşil gün sayısı, sunucunun daha önce DOĞRULAYIP yazdığı değişmez
          -- `day` kayıtlarından gelir. Yeşil off day'lerin de `day` kaydı
          -- olduğu için onlar da sayılır. Progression öncesi günlerin kaydı
          -- olmadığı için ilk kısmi hafta doğal olarak doğru sayılır.
          select count(*)::integer
          from public.reward_ledger as rl
          where rl.user_id = actor
            and rl.event_type = 'day'
            and rl.awarded_for_date between weeks.week_start and weeks.week_start + 6
        ) as green_days
      from (
        select generated::date as week_start
        from generate_series(
          week_scan_start::timestamp,
          last_closed_week_start::timestamp,
          interval '7 day'
        ) as generated
      ) as weeks
      where not exists (
        select 1 from public.reward_ledger as rl
        where rl.user_id = actor
          and rl.event_type = 'weekly'
          and rl.source_key = weeks.week_start::text
      )
      order by weeks.week_start
    loop
      -- Sıfır yeşil günlü hafta da deftere yazılır: hafta TÜKETİLİR ve bir
      -- daha hesaplanmaz. Toplamlar değişmez.
      total_xp := total_xp + public.record_reward(
        actor, 'weekly', week_row.week_start::text,
        week_row.green_days, week_row.green_days, week_row.week_start + 6,
        jsonb_build_object('green_days', week_row.green_days)
      );
    end loop;

    update public.user_progress as up
    set weeks_reconciled_through = last_closed_week_start
    where up.user_id = actor
      and (up.weeks_reconciled_through is null
        or up.weeks_reconciled_through < last_closed_week_start);
  end if;

  -- Gün kapsaması yetmediği için tüketilemeyen kapalı hafta kaldı mı?
  if (current_week_start - 7) >= week_scan_start
    and last_closed_week_start < (current_week_start - 7) then
    week_pending := true;
  end if;

  return query
  select
    total_xp,
    total_xp,
    up.lifetime_xp,
    up.rose_balance,
    lp.level,
    lp.xp_into_level,
    lp.xp_for_next,
    coalesce(day_has_more, false) or week_pending
  from public.user_progress as up
  cross join lateral public.level_progress(up.lifetime_xp) as lp
  where up.user_id = actor;
end;
$$;

revoke all on function public.claim_daily_rewards(date) from public;
revoke all on function public.claim_daily_rewards(date) from anon;
grant execute on function public.claim_daily_rewards(date) to authenticated;

/**
 * Rosea okşama burst'ü: +1 XP / +1 gül.
 *
 * ÜRÜN KARARI — günlük, haftalık veya toplam SINIR YOKTUR. Burada yalnızca
 * aynı burst'ün ağ tekrarı `burst_key` ile tekilleştirilir; yeni ve gerçek her
 * burst yeni bir anahtar taşır ve ayrı bir ödüldür.
 */
create or replace function public.award_pet_love(burst_key uuid)
returns table (
  awarded_xp integer,
  awarded_roses integer,
  lifetime_xp integer,
  rose_balance integer,
  level integer,
  xp_into_level integer,
  xp_for_next integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  total_xp integer := 0;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if burst_key is null then
    raise exception 'invalid_burst_key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8021));
  perform public.ensure_user_progress(actor);

  total_xp := public.record_reward(actor, 'pet', burst_key::text, 1, 1, null, null);

  return query
  select
    total_xp,
    total_xp,
    up.lifetime_xp,
    up.rose_balance,
    lp.level,
    lp.xp_into_level,
    lp.xp_for_next
  from public.user_progress as up
  cross join lateral public.level_progress(up.lifetime_xp) as lp
  where up.user_id = actor;
end;
$$;

revoke all on function public.award_pet_love(uuid) from public;
revoke all on function public.award_pet_love(uuid) from anon;
grant execute on function public.award_pet_love(uuid) to authenticated;

/** Kendi ilerlemem. Seviye sunucuda hesaplanır; istemci yalnızca gösterir. */
create or replace function public.get_my_progress()
returns table (
  lifetime_xp integer,
  rose_balance integer,
  level integer,
  xp_into_level integer,
  xp_for_next integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform public.ensure_user_progress(actor);

  return query
  select up.lifetime_xp, up.rose_balance, lp.level, lp.xp_into_level, lp.xp_for_next
  from public.user_progress as up
  cross join lateral public.level_progress(up.lifetime_xp) as lp
  where up.user_id = actor;
end;
$$;

revoke all on function public.get_my_progress() from public;
revoke all on function public.get_my_progress() from anon;
grant execute on function public.get_my_progress() to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Arkadaş profiline YALNIZCA seviye bilgisi eklenir
-- ---------------------------------------------------------------------------

-- Dönüş tipi genişlediği için önce düşürülür; gövde ve güvenlik koşulu aynı.
-- `rose_balance` ve `reward_ledger` HİÇBİR koşulda paylaşılmaz.
drop function if exists public.get_friend_profile(uuid);

create or replace function public.get_friend_profile(target_user_id uuid)
returns table (
  id uuid,
  display_name text,
  username text,
  bio text,
  avatar_url text,
  banner_url text,
  training_goal text,
  level integer,
  xp_into_level integer,
  xp_for_next integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    p.username,
    p.bio,
    p.avatar_url,
    p.banner_url,
    p.training_goal,
    coalesce(lp.level, 1),
    coalesce(lp.xp_into_level, 0),
    coalesce(lp.xp_for_next, public.level_step_cost(1))
  from public.profiles as p
  left join public.user_progress as up on up.user_id = p.id
  left join lateral public.level_progress(coalesce(up.lifetime_xp, 0)) as lp on true
  where (select auth.uid()) is not null
    and p.id = target_user_id
    and public.are_friends((select auth.uid()), target_user_id);
$$;

revoke all on function public.get_friend_profile(uuid) from public;
revoke all on function public.get_friend_profile(uuid) from anon;
grant execute on function public.get_friend_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Aktif program DEĞİŞTİĞİNDE veya SİLİNDİĞİNDE geçmişin korunması
-- ---------------------------------------------------------------------------

/**
 * KÖK NEDEN
 *
 * `auto_discipline_range` geçmiş tarihleri her zaman **o an aktif olan**
 * programa göre hesaplar ve `active_from`'dan önceki tarihler için durum
 * üretmez. `activate_program` yeni programın `active_from` değerini bugüne
 * çektiği için, program değiştiği anda eski programın bütün geçmişi otomatik
 * hesapta görünmez olur. Sonuç:
 *   * eski dönemin henüz uzlaştırılmamış yeşil günleri geri dönülemez biçimde
 *     kaybolurdu,
 *   * geçen haftanın haftalık ödülü 0 hesaplanır ve 0 değerli `weekly` kaydıyla
 *     KALICI olarak tüketilirdi.
 *
 * EN KÜÇÜK GÜVENLİ ÇÖZÜM — iki katman, şema genişletmeden:
 *   1. Haftalık sayım artık canlı yeniden hesaptan değil, sunucunun daha önce
 *      doğrulayıp yazdığı DEĞİŞMEZ `day` defter kayıtlarından gelir
 *      (bkz. `claim_daily_rewards`). Yazılmış geçmiş program değişiminden
 *      etkilenmez.
 *   2. Program değişmeden ve aktif program silinmeden ÖNCE eski programın
 *      bekleyen günleri uzlaştırılır; böylece 1. katmanın okuyacağı kayıtlar
 *      kaybolmadan yazılmış olur.
 *
 * İstemcinin gönderdiği manuel disiplin statüleri hiçbir katmanda okunmaz.
 */

-- Dönüş imzası genişlediği için önce düşürülür.
drop function if exists public.activate_program(uuid);

create or replace function public.activate_program(
  target_program_id uuid,
  client_today date default null
)
returns void
language plpgsql
-- `security definer`: gövde iç uzlaştırma yardımcısını çağırır ve o yardımcı
-- hiçbir role grant edilmemiştir. Sahiplik kontrolleri aşağıda AÇIKÇA yapılır
-- ve bütün yazmalar `owner_id = actor` ile sınırlıdır, bu yüzden RLS'in
-- atlanması yeni bir yetki yüzeyi açmaz.
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  previous_program_start date;
  progress_start date;
  reconciliation_start date;
  reconcile_through date;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.programs as p
    where p.id = target_program_id
      and p.owner_id = actor
  ) then
    raise exception 'Program bulunamadı veya kullanıcıya ait değil.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8021));

  -- Eski programın penceresi HÂLÂ görünürken bekleyen günler uzlaştırılır.
  select p.active_from into previous_program_start
  from public.programs as p
  where p.owner_id = actor and p.is_active
  limit 1;

  if previous_program_start is not null then
    -- İstemci günü yalnızca ±1 gün sapabilir (diğer RPC'lerle aynı duruş);
    -- dışındaysa sunucu günü kullanılır. Tutarları yine sunucu hesapladığı
    -- ve yalnızca gerçekten yeşil günler ödüllendiği için bu üst sınır
    -- keyfî geçmiş ödüle dönüşemez.
    reconcile_through := coalesce(client_today, current_date);
    if reconcile_through < current_date - 1 or reconcile_through > current_date + 1 then
      reconcile_through := current_date;
    end if;

    perform public.ensure_user_progress(actor);

    /**
     * Başlangıç sınırı, normal `claim_daily_rewards` gün taramasıyla AYNI
     * kuralı izler: progression başlamadan önceki dönem ödüllendirilmez.
     *
     * Program, progression sistemi kurulmadan aylar önce aktifleşmiş olabilir.
     * Doğrudan `previous_program_start`'tan başlansaydı kullanıcı program
     * değiştirdiği anda o eski tarihten bugüne kadarki bütün gün/off-day ve
     * streak kayıtları geriye dönük yazılırdı.
     */
    select up.created_at::date into progress_start
    from public.user_progress as up
    where up.user_id = actor;

    -- `coalesce` bilinçli: Postgres'te `greatest` NULL'ları yok sayar, yani
    -- `greatest(active_from, null)` eski (hatalı) sınırı geri getirirdi.
    -- Progress satırı okunamazsa en kısıtlayıcı sınıra düşülür.
    reconciliation_start := greatest(previous_program_start, coalesce(progress_start, current_date));

    -- TEK batch DEĞİL: eski program kapatılmadan önce bekleyen bütün günler
    -- sonuna kadar uzlaştırılır. Tamamlanamazsa fonksiyon hata verir ve
    -- program değişimi de geri alınır — sessiz hak kaybı oluşmaz.
    if reconciliation_start is not null and reconciliation_start <= reconcile_through then
      perform public.reconcile_pending_days_all(actor, reconciliation_start, reconcile_through);
    end if;
  end if;

  update public.programs as p
  set is_active = false,
      active_from = null
  where p.owner_id = actor and p.is_active;

  -- `active_from` bilinçli olarak SUNUCU gününde bırakıldı (mevcut davranış):
  -- istemciden gelen tarihe bağlansaydı bir gün geriye çekilerek fazladan gün
  -- ödüllendirilebilirdi.
  update public.programs as p
  set is_active = true,
      active_from = current_date
  where p.id = target_program_id and p.owner_id = actor;
end;
$$;

revoke all on function public.activate_program(uuid, date) from public;
revoke all on function public.activate_program(uuid, date) from anon;
grant execute on function public.activate_program(uuid, date) to authenticated;

/**
 * Aktif program SİLİNMEDEN önce bekleyen günleri uzlaştırır.
 *
 * Program silindiğinde `program_days` / `program_exercises` cascade ile gider
 * ve o dönemin otomatik disiplin hesabı bir daha üretilemez; bu yüzden defter
 * kayıtları silinmeden ÖNCE yazılmalıdır.
 *
 * Kullanıcı hesabı silindiğinde de `programs` cascade ile silinir. O senaryoda
 * `auth.users` satırı çoktan gitmiştir; bu durumda tetikleyici hiçbir şey
 * yapmadan çıkar, aksi hâlde silinmekte olan kullanıcı için defter satırı
 * yazmaya çalışıp hesap silmeyi kilitleyebilirdi.
 */
create or replace function public.reconcile_before_program_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  progress_start date;
  reconciliation_start date;
begin
  if old.is_active
    and old.active_from is not null
    and exists (select 1 from auth.users as u where u.id = old.owner_id)
  then
    perform public.ensure_user_progress(old.owner_id);

    -- Bkz. `activate_program`: başlangıç sınırı progression'ın başladığı
    -- tarihten öncesine inemez, aksi hâlde silme anında progression öncesi
    -- dönem için geriye dönük ödül kaydı yazılırdı.
    select up.created_at::date into progress_start
    from public.user_progress as up
    where up.user_id = old.owner_id;

    -- Bkz. `activate_program`: `greatest` NULL'ları yok saydığı için
    -- `coalesce` ile en kısıtlayıcı sınıra düşülür.
    reconciliation_start := greatest(old.active_from, coalesce(progress_start, current_date));

    -- Program silinmeden önce bekleyen bütün günler sonuna kadar uzlaştırılır.
    -- Tamamlanamazsa hata verir ve SİLME de geri alınır.
    if reconciliation_start is not null and reconciliation_start <= current_date then
      perform public.reconcile_pending_days_all(old.owner_id, reconciliation_start, current_date);
    end if;
  end if;

  return old;
end;
$$;

-- Tetikleyici fonksiyonu istemci RPC yüzeyine açılmaz. Tetikleyici çalışması
-- etkilenmez: tetikleyiciler fonksiyonu tablo sahibinin hakkıyla çağırır.
revoke all on function public.reconcile_before_program_delete() from public;
revoke all on function public.reconcile_before_program_delete() from anon;
revoke all on function public.reconcile_before_program_delete() from authenticated;

drop trigger if exists programs_reconcile_before_delete on public.programs;
create trigger programs_reconcile_before_delete
before delete on public.programs
for each row execute function public.reconcile_before_program_delete();

commit;
