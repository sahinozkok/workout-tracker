/**
 * SEZONLUK RANK SİSTEMİ
 *
 * ÜRÜN AYRIMI
 * -----------
 *   * Level  = kullanıcının ömür boyu XP ilerlemesi   (`user_progress.lifetime_xp`)
 *   * Roses  = ileride kullanılacak para birimi        (`user_progress.rose_balance`)
 *   * Rank   = YALNIZCA sezon içindeki doğrulanmış antrenman disiplini
 *
 * Bu dosya `user_progress`, `reward_ledger`, level eğrisi ve mevcut ödül
 * RPC'lerinin HİÇBİRİNE dokunmaz. Rank ne XP ne gül üretir/tüketir; seviye
 * hesabını etkilemez. Rosea'yı sevmek, günlük giriş, tek tek set tamamlamak,
 * off day ve manuel takvim işaretleri RP ÜRETMEZ.
 *
 * GÜVENLİK MODELİ
 * ---------------
 *   * İstemci RP, rank, starting/final RP veya reset miktarı GÖNDEREMEZ.
 *     Açık RPC'lerin tek parametresi `client_today`'dir ve o da
 *     `public.assert_client_today` ile ±1 güne kilitlidir.
 *   * `rank_seasons`, `user_season_ranks`, `rank_events`, `rank_settings`
 *     tablolarında istemci için insert/update/delete policy'si HİÇ yoktur.
 *     `authenticated` role'üne yalnızca gerekli SELECT grant'i verilir.
 *   * Bütün hesaplama `security definer` + `set search_path = ''` fonksiyonlarda
 *     yapılır; her nesne şema-nitelikli yazılır.
 *   * Sahiplik her açık RPC'de `auth.uid()` ile doğrulanır.
 *   * Kullanıcı başına `pg_advisory_xact_lock` alınır (anahtar 8023 —
 *     ödül sisteminin 8021'i ve sıralamanın 8022'si ile ÇAKIŞMAZ), böylece
 *     eşzamanlı iki sync çift RP üretemez.
 *   * Arkadaşlar rank'ı yalnızca `public.get_friend_rank` üzerinden görür;
 *     o da `public.are_friends` ile korunur ve ham `rank_events` DÖNDÜRMEZ.
 *
 * KAYNAK OTORİTESİ — `rank_day_state`
 * -----------------------------------
 * Rank "doğrulanmış" disiplini ölçtüğü için kendi kanıt fonksiyonunu kullanır:
 *
 *   * `workout_sessions.deleted_at is null` ŞARTI VARDIR. Böylece current
 *     season içinde bir antrenman soft-delete edilirse ona bağlı RP
 *     uzlaştırmada geri alınır.
 *   * Mevcut takvim fonksiyonları (`auto_discipline_range`,
 *     `display_discipline_range`) BİLİNÇLİ olarak değiştirilmedi — antrenman
 *     silmek disiplin takvimini, streak geçmişini veya yazılmış XP ödüllerini
 *     ETKİLEMEZ. Yalnızca rank düzeltilir.
 *   * Donmuş `discipline_day_history` satırları YALNIZCA KİMLİK kaynağıdır
 *     (o gün hangi programa aitti). Tamamlama kanıtı her zaman canlı, silinmemiş
 *     oturumlardan gelir; `status` sütunu rank için hiç okunmaz.
 *
 * RETROAKTİFLİK
 * -------------
 * `rank_settings.rp_epoch` migration'ın uygulandığı gündür. O günden ÖNCEKİ
 * hiçbir tarih RP üretmez. Sezon 1 ise o haftanın PAZARTESİSİNDE başlar, yani
 * ilk sezon kısmi olabilir; bu bilinçlidir (sezonlar her zaman Pazartesi
 * başlar ve 56 gün sürer).
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Rank eşikleri — TEK KAYNAK (istemcideki `constants/ranks.ts` ile eş)
-- ---------------------------------------------------------------------------

/** Rank kimliğinin taban RP'si. Bilinmeyen kimlikte 0. */
create or replace function public.rank_tier_floor(rank_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case rank_id
    when 'bronze' then 0
    when 'silver' then 200
    when 'gold' then 450
    when 'platinum' then 750
    when 'diamond' then 1050
    when 'master' then 1350
    when 'rosea' then 1650
    else 0
  end;
$$;

/** RP → rank kimliği. Negatif ve NULL değerler Bronze'a düşer. */
create or replace function public.rank_for_rp(rp integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(rp, 0) >= 1650 then 'rosea'
    when coalesce(rp, 0) >= 1350 then 'master'
    when coalesce(rp, 0) >= 1050 then 'diamond'
    when coalesce(rp, 0) >= 750 then 'platinum'
    when coalesce(rp, 0) >= 450 then 'gold'
    when coalesce(rp, 0) >= 200 then 'silver'
    else 'bronze'
  end;
$$;

/** Sezon sonu soft reset tabanı. */
create or replace function public.rank_reset_base(rank_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case rank_id
    when 'bronze' then 0
    when 'silver' then 100
    when 'gold' then 300
    when 'platinum' then 600
    when 'diamond' then 900
    when 'master' then 1150
    when 'rosea' then 1450
    else 0
  end;
$$;

/** Soft reset sonucunun aşamayacağı üst sınır. */
create or replace function public.rank_reset_max(rank_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case rank_id
    when 'bronze' then 199
    when 'silver' then 199
    when 'gold' then 449
    when 'platinum' then 749
    when 'diamond' then 1049
    when 'master' then 1349
    when 'rosea' then 1649
    else 199
  end;
$$;

/**
 * SOFT RESET
 *
 *   newRp = min(resetMax, resetBase + floor((finalRp - rankFloor) * 0.20))
 *
 * Örnek: 1850 RP ile Rosea biten kullanıcı → taşma 200 → %20 = 40 →
 * 1450 + 40 = 1490 → yeni sezona Master olarak başlar.
 */
create or replace function public.rank_soft_reset_rp(final_rp integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(
    public.rank_reset_max(public.rank_for_rp(greatest(coalesce(final_rp, 0), 0))),
    public.rank_reset_base(public.rank_for_rp(greatest(coalesce(final_rp, 0), 0)))
      + floor(
          (greatest(coalesce(final_rp, 0), 0)
            - public.rank_tier_floor(public.rank_for_rp(greatest(coalesce(final_rp, 0), 0)))
          ) * 0.20
        )::integer
  );
$$;

-- Eşikler migration'ın KENDİSİ tarafından doğrulanır: yanlışsa migration düşer.
-- Aynı çiftler `constants/ranks.ts` içindeki fixture listelerinde de vardır.
do $$
begin
  assert public.rank_for_rp(-100) = 'bronze', 'negatif RP bronze olmalı';
  assert public.rank_for_rp(0) = 'bronze', 'bronze tabanı';
  assert public.rank_for_rp(199) = 'bronze', 'bronze sınırı';
  assert public.rank_for_rp(200) = 'silver', 'silver eşiği';
  assert public.rank_for_rp(449) = 'silver', 'silver sınırı';
  assert public.rank_for_rp(450) = 'gold', 'gold eşiği';
  assert public.rank_for_rp(749) = 'gold', 'gold sınırı';
  assert public.rank_for_rp(750) = 'platinum', 'platinum eşiği';
  assert public.rank_for_rp(1049) = 'platinum', 'platinum sınırı';
  assert public.rank_for_rp(1050) = 'diamond', 'diamond eşiği';
  assert public.rank_for_rp(1349) = 'diamond', 'diamond sınırı';
  assert public.rank_for_rp(1350) = 'master', 'master eşiği';
  assert public.rank_for_rp(1649) = 'master', 'master sınırı';
  assert public.rank_for_rp(1650) = 'rosea', 'rosea eşiği';
  assert public.rank_for_rp(999999) = 'rosea', 'rosea tavansız';

  assert public.rank_soft_reset_rp(0) = 0, 'bronze reset tabanı';
  assert public.rank_soft_reset_rp(199) = 39, 'bronze taşma';
  assert public.rank_soft_reset_rp(200) = 100, 'silver reset tabanı';
  assert public.rank_soft_reset_rp(449) = 149, 'silver taşma';
  assert public.rank_soft_reset_rp(450) = 300, 'gold reset tabanı';
  assert public.rank_soft_reset_rp(749) = 359, 'gold taşma';
  assert public.rank_soft_reset_rp(750) = 600, 'platinum reset tabanı';
  assert public.rank_soft_reset_rp(1049) = 659, 'platinum taşma';
  assert public.rank_soft_reset_rp(1050) = 900, 'diamond reset tabanı';
  assert public.rank_soft_reset_rp(1349) = 959, 'diamond taşma';
  assert public.rank_soft_reset_rp(1350) = 1150, 'master reset tabanı';
  assert public.rank_soft_reset_rp(1649) = 1209, 'master taşma';
  assert public.rank_soft_reset_rp(1650) = 1450, 'rosea reset tabanı';
  assert public.rank_soft_reset_rp(1850) = 1490, 'görevdeki örnek';
  assert public.rank_soft_reset_rp(2650) = 1649, 'rosea tavanı bağlayıcı';
  assert public.rank_soft_reset_rp(99999) = 1649, 'rosea tavanı aşılamaz';
end;
$$;

/** RP ödül miktarları — istemci `RANK_RP` sabitiyle aynı. */
create or replace function public.rank_rp_amount(reward_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case reward_kind
    when 'scheduled_partial' then 10
    when 'scheduled_complete' then 25
    when 'unscheduled_workout' then 15
    when 'weekly_perfect' then 25
    when 'streak_7' then 25
    when 'streak_30' then 75
    when 'streak_100' then 200
    else 0
  end;
$$;

do $$
begin
  -- Kısmi + fark = tam ödül. Bu eşitlik bozulursa gün 25'i aşabilirdi.
  assert public.rank_rp_amount('scheduled_partial') = 10;
  assert public.rank_rp_amount('scheduled_complete') = 25;
  assert public.rank_rp_amount('scheduled_complete')
       - public.rank_rp_amount('scheduled_partial') = 15, 'partial→complete farkı 15 olmalı';
  assert public.rank_rp_amount('unscheduled_workout') = 15;
  assert public.rank_rp_amount('weekly_perfect') = 25;
  assert public.rank_rp_amount('streak_7') = 25;
  assert public.rank_rp_amount('streak_30') = 75;
  assert public.rank_rp_amount('streak_100') = 200;
  assert public.rank_rp_amount('set') = 0, 'set RP üretmez';
  assert public.rank_rp_amount('pet') = 0, 'Rosea sevmek RP üretmez';
  assert public.rank_rp_amount('daily_login') = 0, 'günlük giriş RP üretmez';
  assert public.rank_rp_amount('off_day') = 0, 'off day RP üretmez';
  assert public.rank_rp_amount('manual_discipline') = 0, 'manuel işaret RP üretmez';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Şema
-- ---------------------------------------------------------------------------

/**
 * Tek satırlık ayar tablosu.
 *
 * `first_season_start` — migration'ın uygulandığı haftanın PAZARTESİSİ.
 * `rp_epoch`          — migration'ın uygulandığı GÜN. Bundan öncesi RP üretmez.
 *
 * `singleton` kolonu ikinci satır eklenmesini şema düzeyinde imkânsız kılar.
 */
create table if not exists public.rank_settings (
  singleton boolean primary key default true check (singleton),
  first_season_start date not null,
  rp_epoch date not null,
  created_at timestamptz not null default timezone('utc', now())
);

-- `date_trunc('week', ...)` Postgres'te ISO haftasını kullanır → PAZARTESİ.
insert into public.rank_settings (singleton, first_season_start, rp_epoch)
values (true, (date_trunc('week', current_date))::date, current_date)
on conflict (singleton) do nothing;

alter table public.rank_settings enable row level security;

revoke all on table public.rank_settings from anon;
revoke all on table public.rank_settings from authenticated;
-- Ayarlar herkese açık okunabilir olmak zorunda DEĞİL: istemci sezon
-- bilgisini yalnızca RPC'den alır. Hiçbir grant verilmez.

/**
 * Sezon tanımları. Cron GEREKTİRMEZ: satırlar tarihe göre deterministik
 * biçimde `ensure_rank_season` tarafından üretilir.
 *
 * `theme_name` ileride özel sezon adı ("Winter Bloom") eklenebilsin diye
 * şimdiden vardır; şu an NULL bırakılır ve istemci `Season N` gösterir.
 */
create table if not exists public.rank_seasons (
  season_index integer primary key check (season_index >= 1),
  starts_on date not null unique,
  ends_on date not null,
  theme_name text,
  created_at timestamptz not null default timezone('utc', now()),
  check (ends_on = starts_on + 55)
);

alter table public.rank_seasons enable row level security;

revoke all on table public.rank_seasons from anon;
revoke all on table public.rank_seasons from authenticated;
-- Sezon bilgisi RPC dönüşünde taşınır; doğrudan tablo erişimi açılmaz.

/**
 * Kullanıcının SEZONLUK rank özeti.
 *
 * `finalized_at` dolduğunda satır ARŞİVDİR: `final_rp`, `final_rank` ve
 * istatistikler bir daha değişmez. `finalize_rank_season` ve uzlaştırma
 * fonksiyonları bu satırlara dokunmaz (aşağıdaki `where finalized_at is null`
 * koşulları).
 */
create table if not exists public.user_season_ranks (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_index integer not null references public.rank_seasons(season_index),
  starting_rp integer not null default 0 check (starting_rp >= 0),
  current_rp integer not null default 0 check (current_rp >= 0),
  peak_rp integer not null default 0 check (peak_rp >= 0),
  final_rp integer check (final_rp >= 0),
  final_rank text,
  workouts_completed integer not null default 0 check (workouts_completed >= 0),
  scheduled_days_total integer not null default 0 check (scheduled_days_total >= 0),
  scheduled_days_completed integer not null default 0 check (scheduled_days_completed >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  finalized_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, season_index)
);

create index if not exists user_season_ranks_user_idx
on public.user_season_ranks (user_id, season_index desc);

alter table public.user_season_ranks enable row level security;

revoke all on table public.user_season_ranks from anon;
revoke all on table public.user_season_ranks from authenticated;
grant select on table public.user_season_ranks to authenticated;

drop policy if exists "user_season_ranks_select_own" on public.user_season_ranks;
create policy "user_season_ranks_select_own"
on public.user_season_ranks for select
to authenticated
using ((select auth.uid()) = user_id);
-- Bilinçli olarak insert/update/delete policy'si YOK. Arkadaş erişimi de YOK:
-- arkadaşlar yalnızca `get_friend_rank` RPC'sinden özet görür.

drop trigger if exists user_season_ranks_set_updated_at on public.user_season_ranks;
create trigger user_season_ranks_set_updated_at
before update on public.user_season_ranks
for each row execute function public.set_updated_at();

/**
 * APPEND-ONLY RP DEFTERİ.
 *
 * Satırlar hiçbir zaman güncellenmez veya silinmez. Bir kanıt geçersizleşirse
 * (antrenman soft-delete) TELAFİ SATIRI eklenir: `rp_delta` negatif olabilir.
 * Böylece geçmiş denetlenebilir kalır ve `current_rp` her zaman
 * `sum(rp_delta)` ile doğrulanabilir.
 *
 * `source_key` idempotency anahtarıdır. `(user_id, event_type, source_key)`
 * benzersizdir; aynı olay ikinci kez RP üretemez.
 */
create table if not exists public.rank_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  season_index integer not null references public.rank_seasons(season_index),
  event_type text not null check (
    event_type in ('scheduled_day', 'unscheduled_workout', 'weekly_perfect', 'streak_milestone')
  ),
  source_key text not null check (char_length(source_key) between 1 and 200),
  -- Telafi satırları negatif olabilir; akıl sağlığı sınırları iki yönlüdür.
  rp_delta integer not null check (rp_delta >= -100000 and rp_delta <= 100000),
  awarded_for_date date,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists rank_events_idempotency_idx
on public.rank_events (user_id, event_type, source_key);

create index if not exists rank_events_user_season_idx
on public.rank_events (user_id, season_index);

create index if not exists rank_events_user_date_idx
on public.rank_events (user_id, event_type, awarded_for_date);

alter table public.rank_events enable row level security;

revoke all on table public.rank_events from anon;
revoke all on table public.rank_events from authenticated;
grant select on table public.rank_events to authenticated;

drop policy if exists "rank_events_select_own" on public.rank_events;
create policy "rank_events_select_own"
on public.rank_events for select
to authenticated
using ((select auth.uid()) = user_id);
-- Append-only: istemci için insert/update/delete policy'si YOK.
-- Arkadaşlar bu tabloyu HİÇBİR koşulda okuyamaz.

-- ---------------------------------------------------------------------------
-- 3) Sezon üretimi — deterministik, cron'suz
-- ---------------------------------------------------------------------------

/** Verilen tarihin sezon numarası. Çapadan önceki tarihler sezon 1'dir. */
create or replace function public.rank_season_index_for(target_date date)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  anchor date;
  offset_days integer;
begin
  select rs.first_season_start into anchor from public.rank_settings as rs limit 1;
  if anchor is null or target_date is null then
    return 1;
  end if;

  offset_days := target_date - anchor;
  if offset_days < 0 then
    return 1;
  end if;

  return (offset_days / 56) + 1;
end;
$$;

revoke all on function public.rank_season_index_for(date) from public;
revoke all on function public.rank_season_index_for(date) from anon;
revoke all on function public.rank_season_index_for(date) from authenticated;

/**
 * Sezon satırını (ve arasındaki bütün eksik sezonları) güvenle oluşturur.
 *
 * IDEMPOTENT: `on conflict do nothing`. Kullanıcı birkaç sezon uygulamayı
 * açmazsa aradaki bütün sezonlar burada tek seferde üretilir.
 */
create or replace function public.ensure_rank_season(target_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  anchor date;
begin
  if target_index is null or target_index < 1 then
    return;
  end if;

  select rs.first_season_start into anchor from public.rank_settings as rs limit 1;
  if anchor is null then
    return;
  end if;

  insert into public.rank_seasons (season_index, starts_on, ends_on)
  select
    generated,
    anchor + ((generated - 1) * 56),
    anchor + ((generated - 1) * 56) + 55
  from generate_series(1, target_index) as generated
  on conflict (season_index) do nothing;
end;
$$;

revoke all on function public.ensure_rank_season(integer) from public;
revoke all on function public.ensure_rank_season(integer) from anon;
revoke all on function public.ensure_rank_season(integer) from authenticated;

-- ---------------------------------------------------------------------------
-- 4) RANK KANIT FONKSİYONU
-- ---------------------------------------------------------------------------

/**
 * Bir tarih aralığının RANK açısından durumu.
 *
 * DONMUŞ TAKVİM ile RANK KANITININ AYRIMI — bu fonksiyonun asıl işi budur:
 *
 *   KİMLİK (donmuş geçmiş kullanılabilir)
 *     "Bu tarih hangi programa aitti ve o programda planlı bir antrenman günü
 *     müydü?" sorusu `discipline_day_history.source_program_id` üzerinden
 *     cevaplanabilir. Aktif program değişse bile geçmiş günün kimliği kaybolmaz.
 *
 *   TAMAMLAMA / İLERLEME (yalnızca CANLI kayıt)
 *     "O gün gerçekten yapıldı mı?" sorusu HER ZAMAN `deleted_at is null`
 *     oturumların setlerinden hesaplanır. `discipline_day_history.status`
 *     sütunu rank için HİÇ OKUNMAZ: o sütun takvimin değişmez görüntüsüdür ve
 *     antrenman silinse bile aynı kalır — kanıt olarak kullanılsaydı silinen
 *     bir antrenmanın RP'si sonsuza kadar korunurdu.
 *
 * `auto_discipline_range` ve `display_discipline_range` BU MIGRATION'DA HİÇ
 * DEĞİŞTİRİLMEZ. Antrenman silmek disiplin takvimini, geçmiş takvim
 * durumlarını, streak görünümünü ve XP/gül ödüllerini ETKİLEMEZ; yalnızca
 * rank düzelir.
 *
 * `is_verifiable` — günün otorite programı çözülemediğinde (ne aktif program
 * penceresinde, ne de donmuş satırın kaynak programı hâlâ duruyor) `false`
 * döner. Kanıt güvenle üretilemediği için çağıran o günün RP'sini sessizce
 * KORUMAZ; istenen değeri 0 kabul edip telafi yazar.
 *
 * `is_scheduled_workout` ayrı döner: off day "completed" olsa bile PLANLI
 * ANTRENMAN GÜNÜ değildir ve RP üretmez.
 *
 * `manual_discipline_statuses` HİÇ okunmaz: o tabloya istemci yazabildiği için
 * rank kaynağı olamaz.
 */
-- Dönüş kümesi `is_verifiable` ile genişlediği için önce düşürülür.
drop function if exists public.rank_day_state(uuid, date, date);

create or replace function public.rank_day_state(
  target_user uuid,
  from_date date,
  to_date date
)
returns table (
  day_date date,
  state text,
  is_scheduled_workout boolean,
  is_frozen boolean,
  is_verifiable boolean
)
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
  calendar as (
    select generated::date as day_date
    from generate_series(from_date::timestamp, to_date::timestamp, interval '1 day') as generated
  ),
  /**
   * Donmuş takvim satırı — YALNIZCA KİMLİK için okunur.
   *
   * `h.status` BİLİNÇLİ OLARAK OKUNMAZ. O sütun takvimin değişmez görüntüsüdür
   * ve antrenman silinse bile değişmez; rank kanıtı olarak kullanılsaydı
   * silinen bir antrenmanın RP'si sonsuza kadar korunurdu. Buradan yalnızca
   * "o gün hangi programa aitti" bilgisi alınır.
   */
  frozen as (
    select h.discipline_date, h.source_program_id
    from public.discipline_day_history as h
    where h.user_id = target_user
      and h.discipline_date between from_date and to_date
  ),
  /**
   * Günün OTORİTE programı:
   *   1. tarih aktif programın penceresindeyse aktif program,
   *   2. değilse donmuş satırın kaynak programı (satır HÂLÂ duruyorsa).
   *
   * İkisi de bulunamazsa program NULL kalır → `is_verifiable = false`.
   */
  resolved as (
    select
      c.day_date,
      (f.discipline_date is not null) as is_frozen,
      case
        when ap.id is not null
          and ap.active_from is not null
          and c.day_date >= ap.active_from then ap.id
        else fp.id
      end as program_id
    from calendar as c
    left join active_program as ap on true
    left join frozen as f on f.discipline_date = c.day_date
    left join public.programs as fp
      on fp.id = f.source_program_id
     and fp.owner_id = target_user
  ),
  day_link as (
    select
      r.day_date,
      r.is_frozen,
      r.program_id,
      pd.id as day_id,
      coalesce(pd.is_off_day, false) as day_is_off
    from resolved as r
    left join public.program_days as pd
      on pd.program_id = r.program_id
     and pd.scheduled_weekday = extract(dow from r.day_date)::smallint
  ),
  /**
   * TAMAMLAMA KANITI — yalnızca `deleted_at is null` oturumlardan.
   *
   * Rank'ı takvimden ayıran tek yer burasıdır. Takvim fonksiyonları
   * (`auto_discipline_range`, `display_discipline_range`) bu filtreyi
   * UYGULAMAZ ve bu migration onlara hiç dokunmaz.
   */
  set_counts as (
    select
      s.workout_date as day_date,
      ws.program_exercise_id as exercise_id,
      count(*)::integer as completed_count
    from public.workout_sets as ws
    join public.workout_sessions as s on s.id = ws.session_id
    where s.user_id = target_user
      and s.deleted_at is null
      and s.workout_date between from_date and to_date
      and ws.program_exercise_id is not null
    group by s.workout_date, ws.program_exercise_id
  ),
  totals as (
    select
      dl.day_date,
      dl.is_frozen,
      dl.program_id,
      dl.day_id,
      dl.day_is_off,
      coalesce(sum(e.target_sets), 0)::integer as total_target,
      coalesce(sum(least(coalesce(cnt.completed_count, 0), e.target_sets)), 0)::integer as total_done
    from day_link as dl
    left join public.program_exercises as e on e.program_day_id = dl.day_id
    left join set_counts as cnt on cnt.exercise_id = e.id and cnt.day_date = dl.day_date
    group by dl.day_date, dl.is_frozen, dl.program_id, dl.day_id, dl.day_is_off
  )
  select
    t.day_date,
    -- Durum HER ZAMAN canlı setlerden hesaplanır; donmuş status kullanılmaz.
    case
      when t.day_id is null then null
      when t.day_is_off then 'completed'::text
      when t.total_target = 0 then null
      when t.total_done >= t.total_target then 'completed'
      when t.total_done > 0 then 'partial'
      else null
    end,
    -- Off day PLANLI ANTRENMAN GÜNÜ DEĞİLDİR: RP üretmez, haftalık planı bozmaz.
    (t.day_id is not null and not t.day_is_off),
    t.is_frozen,
    -- Program çözülemediyse tamamlama kanıtı güvenle üretilemez.
    (t.program_id is not null)
  from totals as t
  order by t.day_date;
$$;

revoke all on function public.rank_day_state(uuid, date, date) from public;
revoke all on function public.rank_day_state(uuid, date, date) from anon;
revoke all on function public.rank_day_state(uuid, date, date) from authenticated;

/**
 * KANITTAN TÜRETİLEN ZİRVE SERİ.
 *
 * NEDEN "o anki seri" DEĞİL: streak kilometre taşları artık desired-vs-written
 * ile yönetiliyor. İstenen değer "bugünkü seri" olsaydı kullanıcı bir gün
 * kaçırdığında kazanılmış kilometre taşı geri alınırdı — oysa kaçırılan gün
 * için EKSİ RP VERİLMEZ. Bu yüzden istenen değer, HÂLÂ GEÇERLİ kanıttan
 * üretilebilen EN UZUN seriye dayanır:
 *
 *   * gün kaçırmak zirveyi düşürmez → kilometre taşı korunur,
 *   * antrenman SİLMEK kanıtı yok eder → zirve düşer → RP telafi edilir,
 *   * kanıt geri gelirse zirve geri gelir → yeniden kazanılır.
 *
 * `window_from` sezon başından ÖNCESİNİ de tarar (seri sezon sınırını aşabilir);
 * ama yalnızca `count_from`'dan itibaren biten koşular sayılır, böylece bir
 * önceki sezonun kapanmış serisi bu sezona ödül yazmaz.
 */
create or replace function public.rank_peak_streak(
  target_user uuid,
  window_from date,
  window_to date,
  count_from date
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  day_row record;
  running integer := 0;
  peak integer := 0;
begin
  if target_user is null or window_from is null or window_to is null
    or window_from > window_to then
    return 0;
  end if;

  for day_row in
    select r.day_date, r.state
    from public.rank_day_state(target_user, window_from, window_to) as r
    order by r.day_date
  loop
    if day_row.state in ('completed', 'partial') then
      running := running + 1;
    else
      running := 0;
    end if;

    if day_row.day_date >= count_from then
      peak := greatest(peak, running);
    end if;
  end loop;

  return peak;
end;
$$;

revoke all on function public.rank_peak_streak(uuid, date, date, date) from public;
revoke all on function public.rank_peak_streak(uuid, date, date, date) from anon;
revoke all on function public.rank_peak_streak(uuid, date, date, date) from authenticated;

-- Eski nokta-atışı seri fonksiyonu artık kullanılmıyor: yerini yukarıdaki
-- kanıt tabanlı zirve hesabı aldı. Önceki bir çalıştırmadan kalmışsa düşürülür.
drop function if exists public.rank_streak_through(uuid, date);


-- ---------------------------------------------------------------------------
-- 5) Defter yazımı — tek nokta
-- ---------------------------------------------------------------------------

/**
 * Bir RP olayını deftere yazar ve sezon toplamını AYNI transaction'da günceller.
 *
 * Aynı `(user, event_type, source_key)` ikinci kez yazılamaz → 0 döner ve
 * hiçbir toplam değişmez. Sezon ARŞİVLENMİŞSE (`finalized_at not null`)
 * hiçbir şey yazılmaz: kapanmış sezon değişmezdir.
 */
create or replace function public.record_rank_event(
  target_user uuid,
  target_season integer,
  target_event_type text,
  target_source_key text,
  target_rp integer,
  target_date date,
  target_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_finalized boolean;
begin
  if coalesce(target_rp, 0) = 0 then
    return 0;
  end if;

  -- Arşivlenmiş sezona hiçbir koşulda yazılmaz.
  select (usr.finalized_at is not null) into is_finalized
  from public.user_season_ranks as usr
  where usr.user_id = target_user and usr.season_index = target_season;

  if coalesce(is_finalized, false) then
    return 0;
  end if;

  insert into public.rank_events (
    user_id, season_index, event_type, source_key, rp_delta, awarded_for_date, metadata
  )
  values (
    target_user, target_season, target_event_type, target_source_key,
    target_rp, target_date, target_metadata
  )
  on conflict (user_id, event_type, source_key) do nothing;

  if not found then
    return 0;
  end if;

  update public.user_season_ranks as usr
  set current_rp = greatest(usr.current_rp + target_rp, 0),
      peak_rp = greatest(usr.peak_rp, greatest(usr.current_rp + target_rp, 0))
  where usr.user_id = target_user
    and usr.season_index = target_season
    and usr.finalized_at is null;

  return target_rp;
end;
$$;

revoke all on function public.record_rank_event(uuid, integer, text, text, integer, date, jsonb) from public;
revoke all on function public.record_rank_event(uuid, integer, text, text, integer, date, jsonb) from anon;
revoke all on function public.record_rank_event(uuid, integer, text, text, integer, date, jsonb) from authenticated;

/**
 * DESIRED-VS-WRITTEN TELAFİ MOTORU — bütün RP türlerinin TEK yolu.
 *
 * `evidence_key` bir KANIT BİRİMİNİ adlandırır (bir tarih, bir session id, bir
 * hafta başlangıcı, bir kilometre taşı). Fonksiyon:
 *
 *   1. o kanıt birimine yazılmış NET RP'yi toplar,
 *   2. sunucunun şu an hesapladığı `desired_rp` ile karşılaştırır,
 *   3. fark varsa `evidence_key || '#' || <sıra>` anahtarıyla YENİ bir satır
 *      yazar. Fark pozitifse kazanım, negatifse telafidir.
 *
 * DEFTER APPEND-ONLY KALIR: hiçbir satır güncellenmez veya silinmez.
 *
 * YENİDEN KAZANILABİLİRLİK: her düzeltme yeni bir sıra numarası aldığı için
 * benzersiz indeks aynı kanıt birimini KALICI olarak kilitlemez. Kanıt
 * kaybolup geri gelirse (-25, +25) dizisi yazılır ve RP yeniden kazanılır.
 *
 * IDEMPOTENCY: fark 0 ise hiçbir satır yazılmaz. Aynı çağrı tekrarlandığında
 * ikinci kez RP oluşmaz.
 *
 * EŞZAMANLILIK: çağıranlar `sync_my_rank` içindeki kullanıcı advisory lock'ı
 * altında çalışır; ikinci çağrı farkı 0 görür.
 *
 * ARŞİV: yazma `record_rank_event` üzerinden gider, o da finalize edilmiş
 * sezona hiçbir koşulda yazmaz.
 */
create or replace function public.apply_rank_adjustment(
  target_user uuid,
  target_season integer,
  target_event_type text,
  evidence_key text,
  desired_rp integer,
  target_date date,
  target_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written_rp integer;
  sequence_index integer;
begin
  /**
   * Kanıt birimine ait BÜTÜN satırlar toplanır.
   *
   * `like` yerine `starts_with` bilinçli: kilometre taşı anahtarları alt çizgi
   * içerir (`streak_7`) ve `like` içinde `_` joker karakterdir. Ön ek `'#'`
   * ile bitirildiği için `streak_7#…` ile `streak_70#…` de karışmaz.
   *
   * Eşitlik ve `:revoked` dalları YALNIZCA geriye dönük uyumluluk içindir:
   * migration daha önce uygulanmışsa eski sabit anahtarlı satırlar da nete
   * dahil edilir, böylece sıfırdan ikinci bir ödül yazılmaz.
   */
  select coalesce(sum(re.rp_delta), 0)
  into written_rp
  from public.rank_events as re
  where re.user_id = target_user
    and re.event_type = target_event_type
    and (
      re.source_key = evidence_key
      or re.source_key = evidence_key || ':revoked'
      or starts_with(re.source_key, evidence_key || '#')
    );

  if coalesce(desired_rp, 0) = written_rp then
    return 0;
  end if;

  select count(*)::integer
  into sequence_index
  from public.rank_events as re
  where re.user_id = target_user
    and re.event_type = target_event_type
    and (
      re.source_key = evidence_key
      or re.source_key = evidence_key || ':revoked'
      or starts_with(re.source_key, evidence_key || '#')
    );

  return public.record_rank_event(
    target_user,
    target_season,
    target_event_type,
    evidence_key || '#' || sequence_index::text,
    coalesce(desired_rp, 0) - written_rp,
    target_date,
    coalesce(target_metadata, '{}'::jsonb)
      || jsonb_build_object('desired_rp', coalesce(desired_rp, 0), 'written_rp', written_rp)
  );
end;
$$;

revoke all on function public.apply_rank_adjustment(uuid, integer, text, text, integer, date, jsonb) from public;
revoke all on function public.apply_rank_adjustment(uuid, integer, text, text, integer, date, jsonb) from anon;
revoke all on function public.apply_rank_adjustment(uuid, integer, text, text, integer, date, jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- 6) Sezon satırının açılması ve finalize edilmesi
-- ---------------------------------------------------------------------------

/** Kullanıcının bir sezon satırını güvenle açar. Idempotenttir. */
create or replace function public.ensure_user_season(
  target_user uuid,
  target_season integer,
  opening_rp integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_rank_season(target_season);

  insert into public.user_season_ranks (
    user_id, season_index, starting_rp, current_rp, peak_rp
  )
  values (
    target_user, target_season,
    greatest(coalesce(opening_rp, 0), 0),
    greatest(coalesce(opening_rp, 0), 0),
    greatest(coalesce(opening_rp, 0), 0)
  )
  on conflict (user_id, season_index) do nothing;
end;
$$;

revoke all on function public.ensure_user_season(uuid, integer, integer) from public;
revoke all on function public.ensure_user_season(uuid, integer, integer) from anon;
revoke all on function public.ensure_user_season(uuid, integer, integer) from authenticated;

/**
 * Bir sezonu KAPATIR ve sonucunu kalıcı olarak arşivler.
 *
 * IDEMPOTENT: `where finalized_at is null` sayesinde ikinci çağrı hiçbir şeyi
 * değiştirmez. Arşivlendikten sonra antrenman silinse bile `final_rp` ve
 * `final_rank` DEĞİŞMEZ.
 */
create or replace function public.finalize_rank_season(target_user uuid, target_season integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_season_ranks as usr
  set final_rp = usr.current_rp,
      final_rank = public.rank_for_rp(usr.current_rp),
      finalized_at = timezone('utc', now())
  where usr.user_id = target_user
    and usr.season_index = target_season
    and usr.finalized_at is null;
end;
$$;

revoke all on function public.finalize_rank_season(uuid, integer) from public;
revoke all on function public.finalize_rank_season(uuid, integer) from anon;
revoke all on function public.finalize_rank_season(uuid, integer) from authenticated;

/**
 * KAÇIRILAN SEZON GEÇİŞLERİ
 *
 * Kullanıcı birkaç sezon uygulamayı açmazsa aradaki bütün sezonlar SIRAYLA
 * kapatılır ve her birinde soft reset uygulanır. Cron gerekmez; işlem
 * uygulamanın sezon bittikten sonraki ilk açılışında tamamlanır.
 *
 * Guard: sonsuz döngü yerine kontrollü hata (aynı ödül defter idempotency'si
 * sayesinde ikinci kez yazılmaz, bu yüzden yeniden denemek güvenlidir).
 */
create or replace function public.advance_rank_seasons(target_user uuid, client_today date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_index integer;
  open_index integer;
  last_closed_index integer;
  open_ends_on date;
  carry_rp integer;
  guard integer := 0;
begin
  current_index := public.rank_season_index_for(client_today);
  perform public.ensure_rank_season(current_index);

  loop
    guard := guard + 1;
    if guard > 500 then
      raise exception 'rank_season_advance_stalled' using errcode = '55000';
    end if;

    -- Kullanıcının HÂLÂ açık en eski sezonu.
    select usr.season_index
    into open_index
    from public.user_season_ranks as usr
    where usr.user_id = target_user
      and usr.finalized_at is null
    order by usr.season_index
    limit 1;

    if open_index is null then
      /**
       * Açık sezon yok. İki durum:
       *   * kullanıcı sisteme İLK KEZ giriyor → 0 RP ile başlar;
       *   * (teorik) bütün sezonlar kapatılmış → son kapanan sezondan soft
       *     reset ile taşınır. Taşımasız açmak kazanılmış RP'yi silerdi.
       */
      select usr.season_index, public.rank_soft_reset_rp(usr.final_rp)
      into last_closed_index, carry_rp
      from public.user_season_ranks as usr
      where usr.user_id = target_user
        and usr.finalized_at is not null
      order by usr.season_index desc
      limit 1;

      perform public.ensure_user_season(target_user, current_index, coalesce(carry_rp, 0));
      return current_index;
    end if;

    -- Açık sezon güncel sezonsa iş bitti.
    exit when open_index >= current_index;

    select rks.ends_on into open_ends_on
    from public.rank_seasons as rks
    where rks.season_index = open_index;

    -- Sezon henüz bitmediyse (saat kayması) dokunulmaz.
    exit when open_ends_on is null or open_ends_on >= client_today;

    /**
     * KAPANIŞ ÖNCESİ SON UZLAŞTIRMA — bu sıra kritiktir.
     *
     * Kullanıcı sezonun son günlerinde çevrimdışı kalmış veya son sync'i ağ
     * hatası almış olabilir. Veritabanında duran fakat henüz RP'ye
     * dönüşmemiş kanıt (tamamlanan planlı gün, plan dışı antrenman, kapanan
     * son hafta, kilometre taşına ulaşan seri) doğrudan finalize edilirse
     * KALICI OLARAK KAYBOLURDU.
     *
     * `open_ends_on + 1` ufku bilinçlidir: sezon tamamen bittiği için son
     * hafta da "kapanmış" sayılır ve haftalık bonus değerlendirmesine girer.
     * Uzlaştırma ve finalize AYNI transaction ve AYNI advisory lock altında
     * çalışır (bkz. `sync_my_rank`), bu yüzden araya başka bir yazma giremez.
     */
    perform public.reconcile_rank_season(target_user, open_index, open_ends_on + 1);

    -- Ancak kanıt tamamen işlendikten SONRA sezon kapatılır ve final RP ile
    -- final rank kalıcı olarak yazılır.
    perform public.finalize_rank_season(target_user, open_index);

    select public.rank_soft_reset_rp(usr.final_rp)
    into carry_rp
    from public.user_season_ranks as usr
    where usr.user_id = target_user and usr.season_index = open_index;

    -- Bir SONRAKİ sezon açılır. Atlanan sezonlar da SIRAYLA açılıp kapanır;
    -- her birinde soft reset yeniden uygulanır.
    perform public.ensure_user_season(
      target_user, open_index + 1, coalesce(carry_rp, 0)
    );
  end loop;

  return current_index;
end;
$$;

revoke all on function public.advance_rank_seasons(uuid, date) from public;
revoke all on function public.advance_rank_seasons(uuid, date) from anon;
revoke all on function public.advance_rank_seasons(uuid, date) from authenticated;

-- ---------------------------------------------------------------------------
-- 7) RP uzlaştırması
-- ---------------------------------------------------------------------------

/**
 * BİR SEZONUN RP'sini kanıtla uzlaştırır.
 *
 * MODEL — "istenen vs. yazılmış", DÖRT RP TÜRÜNÜN HEPSİNDE. Her kanıt birimi
 * için sunucu istenen RP'yi hesaplar, deftere yazılmış netle karşılaştırır ve
 * yalnızca farkı `apply_rank_adjustment` ile yazar. Bu tek model şunların
 * hepsini birden çözer:
 *
 *   * kısmi → tam geçiş (10 yazılıyken istenen 25 → +15),
 *   * idempotency (fark 0 → hiçbir satır yazılmaz),
 *   * eşzamanlılık (advisory lock altında ikinci çağrı farkı 0 görür),
 *   * antrenman silme telafisi (kanıt düşer → negatif satır),
 *   * kanıt geri gelirse YENİDEN KAZANIM (sabit anahtar kilitlemez).
 *
 * KAÇIRILAN GÜN İÇİN EKSİ RP VERİLMEZ. İstenen değerlerin hiçbiri "bugünkü
 * duruma" değil, HÂLÂ GEÇERLİ KANITA dayanır: bir gün antrenman yapmamak
 * hiçbir kanıtı yok etmez, yalnızca antrenman SİLMEK yok eder.
 *
 * `client_today` bu sezon için "değerlendirme ufkudur". Sezon kapanışında
 * `advance_rank_seasons` buraya `ends_on + 1` geçer: sezonun tamamı, son
 * haftası da kapanmış sayılarak son bir kez uzlaştırılır.
 */
create or replace function public.reconcile_rank_season(
  target_user uuid,
  target_season integer,
  client_today date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Streak kilometre taşı için sezon başından öncesine bakılan pencere.
  -- 100 günlük kilometre taşı sezon sınırını aşan bir seriyle kazanılabilir.
  streak_lookback constant integer := 120;
  season_start date;
  season_end date;
  epoch_date date;
  scan_from date;
  scan_to date;
  day_row record;
  session_row record;
  week_row record;
  milestone record;
  desired_rp integer;
  peak_streak integer;
  stat_workouts integer := 0;
  stat_days_total integer := 0;
  stat_days_done integer := 0;
begin
  select rks.starts_on, rks.ends_on into season_start, season_end
  from public.rank_seasons as rks
  where rks.season_index = target_season;

  select rs.rp_epoch into epoch_date from public.rank_settings as rs limit 1;

  if season_start is null or epoch_date is null then
    return;
  end if;

  -- ARŞİVLENMİŞ SEZONA DOKUNULMAZ. Geç gelen sync veya sonradan yapılan
  -- antrenman silme kapanmış sezonun sonucunu değiştiremez.
  if exists (
    select 1 from public.user_season_ranks as usr
    where usr.user_id = target_user
      and usr.season_index = target_season
      and usr.finalized_at is not null
  ) then
    return;
  end if;

  -- Pencere: sezonun içi, epoch'tan sonrası, ufka kadar. En fazla 56 gün.
  scan_from := greatest(season_start, epoch_date);
  scan_to := least(season_end, client_today);

  if scan_from > scan_to then
    return;
  end if;

  -- 1) PLANLI GÜNLER.
  for day_row in
    select r.day_date, r.state, r.is_scheduled_workout, r.is_verifiable
    from public.rank_day_state(target_user, scan_from, scan_to) as r
    order by r.day_date
  loop
    -- İstatistikler (arşive yazılır; RP'den bağımsızdır).
    if day_row.is_scheduled_workout then
      stat_days_total := stat_days_total + 1;
      if day_row.state = 'completed' then
        stat_days_done := stat_days_done + 1;
      end if;
    end if;

    /**
     * İSTENEN DEĞER.
     *
     * Kanıt güvenle üretilemiyorsa (gün hiçbir programa bağlanamıyor, ör.
     * kaynak program silinmiş) istenen 0'dır ve daha önce yazılmış RP TELAFİ
     * EDİLİR. Sessizce korumak, silinmiş bir antrenmanın RP'sinin sonsuza
     * kadar kalması demek olurdu.
     *
     * Off day ve plansız günler de 0 üretir; bu ikisi zaten hiç RP kazanmadığı
     * için fark 0 kalır ve satır yazılmaz.
     */
    desired_rp := case
      when not day_row.is_verifiable then 0
      when not day_row.is_scheduled_workout then 0
      when day_row.state = 'completed' then public.rank_rp_amount('scheduled_complete')
      when day_row.state = 'partial' then public.rank_rp_amount('scheduled_partial')
      else 0
    end;

    /**
     * Ucuz erken çıkış: istenen 0 VE o güne hiç satır yazılmamışsa yapacak iş
     * yoktur. `rank_events_user_date_idx` ile tek indeks bakışıdır ve 56 günlük
     * pencerede boş günler için iki gereksiz defter taramasını önler.
     * Doğruluğu etkilemez: 0 istenen + 0 yazılmış = 0 fark.
     */
    continue when desired_rp = 0 and not exists (
      select 1 from public.rank_events as re
      where re.user_id = target_user
        and re.event_type = 'scheduled_day'
        and re.awarded_for_date = day_row.day_date
    );

    perform public.apply_rank_adjustment(
      target_user, target_season, 'scheduled_day',
      day_row.day_date::text,
      desired_rp,
      day_row.day_date,
      jsonb_build_object('state', day_row.state, 'verifiable', day_row.is_verifiable)
    );
  end loop;

  -- 2) PLAN DIŞI, DOĞRULANMIŞ ANTRENMANLAR.
  --    Aday küme = şu an geçerli olanlar ∪ daha önce RP yazılmış olanlar.
  --    İkinci küme olmasaydı silinen bir oturum taramadan tamamen düşer ve
  --    RP'si telafi edilemezdi.
  for session_row in
    select
      candidate.session_id,
      candidate.workout_date,
      (
        select count(*) > 0
        from public.workout_sessions as s
        where s.id = candidate.session_id
          and s.user_id = target_user
          and s.status = 'completed'
          and s.deleted_at is null
          and s.workout_date between scan_from and scan_to
          and not exists (
            select 1
            from public.rank_day_state(target_user, s.workout_date, s.workout_date) as r
            where r.is_scheduled_workout
          )
      ) as is_valid
    from (
      select s.id as session_id, s.workout_date
      from public.workout_sessions as s
      where s.user_id = target_user
        and s.status = 'completed'
        and s.deleted_at is null
        and s.workout_date between scan_from and scan_to
      union
      select
        -- Anahtar üç biçimde olabilir: `<uuid>`, `<uuid>#<sıra>` ve (eski
        -- sürümden kalmışsa) `<uuid>:revoked`. UUID ne '#' ne ':' içerdiği
        -- için iki kademeli `split_part` üçünü de güvenle normalize eder.
        split_part(split_part(re.source_key, '#', 1), ':', 1)::uuid as session_id,
        re.awarded_for_date as workout_date
      from public.rank_events as re
      where re.user_id = target_user
        and re.season_index = target_season
        and re.event_type = 'unscheduled_workout'
    ) as candidate
  loop
    perform public.apply_rank_adjustment(
      target_user, target_season, 'unscheduled_workout',
      session_row.session_id::text,
      case when session_row.is_valid then public.rank_rp_amount('unscheduled_workout') else 0 end,
      session_row.workout_date,
      jsonb_build_object('valid', session_row.is_valid)
    );
  end loop;

  -- Sezon içindeki tamamlanan (silinmemiş) antrenman sayısı.
  select count(*)::integer into stat_workouts
  from public.workout_sessions as s
  where s.user_id = target_user
    and s.status = 'completed'
    and s.deleted_at is null
    and s.workout_date between scan_from and scan_to;

  -- 3) KAPANMIŞ HAFTALARIN MÜKEMMEL PLAN BONUSU.
  --    Yalnızca kapanmış haftalar taranır; açık hafta hiç RP kazanmadığı için
  --    kapsam dışında bırakmak telafi kaybına yol açmaz.
  for week_row in
    select weeks.week_start, tally.scheduled_days, tally.completed_days
    from (
      select generated::date as week_start
      from generate_series(season_start::timestamp, season_end::timestamp, interval '7 day') as generated
    ) as weeks
    -- Haftanın günleri TEK çağrıda okunur; hafta başına iki tarama yapılmaz.
    cross join lateral (
      select
        count(*) filter (where r.is_scheduled_workout)::integer as scheduled_days,
        count(*) filter (where r.is_scheduled_workout and r.state = 'completed')::integer as completed_days
      from public.rank_day_state(target_user, weeks.week_start, weeks.week_start + 6) as r
    ) as tally
    where weeks.week_start >= epoch_date
      -- Hafta kapanmış olmalı. Sezon kapanışında `client_today = ends_on + 1`
      -- geçildiği için sezonun SON haftası da burada değerlendirilir.
      and weeks.week_start + 6 < client_today
      and weeks.week_start + 6 <= season_end
    order by weeks.week_start
  loop
    /**
     * Planlı günü olmayan hafta bonus üretmez. Planlı günlerin HEPSİ hâlâ tam
     * tamamlanmış görünüyorsa bonus geçerlidir; haftadaki bir antrenman
     * silindiğinde `completed_days` düşer, istenen 0 olur ve bonus telafi
     * edilir. Kanıt geri gelirse bonus yeniden kazanılır.
     */
    desired_rp := case
      when week_row.scheduled_days > 0
        and week_row.completed_days >= week_row.scheduled_days
      then public.rank_rp_amount('weekly_perfect')
      else 0
    end;

    perform public.apply_rank_adjustment(
      target_user, target_season, 'weekly_perfect',
      week_row.week_start::text,
      desired_rp,
      week_row.week_start + 6,
      jsonb_build_object(
        'scheduled_days', week_row.scheduled_days,
        'completed_days', week_row.completed_days
      )
    );
  end loop;

  -- 4) STREAK KİLOMETRE TAŞLARI.
  --
  --    Anahtar SEZON İÇERİR. Telafi ve yeniden kazanım ancak açık sezonda
  --    yapılabildiği için ömür boyu tek anahtar kullanılsaydı kapanmış bir
  --    sezonda kazanılmış kilometre taşı bu sezonda telafi edilemez, ya da
  --    telafi kapanmış sezonu değiştirmeye çalışırdı. Sezon başına anahtar
  --    hem arşivi dokunulmaz tutar hem de yeniden kazanımı mümkün kılar.
  peak_streak := public.rank_peak_streak(
    target_user,
    greatest(epoch_date, scan_from - streak_lookback),
    scan_to,
    scan_from
  );

  for milestone in
    select * from (values (7, 'streak_7'), (30, 'streak_30'), (100, 'streak_100'))
      as m(days, kind)
  loop
    perform public.apply_rank_adjustment(
      target_user, target_season, 'streak_milestone',
      milestone.kind || ':s' || target_season::text,
      case when peak_streak >= milestone.days then public.rank_rp_amount(milestone.kind) else 0 end,
      scan_to,
      jsonb_build_object('peak_streak', peak_streak)
    );
  end loop;

  -- 5) İSTATİSTİKLER. RP'den bağımsızdır; kanıt düşerse bunlar da düzelir
  --    (monotonik `greatest` KULLANILMAZ, aksi hâlde silinen antrenmandan
  --    sonra ekranda eski seri görünmeye devam ederdi).
  update public.user_season_ranks as usr
  set workouts_completed = stat_workouts,
      scheduled_days_total = stat_days_total,
      scheduled_days_completed = stat_days_done,
      longest_streak = peak_streak
  where usr.user_id = target_user
    and usr.season_index = target_season
    and usr.finalized_at is null;
end;
$$;

revoke all on function public.reconcile_rank_season(uuid, integer, date) from public;
revoke all on function public.reconcile_rank_season(uuid, integer, date) from anon;
revoke all on function public.reconcile_rank_season(uuid, integer, date) from authenticated;

-- ---------------------------------------------------------------------------
-- 8) İstemciye açık RPC'ler
-- ---------------------------------------------------------------------------

/**
 * Rank senkronizasyonu — istemcinin çağırdığı TEK yazma yolu.
 *
 * İstemci yalnızca kendi yerel gününü gönderir; o da `assert_client_today` ile
 * ±1 güne kilitlidir. RP, rank, starting/final RP ve reset miktarının hiçbiri
 * istemciden gelmez.
 *
 * Sırayla: sezonları ilerlet (kaçırılanlar dâhil) → güncel sezonu uzlaştır →
 * özeti döndür. Tamamı tek transaction ve tek advisory lock altındadır.
 */
create or replace function public.sync_my_rank(client_today date)
returns table (
  season_index integer,
  starts_on date,
  ends_on date,
  theme_name text,
  starting_rp integer,
  current_rp integer,
  peak_rp integer,
  current_rank text,
  peak_rank text,
  workouts_completed integer,
  scheduled_days_total integer,
  scheduled_days_completed integer,
  longest_streak integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  active_season integer;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform public.assert_client_today(client_today);
  -- Anahtar 8023: ödül (8021) ve program sıralaması (8022) ile ÇAKIŞMAZ.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8023));

  active_season := public.advance_rank_seasons(actor, client_today);
  perform public.ensure_user_season(actor, active_season, 0);
  perform public.reconcile_rank_season(actor, active_season, client_today);

  return query
  select
    usr.season_index,
    rks.starts_on,
    rks.ends_on,
    rks.theme_name,
    usr.starting_rp,
    usr.current_rp,
    usr.peak_rp,
    public.rank_for_rp(usr.current_rp),
    public.rank_for_rp(usr.peak_rp),
    usr.workouts_completed,
    usr.scheduled_days_total,
    usr.scheduled_days_completed,
    usr.longest_streak
  from public.user_season_ranks as usr
  join public.rank_seasons as rks on rks.season_index = usr.season_index
  where usr.user_id = actor and usr.season_index = active_season;
end;
$$;

revoke all on function public.sync_my_rank(date) from public;
revoke all on function public.sync_my_rank(date) from anon;
grant execute on function public.sync_my_rank(date) to authenticated;

/** Kapanmış (arşivlenmiş) sezonlarım. Salt okunur; hiçbir şey değiştirmez. */
create or replace function public.get_my_rank_history()
returns table (
  season_index integer,
  starts_on date,
  ends_on date,
  theme_name text,
  final_rp integer,
  final_rank text,
  peak_rank text,
  workouts_completed integer,
  scheduled_days_total integer,
  scheduled_days_completed integer,
  longest_streak integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  return query
  select
    usr.season_index,
    rks.starts_on,
    rks.ends_on,
    rks.theme_name,
    coalesce(usr.final_rp, 0),
    coalesce(usr.final_rank, 'bronze'),
    public.rank_for_rp(usr.peak_rp),
    usr.workouts_completed,
    usr.scheduled_days_total,
    usr.scheduled_days_completed,
    usr.longest_streak
  from public.user_season_ranks as usr
  join public.rank_seasons as rks on rks.season_index = usr.season_index
  where usr.user_id = actor
    and usr.finalized_at is not null
  order by usr.season_index desc;
end;
$$;

revoke all on function public.get_my_rank_history() from public;
revoke all on function public.get_my_rank_history() from anon;
grant execute on function public.get_my_rank_history() to authenticated;

/**
 * ARKADAŞIN rank özeti.
 *
 * `are_friends` ile korunur: arkadaş DEĞİLSE hiç satır dönmez. Ham
 * `rank_events`, gül bakiyesi veya sezon istatistiği DÖNDÜRMEZ — yalnızca
 * sezon numarası, güncel RP ve rank kimlikleri paylaşılır.
 *
 * SEZON SABİTLENMİŞTİR: yalnızca SUNUCUNUN güncel tarihine karşılık gelen
 * sezon indeksi döndürülür. Arkadaş yeni sezona henüz sync olmadıysa satırı
 * hâlâ eski sezona aittir; "en yeni açık satır" seçilseydi ekranda GEÇEN
 * SEZONUN rozeti güncel rank gibi gösterilirdi. Böyle bir durumda hiç satır
 * dönmez ve rozet çizilmez.
 */
create or replace function public.get_friend_rank(target_user_id uuid)
returns table (
  season_index integer,
  current_rp integer,
  current_rank text,
  peak_rank text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    usr.season_index,
    usr.current_rp,
    public.rank_for_rp(usr.current_rp),
    public.rank_for_rp(usr.peak_rp)
  from public.user_season_ranks as usr
  where (select auth.uid()) is not null
    and usr.user_id = target_user_id
    and usr.finalized_at is null
    -- Sunucu günü otoritedir; istemci sezon seçemez.
    and usr.season_index = public.rank_season_index_for(current_date)
    and public.are_friends((select auth.uid()), target_user_id)
  limit 1;
$$;

revoke all on function public.get_friend_rank(uuid) from public;
revoke all on function public.get_friend_rank(uuid) from anon;
grant execute on function public.get_friend_rank(uuid) to authenticated;

commit;
