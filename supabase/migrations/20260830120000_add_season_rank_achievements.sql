/**
 * SEZON BAŞARILARI — yalnızca görsel rozet koleksiyonu.
 *
 * EKONOMİK ETKİ YOKTUR
 * --------------------
 * Bu dosya RP, XP, gül, level, rank eşiği, sezon uzunluğu ve soft reset
 * formülüne HİÇ DOKUNMAZ. `rank_events`, `user_season_ranks`, `reward_ledger`
 * ve `user_progress` tablolarına TEK BİR SATIR bile yazmaz; yalnızca okur.
 * Başarılar hiçbir ödül üretmediği için "bir kez açıldı, kalıcı" davranışı
 * ekonomiyi etkileyemez.
 *
 * KANIT OTORİTESİ — hiçbir şey yeniden hesaplanmaz
 * ------------------------------------------------
 *   * Antrenman sayısı  → `workout_sessions` (`status='completed'`,
 *     `deleted_at is null`) — `sync_my_rank`'in `workouts_completed`
 *     istatistiğiyle BİREBİR aynı yüklem.
 *   * Disiplin serisi   → `public.rank_peak_streak(...)` — reconciler'ın
 *     kullandığı aynı fonksiyon, aynı pencere. O da `rank_day_state`'e dayanır
 *     ve `manual_discipline_statuses` tablosunu HİÇ okumaz.
 *   * Mükemmel hafta    → `rank_events` içindeki `weekly_perfect` satırlarının
 *     HAFTA BAŞINA NET toplamı. Telafi edilmiş bir hafta (`+25` ardından
 *     `-25`) net 0 verir ve rozet AÇMAZ.
 *
 * GÜVENLİK MODELİ
 * ---------------
 *   * İstemci `user_id`, sezon numarası, ilerleme veya tamamlanma GÖNDEREMEZ.
 *     RPC'nin tek parametresi `client_today`'dir ve `assert_client_today` ile
 *     ±1 güne kilitlidir.
 *   * Aktif kullanıcı yalnızca `auth.uid()` ile belirlenir.
 *   * Tabloda istemci için insert/update/delete policy'si YOKTUR; yalnızca
 *     kendi satırını okuma izni vardır. Yazma tek noktadan, `security definer`
 *     RPC'den yapılır.
 *   * `anon` yetkileri kaldırılır.
 *   * Başka kullanıcıların başarıları bu fazda HİÇBİR yoldan açılmaz.
 *   * Yanıt yalnızca ekranda gereken güvenli alanları taşır: ham workout
 *     setleri, notlar, program ayrıntısı, rank event metadata'sı ve profil
 *     verisi DÖNMEZ.
 *
 * TEKRAR ÇALIŞTIRMA — bütün nesneler `if not exists` / `or replace` ile
 * tanımlanır ve tek transaction içinde uygulanır.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Başarı defteri — append-only, kullanıcı+sezon+anahtar başına TEK satır
-- ---------------------------------------------------------------------------

create table if not exists public.season_rank_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_index integer not null references public.rank_seasons(season_index),
  achievement_key text not null check (
    achievement_key in (
      'first_workout',
      'workout_5',
      'workout_15',
      'streak_3',
      'streak_7',
      'perfect_week'
    )
  ),
  unlocked_at timestamptz not null default timezone('utc', now()),
  /**
   * Birincil anahtar AYNI ZAMANDA idempotency anahtarıdır: aynı kullanıcı +
   * aynı sezon + aynı başarı ikinci kez yazılamaz. Eşzamanlı iki RPC çağrısı
   * `on conflict do nothing` ile tek satır üretir.
   *
   * Satır içi bildirim olduğu için PostgreSQL bu constraint'e `<tablo>_pkey`
   * kalıbıyla `season_rank_achievements_pkey` adını verir; RPC çakışma
   * hedefini TAM OLARAK bu adla belirtir (bkz. `sync_my_season_achievements`
   * içindeki `on conflict on constraint` açıklaması).
   */
  primary key (user_id, season_index, achievement_key)
);

create index if not exists season_rank_achievements_user_season_idx
on public.season_rank_achievements (user_id, season_index);

alter table public.season_rank_achievements enable row level security;

revoke all on table public.season_rank_achievements from anon;
revoke all on table public.season_rank_achievements from authenticated;
grant select on table public.season_rank_achievements to authenticated;

drop policy if exists "season_rank_achievements_select_own" on public.season_rank_achievements;
create policy "season_rank_achievements_select_own"
on public.season_rank_achievements for select
to authenticated
using ((select auth.uid()) = user_id);
-- Bilinçli olarak insert/update/delete policy'si YOK: istemci yazamaz.
-- Arkadaş erişimi de YOK: bu faz yalnızca kullanıcının kendi rozetlerini açar.

comment on table public.season_rank_achievements is
  'Cosmetic per-season achievement badges. Grants no RP, XP or currency.';

-- ---------------------------------------------------------------------------
-- 2) Başarı eşikleri — TEK kaynak
-- ---------------------------------------------------------------------------

/**
 * Hedef değerler tek bir yerde durur; ilerleme ve kilit kararı aynı tablodan
 * okunur, iki yerde ayrı ayrı yazılmaz.
 *
 * `sort_order` yanıtın SABİT sırasını belirler: istemci sıralama yapmaz.
 */
create or replace function public.season_achievement_catalog()
returns table (
  achievement_key text,
  target_progress integer,
  sort_order integer
)
language sql
immutable
set search_path = ''
as $$
  select *
  from (values
    ('first_workout', 1, 1),
    ('workout_5', 5, 2),
    ('workout_15', 15, 3),
    ('streak_3', 3, 4),
    ('streak_7', 7, 5),
    ('perfect_week', 1, 6)
  ) as catalog(achievement_key, target_progress, sort_order);
$$;

revoke all on function public.season_achievement_catalog() from public;
revoke all on function public.season_achievement_catalog() from anon;
revoke all on function public.season_achievement_catalog() from authenticated;

-- ---------------------------------------------------------------------------
-- 3) Kazanım kontrolü + okuma — tek RPC
-- ---------------------------------------------------------------------------

/**
 * Güncel sezonun başarılarını uzlaştırır ve ALTI satırın tamamını sabit
 * sırada döndürür.
 *
 * KALICILIK — satırlar yalnızca EKLENİR, hiç silinmez. Bir antrenman sonradan
 * silinirse `current_progress` düşebilir ama `is_unlocked` TABLODAN okunduğu
 * için rozet geri alınmaz. Rozet hiçbir ödül üretmediğinden bu kalıcılık
 * RP/XP/gül tarafını etkilemez.
 *
 * IDEMPOTENCY — `on conflict on constraint season_rank_achievements_pkey do
 * nothing`. İkinci çağrı yeni satır yazmaz,
 * `unlocked_at` DEĞİŞMEZ (ilk kazanım anı korunur) ve eşzamanlı iki çağrı
 * birincil anahtar sayesinde tek satır üretir.
 */
create or replace function public.sync_my_season_achievements(client_today date)
returns table (
  achievement_key text,
  is_unlocked boolean,
  unlocked_at timestamptz,
  current_progress integer,
  target_progress integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Sezon başından öncesine bakılan seri penceresi; reconciler ile aynı.
  streak_lookback constant integer := 120;
  actor uuid := auth.uid();
  target_season integer;
  season_start date;
  season_end date;
  epoch_date date;
  scan_from date;
  scan_to date;
  workout_count integer := 0;
  peak_streak integer := 0;
  has_perfect_week boolean := false;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- İstemcinin yerel günü ±1 güne kilitlenir; sezonu SUNUCU belirler.
  perform public.assert_client_today(client_today);

  target_season := public.rank_season_index_for(client_today);
  -- Yabancı anahtar için sezon satırının var olduğundan emin olunur.
  perform public.ensure_rank_season(target_season);

  select rks.starts_on, rks.ends_on into season_start, season_end
  from public.rank_seasons as rks
  where rks.season_index = target_season;

  select rs.rp_epoch into epoch_date from public.rank_settings as rs limit 1;

  if season_start is null or epoch_date is null then
    -- Rank sistemi henüz hazır değil: hiçbir şey yazılmaz, boş ilerleme döner.
    return query
    select
      c.achievement_key,
      false,
      null::timestamptz,
      0,
      c.target_progress
    from public.season_achievement_catalog() as c
    order by c.sort_order;
    return;
  end if;

  -- Pencere: sezonun içi, epoch'tan sonrası, bugüne kadar.
  scan_from := greatest(season_start, epoch_date);
  scan_to := least(season_end, client_today);

  if scan_from <= scan_to then
    /**
     * ANTRENMAN SAYISI — `sync_my_rank`'in `workouts_completed` yüklemiyle
     * BİREBİR aynı: tamamlanmış ve silinmemiş oturumlar.
     */
    select count(*)::integer into workout_count
    from public.workout_sessions as s
    where s.user_id = actor
      and s.status = 'completed'
      and s.deleted_at is null
      and s.workout_date between scan_from and scan_to;

    /**
     * DİSİPLİN SERİSİ — reconciler'ın kullandığı kanıt fonksiyonu. Pencere
     * sezon öncesine uzanır (seri sınırı aşabilir) ama zirve YALNIZCA sezon
     * içinde sayılır (`count_from = scan_from`).
     */
    peak_streak := public.rank_peak_streak(
      actor,
      greatest(epoch_date, scan_from - streak_lookback),
      scan_to,
      scan_from
    );
  end if;

  /**
   * MÜKEMMEL HAFTA — kanıt HAFTA BAŞINA NET RP toplamıdır.
   *
   * Defter append-only'dir ve `apply_rank_adjustment` bir kanıt geçersizleşince
   * TELAFİ SATIRI yazar. Aynı hafta için şu dizi oluşabilir:
   *
   *     2026-08-24#0   +25
   *     2026-08-24#1   -25
   *
   * Bu haftanın NET toplamı 0'dır ve bonus artık kazanılmış SAYILMAZ. Tek bir
   * pozitif satırın varlığına bakmak yanlış olurdu: telafi edilmiş bir hafta
   * rozeti açardı.
   *
   * `source_key` aynı kanıt birimi için üç biçimde olabilir — `YYYY-MM-DD`
   * (eski sabit anahtar), `YYYY-MM-DD:revoked` (eski telafi) ve
   * `YYYY-MM-DD#n` (güncel sıralı düzeltmeler). İki kademeli `split_part`
   * üçünü de aynı hafta anahtarına indirger; hafta anahtarı bir tarih olduğu
   * için `#` veya `:` içermez ve normalizasyon belirsizlik üretmez.
   *
   * Gruplama hafta bazındadır: bir haftanın telafisi BAŞKA bir haftanın
   * geçerli bonusunu iptal edemez. Kullanıcı ve sezon filtreleri de aynı
   * nedenle gruplamadan ÖNCE uygulanır.
   */
  select exists (
    select 1
    from public.rank_events as re
    where re.user_id = actor
      and re.season_index = target_season
      and re.event_type = 'weekly_perfect'
    group by split_part(split_part(re.source_key, '#', 1), ':', 1)
    having sum(re.rp_delta) > 0
  ) into has_perfect_week;

  -- Kazanılan başarılar yazılır. Yalnızca EKLEME; güncelleme/silme YOK.
  insert into public.season_rank_achievements (user_id, season_index, achievement_key)
  select actor, target_season, c.achievement_key
  from public.season_achievement_catalog() as c
  where case c.achievement_key
    when 'perfect_week' then has_perfect_week
    when 'streak_3' then peak_streak >= c.target_progress
    when 'streak_7' then peak_streak >= c.target_progress
    else workout_count >= c.target_progress
  end
  /**
   * ÇAKIŞMA HEDEFİ SÜTUN LİSTESİYLE DEĞİL, CONSTRAINT ADIYLA verilir.
   *
   * `returns table (...)` her çıktı sütunu için aynı adda bir PL/pgSQL
   * DEĞİŞKENİ üretir ve bu değişkenler fonksiyon gövdesinin tamamında
   * kapsamdadır. Sütun listesi biçimi (`on conflict (…, achievement_key)`)
   * bir İFADE olarak çözümlendiği için `achievement_key` hem çıktı
   * değişkenine hem tablo sütununa işaret eder ve PostgreSQL
   * `42702: column reference "achievement_key" is ambiguous` hatası verir.
   *
   * Constraint adı bir ifade değildir; ad çözümlemesi yapılmaz ve belirsizlik
   * oluşamaz. `season_rank_achievements_pkey`, yukarıdaki satır içi
   * `primary key (user_id, season_index, achievement_key)` bildiriminin
   * PostgreSQL tarafından otomatik verilen adıdır (`<tablo>_pkey`) —
   * idempotency garantisi birebir aynı üçlü anahtar üzerindedir.
   */
  on conflict on constraint season_rank_achievements_pkey do nothing;

  -- Altı satırın tamamı SABİT sırada döner; kilit durumu DEFTERDEN okunur.
  return query
  select
    c.achievement_key,
    (a.user_id is not null) as is_unlocked,
    a.unlocked_at,
    case c.achievement_key
      when 'perfect_week' then (case when has_perfect_week then 1 else 0 end)
      when 'streak_3' then least(peak_streak, c.target_progress)
      when 'streak_7' then least(peak_streak, c.target_progress)
      else least(workout_count, c.target_progress)
    end as current_progress,
    c.target_progress
  from public.season_achievement_catalog() as c
  left join public.season_rank_achievements as a
    on a.user_id = actor
    and a.season_index = target_season
    and a.achievement_key = c.achievement_key
  order by c.sort_order;
end;
$$;

revoke all on function public.sync_my_season_achievements(date) from public;
revoke all on function public.sync_my_season_achievements(date) from anon;
grant execute on function public.sync_my_season_achievements(date) to authenticated;

comment on function public.sync_my_season_achievements(date) is
  'Reconciles and returns the authenticated user current-season cosmetic achievements. Writes no RP, XP or currency.';

commit;
