/**
 * KARİYER BAŞARIMLARI — SEZONDAN BAĞIMSIZ, KALICI KOLEKSİYON (EKLEMELİ)
 *
 * Bu sistem, `season_rank_achievements` (sezonluk) sisteminden AYRIDIR ve onu
 * DEĞİŞTİRMEZ/SİLMEZ (eski istemciler için korunur). Başarımlar hesap ömrü
 * boyunca KALICIDIR: sezon değişince sıfırlanmaz, bir kez açılan asla yeniden
 * kilitlenmez. `easy/medium/hard` yalnız SUNUM kategorisidir.
 *
 * EKONOMİK ETKİ YOKTUR — RP, XP, roses, level, rank eşiği HİÇ değişmez. Bu dosya
 * yalnız kendi defter/katalog nesnelerini oluşturur ve mevcut domain tablolarını
 * SALT OKUR.
 *
 * KANIT OTORİTESİ — istemci sayaç/ilerleme/user_id GÖNDEREMEZ. Her ilerleme
 * SUNUCUDA gerçek domain verisinden (workout_sessions, workout_sets,
 * workout_activity_records, programs, friendships, friend_messages,
 * ai_coach_messages, user_progress, user_season_ranks, rank_events, disiplin
 * fonksiyonları) yeniden hesaplanır. Aktif kullanıcı yalnız `auth.uid()`.
 *
 * OTUZ BAŞARIMIN HEPSİ SUNUCUDA TÜRETİLİR (kaynaksız/kalıcı-0 başarım YOKTUR):
 *   * `on_the_podium`  — bu migration `career_podium_results` (KAPANMIŞ hafta için
 *     DEĞİŞMEZ, sunucu-otoriteli snapshot) + `career_finalize_podium(actor)`
 *     ekler. Katılımcı çevresi, hafta-kapanış anındaki arkadaşlık geçmişinden
 *     (`friendship_intervals`) kurulur; sıra dense_rank; yalnız kapanmış haftalar.
 *   * `coach_to_the_top` — `ai_workout_analyses` (workout kimliğine bağlı, atomik
 *     claim/state defteri) sayılır; YALNIZ `completed` + geçerli `result` benzersiz
 *     analizler. Edge Function service-role akışı yazar; istemci yazamaz.
 * Diğer 28 başarım da gerçek domain tablolarından türetilir (aşağıdaki sync).
 * `ACHIEVEMENTS_PENDING_SOURCE` (istemci) BOŞTUR.
 *
 * ARKADAŞLIK GEÇMİŞİ "APPEND-ONLY + KONTROLLÜ KAPANIŞ" — `friendship_intervals`
 * satırları yalnız EKLENİR; `ended_at` yalnız trigger içindeki kontrollü
 * sunucu-içi durum geçişiyle (accepted→değil / DELETE) set edilir (serbest UPDATE
 * yoktur, geçmiş yeniden yazılamaz). Dışarıdan çağrılabilir aç/kapat yardımcısı
 * YOKTUR → istemci sahte katılımcı geçmişi üretemez.
 *
 * TEKRAR ÇALIŞTIRMA — bütün nesneler `if not exists`/`or replace` ile, tek
 * transaction içinde. İdempotent. Sonda bir ACL DENETİMİ (bkz. §6), güvenlik
 * yüzeyini apply anında doğrular.
 */

begin;

-- ---------------------------------------------------------------------------
-- ACL DENETİMİ İÇİN ÖN-SNAPSHOT (§6 ile birlikte). Migration ÇALIŞMADAN ÖNCE var
-- olan security-definer fonksiyonlarını kaydeder; sonda "yeni oluşturulanlar"
-- (create-or-replace ile OID'i korunanlar hariç) kesin olarak hesaplanıp bilinçli
-- allowlist'e karşı denetlenir → listeye eklenmemiş HERHANGİ yeni security-definer
-- fonksiyonu apply anında migrationı BAŞARISIZ yapar (gerçekten genel denetim).
-- ---------------------------------------------------------------------------
drop table if exists _career_pre_secdef;
create temporary table _career_pre_secdef on commit drop as
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;

-- ---------------------------------------------------------------------------
-- 0) AI KOTA/LOG — `workout_analysis` AYRI, DOĞRU feature olarak eklenir
-- ---------------------------------------------------------------------------
/**
 * `coach_to_the_top` için Edge Function belirli bir workout'a AI analizi çağırır.
 * Bu istekler mevcut `consume_ai_quota` (Gemini kotası) ile sınırlanır ve
 * `ai_requests`'e loglanır — ama AYRI bir feature olarak: `workout_analysis`.
 *
 * ÖNEMLİ — idempotency/kota anahtarı `ai_quota_events.request_key` UUID'dir.
 * Edge Function `analysis:<sessionId>` gibi UUID OLMAYAN bir değer GÖNDERMEZ;
 * doğrudan `workout_session_id` (gerçek UUID) request_key olur → aynı session'ın
 * tekrarı günlük kotayı İKİ KEZ tüketmez.
 *
 * EKLEMELİDİR — mevcut sohbet/özet kotaları ve constraint'leri BOZULMAZ; yalnız
 * izin verilen feature kümesine `workout_analysis` eklenir. Uygulanmış
 * migrationlar değiştirilmez; constraint adları güvenle bulunup yeniden kurulur.
 */
do $$
declare cname text;
begin
  -- ai_quota_events.feature: 'chat' → 'chat','workout_analysis' (tablo varsa).
  if to_regclass('public.ai_quota_events') is not null then
    select con.conname into cname
    from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname='public' and rel.relname='ai_quota_events' and con.contype='c'
      and pg_get_constraintdef(con.oid) ilike '%feature%';
    if cname is not null then execute format('alter table public.ai_quota_events drop constraint %I', cname); end if;
    alter table public.ai_quota_events
      add constraint ai_quota_events_feature_check check (feature in ('chat','workout_analysis'));
  end if;

  -- ai_requests.feature: +workout_analysis (mevcutlar korunur; tablo varsa).
  if to_regclass('public.ai_requests') is not null then
    select con.conname into cname
    from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname='public' and rel.relname='ai_requests' and con.contype='c'
      and pg_get_constraintdef(con.oid) ilike '%feature%';
    if cname is not null then execute format('alter table public.ai_requests drop constraint %I', cname); end if;
    alter table public.ai_requests
      add constraint ai_requests_feature_check check (feature in ('weekly_summary','exercise_progress','chat','workout_analysis'));
  end if;
end $$;

/**
 * `consume_ai_quota` artık `workout_analysis` feature'ını da kabul eder (EKLEMELİ;
 * 'chat' davranışı DEĞİŞMEZ). İmza korunur (uuid, uuid, text, integer). Kota
 * penceresi ve advisory lock aynıdır; günlük AI bütçesi Gemini çağrıları arasında
 * paylaşılır. Yalnız `service_role` çalıştırır.
 */
create or replace function public.consume_ai_quota(
  requested_user_id uuid,
  requested_key uuid,
  requested_feature text,
  requested_limit integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if requested_feature not in ('chat','workout_analysis') then
    raise exception 'unsupported ai feature';
  end if;
  if requested_limit < 1 or requested_limit > 100 then
    raise exception 'invalid ai limit';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_user_id::text, 1));

  -- Aynı anahtar (aynı session/mesaj) tekrarı çift saymaz.
  if exists (
    select 1 from public.ai_quota_events
    where user_id = requested_user_id and request_key = requested_key
  ) then
    return true;
  end if;

  select count(*) into recent_count
  from public.ai_quota_events
  where user_id = requested_user_id
    and created_at >= timezone('utc', now()) - interval '24 hours';
  if recent_count >= requested_limit then
    return false;
  end if;

  insert into public.ai_quota_events (user_id, request_key, feature)
  values (requested_user_id, requested_key, requested_feature);
  return true;
end;
$$;
revoke all on function public.consume_ai_quota(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 1) KALICI AÇILMA DEFTERİ — kullanıcı + anahtar başına TEK satır, append-only
-- ---------------------------------------------------------------------------
create table if not exists public.career_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_key text not null check (
    achievement_key in (
      'first_step','warmup_done','rhythm_found','three_day_spark','weekly_flame',
      'perfect_week','own_path','pulse_rising','wise_counsel','social_step',
      'new_perspective','first_message','rose_bud','first_rank_up','cardio_discipline',
      'strong_circle','ten_ton_club','program_loyalty','pr_hunter','half_century',
      'full_bloom','on_the_podium','rosea_rank','cardio_traveler','against_time',
      'quarter_million','thirty_day_discipline','iron_will_100','thousand_sets','coach_to_the_top'
    )
  ),
  unlocked_at timestamptz not null default timezone('utc', now()),
  -- Birincil anahtar AYNI ZAMANDA idempotency anahtarı: aynı kullanıcı+anahtar
  -- ikinci kez yazılamaz; eşzamanlı iki sync tek satır üretir (pkey adı
  -- `career_achievements_pkey`).
  primary key (user_id, achievement_key)
);

create index if not exists career_achievements_user_idx
  on public.career_achievements (user_id);

alter table public.career_achievements enable row level security;
revoke all on table public.career_achievements from anon;
revoke all on table public.career_achievements from authenticated;
grant select on table public.career_achievements to authenticated;

drop policy if exists "career_achievements_select_own" on public.career_achievements;
create policy "career_achievements_select_own"
  on public.career_achievements for select
  to authenticated
  using ((select auth.uid()) = user_id);
-- Bilinçli: insert/update/delete policy YOK → istemci yazamaz. Tek yazma yolu
-- aşağıdaki security-definer `sync_my_achievements` RPC'sidir.

comment on table public.career_achievements is
  'Permanent, season-independent cosmetic achievement unlocks. Grants no RP, XP or currency.';

-- ---------------------------------------------------------------------------
-- 2) KATALOG — TEK kaynak: anahtar, kategori, hedef, sıra, ilerleme türü
-- ---------------------------------------------------------------------------
create or replace function public.achievement_catalog()
returns table (
  achievement_key text,
  category text,
  target_progress integer,
  sort_order integer,
  progress_kind text
)
language sql
immutable
set search_path = ''
as $$
  select *
  from (values
    -- key, category, target, sort, kind
    ('first_step','easy',1,1,'boolean'),
    ('warmup_done','easy',5,2,'count'),
    ('rhythm_found','easy',15,3,'count'),
    ('three_day_spark','easy',3,4,'count'),
    ('weekly_flame','easy',7,5,'count'),
    ('perfect_week','easy',1,6,'boolean'),
    ('own_path','easy',1,7,'boolean'),
    ('pulse_rising','easy',1,8,'boolean'),
    ('wise_counsel','easy',1,9,'boolean'),
    ('social_step','easy',1,10,'boolean'),
    ('new_perspective','medium',1,11,'boolean'),
    ('first_message','medium',1,12,'boolean'),
    ('rose_bud','medium',1,13,'boolean'),
    ('first_rank_up','medium',1,14,'boolean'),
    ('cardio_discipline','medium',10,15,'count'),
    ('strong_circle','medium',5,16,'count'),
    ('ten_ton_club','medium',10000,17,'count'),
    ('program_loyalty','medium',14,18,'count'),
    ('pr_hunter','medium',3,19,'count'),
    ('half_century','medium',50,20,'count'),
    ('full_bloom','hard',200,21,'count'),
    ('on_the_podium','hard',1,22,'boolean'),
    ('rosea_rank','hard',1,23,'boolean'),
    ('cardio_traveler','hard',100000,24,'count'),
    ('against_time','hard',30000,25,'count'),
    ('quarter_million','hard',250000,26,'count'),
    ('thirty_day_discipline','hard',30,27,'count'),
    ('iron_will_100','hard',100,28,'count'),
    ('thousand_sets','hard',1000,29,'count'),
    ('coach_to_the_top','hard',30,30,'count')
  ) as c(achievement_key, category, target_progress, sort_order, progress_kind);
$$;

revoke all on function public.achievement_catalog() from public;
revoke all on function public.achievement_catalog() from anon;
revoke all on function public.achievement_catalog() from authenticated;

-- ---------------------------------------------------------------------------
-- 3) KANONİK PR SAYACI — tek, belgelenmiş, sunucu tarafı tanım
-- ---------------------------------------------------------------------------
/**
 * Projede önceden bir PR tanımı YOKTU; kanonik tanım burada kurulur.
 *
 * AĞIRLIK REKORU (kanonik) — projede başka PR tanımı YOKTUR; burada tek,
 * belgelenmiş tanım kurulur. HAREKET KİMLİĞİ `workout_sets.exercise_name`
 * (her sette zorunlu). Aynı isim aynı hareket.
 *
 * PR OLAYI — YALNIZCA AĞIRLIK takip eden (weighted) setlerde. Bir hareketin bir
 * GÜNDEKİ en yüksek geçerli ağırlığı (`weight_kg > 0` ve `repetitions > 0`), o
 * hareketin DAHA ÖNCEKİ (kesin daha erken tarihli) tamamlanmış oturumlarındaki
 * en yüksek geçerli ağırlığı KESİN (strict `>`) aştığında bir PR günüdür.
 *   * EŞİT değer PR DEĞİLDİR.
 *   * İptal/silinmiş oturumlar (status<>'completed' / deleted_at) SAYILMAZ.
 *   * Süre/mesafe egzersizleri (weight_kg yok) SAYILMAZ.
 *   * Karşılaştırma ÖNCEKİ SEANSLARADIR: aynı gün içindeki setler intra-day PR
 *     üretmez (gün başına en fazla bir PR; hareket-gün bazında).
 *
 * Sonuç: kullanıcının kariyeri boyunca DOĞRULANMIŞ ağırlık rekoru SAYISI.
 */
create or replace function public.career_pr_count(target_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with day_max as (
    -- hareket + gün başına en yüksek geçerli ağırlık
    select ws.exercise_name, s.workout_date as d, max(ws.weight_kg) as day_best
    from public.workout_sets as ws
    join public.workout_sessions as s on s.id = ws.session_id
    where s.user_id = target_user
      and s.status = 'completed'
      and s.deleted_at is null
      and ws.weight_kg is not null and ws.weight_kg > 0
      and ws.repetitions is not null and ws.repetitions > 0
    group by ws.exercise_name, s.workout_date
  ),
  ranked as (
    select
      exercise_name, d, day_best,
      -- yalnız DAHA ERKEN TARİHLİ günlerin en yüksek ağırlığı
      max(day_best) over (
        partition by exercise_name
        order by d
        rows between unbounded preceding and 1 preceding
      ) as prior_best
    from day_max
  )
  -- İlk gün her zaman PR (prior_best null); sonra strict aşım (eşit sayılmaz).
  select count(*)::integer from ranked where prior_best is null or day_best > prior_best;
$$;

revoke all on function public.career_pr_count(uuid) from public;
revoke all on function public.career_pr_count(uuid) from anon;
revoke all on function public.career_pr_count(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 4) PROGRAM SADAKATİ — 14 ardışık takvim günü, planlanan hiçbir antrenman
--    kaçırılmadan (dinlenme günleri nötr). En uzun temiz aralık ≥ 14 mü?
-- ---------------------------------------------------------------------------
/**
 * `rank_day_state` her gün için `state` ('completed'/'partial'/'missed'/null) ve
 * `is_scheduled_workout` verir. KÖTÜ gün = planlı (`is_scheduled_workout`) ve
 * `state <> 'completed'`. İYİ planlı gün = planlı ve tamamlanmış. Dinlenme/
 * programsız günler nötrdür (aralığı bozmaz, tek başına doldurmaz).
 *
 * Sadakat = KÖTÜ gün içermeyen VE en az bir İYİ planlı gün barındıran, en az 14
 * ardışık TAKVİM günü uzunluğunda bir aralık bulunması.
 */
create or replace function public.career_program_loyalty(target_user uuid, from_date date, to_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  run_start date;
  prev date;
  good_in_run boolean := false;
  achieved boolean := false;
begin
  if from_date is null or to_date is null or from_date > to_date then
    return false;
  end if;
  run_start := null;
  prev := null;
  for r in
    select d.day_date,
           d.state,
           d.is_scheduled_workout
    from public.rank_day_state(target_user, from_date, to_date) as d
    order by d.day_date
  loop
    if r.is_scheduled_workout and coalesce(r.state,'') <> 'completed' then
      -- KÖTÜ gün: aralık kapanır.
      run_start := null; good_in_run := false;
    else
      if run_start is null then
        run_start := r.day_date; good_in_run := false;
      end if;
      if r.is_scheduled_workout and r.state = 'completed' then
        good_in_run := true;
      end if;
      if good_in_run and (r.day_date - run_start + 1) >= 14 then
        achieved := true;
        exit;
      end if;
    end if;
    prev := r.day_date;
  end loop;
  return achieved;
end;
$$;

revoke all on function public.career_program_loyalty(uuid, date, date) from public;
revoke all on function public.career_program_loyalty(uuid, date, date) from anon;
revoke all on function public.career_program_loyalty(uuid, date, date) from authenticated;

-- ---------------------------------------------------------------------------
-- 4b) ÖZELLİK EPOCH'U — podyum yalnız özellik yürürlüğe girdikten SONRAKİ
--     haftalardan değerlendirilir (geçmiş haftalara sahte backfill YAPILMAZ:
--     arkadaşlık geçmişini kanıtlayan veri yok, o yüzden yalnız ileri yönlü).
-- ---------------------------------------------------------------------------
create table if not exists public.career_feature_config (
  feature text primary key,
  effective_from date not null default (timezone('utc', now()))::date
);
alter table public.career_feature_config enable row level security;
revoke all on table public.career_feature_config from anon;
revoke all on table public.career_feature_config from authenticated;
-- Migration'ın uygulandığı GÜN epoch olur (canlıda deploy günü). İstemci okuyamaz/yazamaz.
insert into public.career_feature_config (feature) values ('podium') on conflict (feature) do nothing;

-- ---------------------------------------------------------------------------
-- 4b2) ARKADAŞLIK GEÇMİŞİ — append-only aralıklar (hafta-sonu çevre kanıtı)
-- ---------------------------------------------------------------------------
/**
 * Podyumun hafta-kapanış katılımcıları GEÇMİŞ arkadaşlık durumundan kurulur;
 * "ilk sync anındaki güncel arkadaş listesi"nden DEĞİL. Bu tablo her kabul
 * edilmiş arkadaşlık için (başlangıç, bitiş) aralığını tutar (append-only).
 *
 *   * Kabul → yeni aralık açılır (started_at = now).
 *   * Kaldırma/engelleme (DELETE) → açık aralık kapanır (ended_at = now).
 * Çift her zaman (user_low < user_high) kanonik sırasıyla saklanır.
 *
 * SEED — migration anında MEVCUT kabul edilmiş arkadaşlıklar epoch başlangıcıyla
 * (deploy günü) açık aralık olarak eklenir; DAHA ESKİ geçmiş UYDURULMAZ. İstemci
 * bu tabloya erişemez (grant yok); yalnız sunucu trigger'ları yazar.
 */
create table if not exists public.friendship_intervals (
  id bigint generated always as identity primary key,
  user_low uuid not null,
  user_high uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  constraint friendship_intervals_order check (user_low < user_high)
);
create index if not exists friendship_intervals_pair_idx on public.friendship_intervals (user_low, user_high);
create index if not exists friendship_intervals_open_idx on public.friendship_intervals (user_low, user_high) where ended_at is null;
alter table public.friendship_intervals enable row level security;
revoke all on table public.friendship_intervals from anon, authenticated;
-- İstemci erişimi YOK: yalnız sunucu (trigger/finalizer, security definer) okur/yazar.

/**
 * friendships değişimlerini aralık geçmişine yansıtan trigger. GÜVENLİK: aralık
 * AÇMA/KAPATMA mantığı YALNIZCA bu trigger fonksiyonunun içindedir — dışarıdan
 * çağrılabilir `friendship_interval_open/close` yardımcıları KALDIRILDI. Böylece
 * hiçbir istemci (authenticated) sahte arkadaşlık başlangıcı üretemez, keyfî
 * `started_at`/`ended_at` gönderemez ya da gerçek bir aralığı kapatarak podyum
 * katılımcı geçmişini oynayamaz. Zaman damgası DAİMA sunucu saatidir (now, UTC).
 *
 * "APPEND-ONLY + KONTROLLÜ KAPANIŞ" — satırlar yalnız EKLENİR; `ended_at` YALNIZ
 * burada, gerçek bir friendships durum geçişine (accepted→değil, ya da DELETE)
 * karşılık kontrollü bir sunucu-içi güncellemeyle set edilir. Serbest UPDATE yok;
 * geçmiş yeniden yazılamaz. Tablo istemciye tamamen kapalıdır (grant yok).
 */
create or replace function public.friendship_intervals_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  now_ts timestamptz := timezone('utc', now());
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted' and new.requester_id <> new.receiver_id then
      insert into public.friendship_intervals (user_low, user_high, started_at)
      select least(new.requester_id, new.receiver_id), greatest(new.requester_id, new.receiver_id), now_ts
      where not exists (
        select 1 from public.friendship_intervals fi
        where fi.user_low = least(new.requester_id, new.receiver_id)
          and fi.user_high = greatest(new.requester_id, new.receiver_id) and fi.ended_at is null
      );
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status = 'accepted' and old.status <> 'accepted' and new.requester_id <> new.receiver_id then
      insert into public.friendship_intervals (user_low, user_high, started_at)
      select least(new.requester_id, new.receiver_id), greatest(new.requester_id, new.receiver_id), now_ts
      where not exists (
        select 1 from public.friendship_intervals fi
        where fi.user_low = least(new.requester_id, new.receiver_id)
          and fi.user_high = greatest(new.requester_id, new.receiver_id) and fi.ended_at is null
      );
    elsif old.status = 'accepted' and new.status <> 'accepted' then
      update public.friendship_intervals
      set ended_at = now_ts
      where user_low = least(old.requester_id, old.receiver_id)
        and user_high = greatest(old.requester_id, old.receiver_id) and ended_at is null;
    end if;
  elsif tg_op = 'DELETE' then
    if old.status = 'accepted' then
      update public.friendship_intervals
      set ended_at = now_ts
      where user_low = least(old.requester_id, old.receiver_id)
        and user_high = greatest(old.requester_id, old.receiver_id) and ended_at is null;
    end if;
    return old;
  end if;
  return new;
end;
$$;
-- Trigger fonksiyonu dışarıdan `select`'le ÇAĞRILAMAZ (trigger bağlamı gerekir);
-- yine de savunma derinliği için tüm istemci EXECUTE izinleri açıkça kaldırılır
-- ve service_role dâhil hiçbir role EXECUTE verilmez (yalnız trigger çalıştırır).
revoke all on function public.friendship_intervals_sync() from public;
revoke all on function public.friendship_intervals_sync() from anon;
revoke all on function public.friendship_intervals_sync() from authenticated;

drop trigger if exists friendships_intervals_sync_trg on public.friendships;
create trigger friendships_intervals_sync_trg
  after insert or update or delete on public.friendships
  for each row execute function public.friendship_intervals_sync();

-- SEED — mevcut kabul edilmiş arkadaşlıklar epoch başlangıcıyla açık aralık.
insert into public.friendship_intervals (user_low, user_high, started_at)
select least(f.requester_id, f.receiver_id), greatest(f.requester_id, f.receiver_id),
       ((select effective_from from public.career_feature_config where feature = 'podium'))::timestamptz
from public.friendships as f
where f.status = 'accepted'
  and not exists (
    select 1 from public.friendship_intervals fi
    where fi.user_low = least(f.requester_id, f.receiver_id)
      and fi.user_high = greatest(f.requester_id, f.receiver_id)
      and fi.ended_at is null
  );

-- ---------------------------------------------------------------------------
-- 4c) PODYUM — KAPANMIŞ HAFTA için DEĞİŞMEZ, SUNUCU-OTORİTELİ SNAPSHOT
-- ---------------------------------------------------------------------------
/**
 * Podyum başarımı, arkadaş listesi sonradan değişince değişebilen "anlık yeniden
 * hesap" DEĞİL, kapanmış haftanın FINALIZE edilmiş SNAPSHOT'ından okunur.
 *
 *   * `career_podium_results` append-only ve (user_id, week_start) başına
 *     DEĞİŞMEZ: bir kez yazılınca güncellenmez/silinmez → sonraki arkadaş
 *     ekleme/silme veya RP düzeltmesi sonucu DEĞİŞTİRMEZ.
 *   * Snapshot, haftanın KAPANMASINDAN sonra (Pazar < bugün) sunucu tarafında
 *     finalize edilir; katılımcı çevresi FINALIZE ANINDAKİ kabul edilmiş
 *     arkadaşlardır ve o an dondurulur.
 *   * İstemci tarih/puan/sıra/kazanan GÖNDEREMEZ ve bu tabloya YAZAMAZ (grant
 *     yok). Finalizer yalnız `sync_my_achievements` içinden (security definer)
 *     çağrılır; ayrı, keyfî çalıştırılabilir bir istemci RPC'si DEĞİLDİR.
 *   * Yalnız `podium` epoch'undan (özellik yürürlük günü) sonraki haftalar;
 *     kanıtlanamayan geçmiş arkadaşlığa sahte backfill YOK.
 */
create table if not exists public.career_podium_results (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  score integer not null,
  rank integer not null,
  finalized_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, week_start)
);
create index if not exists career_podium_results_user_idx on public.career_podium_results (user_id);

alter table public.career_podium_results enable row level security;
revoke all on table public.career_podium_results from anon;
revoke all on table public.career_podium_results from authenticated;
grant select on table public.career_podium_results to authenticated;
drop policy if exists "career_podium_results_select_own" on public.career_podium_results;
create policy "career_podium_results_select_own"
  on public.career_podium_results for select to authenticated
  using ((select auth.uid()) = user_id);
comment on table public.career_podium_results is
  'Immutable finalized weekly podium snapshots (on_the_podium evidence). Server-only writes; no RP/XP/currency.';

/**
 * FINALIZER — aktörün, henüz finalize edilmemiş KAPANMIŞ haftaları için değişmez
 * snapshot yazar. İSTEMCİ TARİHİ ALMAZ: kapanmış hafta kararı YALNIZ güvenilir
 * SUNUCU zamanıyla (`current_date`, UTC) verilir → kullanıcı Pazar günü Pazartesi
 * göndererek bitmemiş haftayı erken finalize EDEMEZ.
 *
 * Aday haftalar aktörün KENDİ `rank_events`'inden gelir (puan=0 hafta podyum
 * açamaz zaten). Her aday hafta için:
 *   * Haftalık puan gerçek `rank_events` RP toplamıdır.
 *   * KATILIMCILAR o haftanın KAPANIŞ ANINDAKİ arkadaşlık durumundan kurulur
 *     (`friendship_intervals`): sonradan eklenen/silinen arkadaş geçmiş sonucu
 *     DEĞİŞTİRMEZ; lazy finalization bir hafta sonra çalışsa da aynı küme çıkar.
 *   * Sıra `dense_rank` (eşit puan AYNI sıra) = 1 + kesin daha yüksek FARKLI
 *     arkadaş-puanı sayısı.
 * Zaten finalize edilmiş haftalar atlanır (idempotent; duplicate/update yok).
 * YALNIZ security definer (sync) çağırır; public/anon/authenticated'a KAPALI.
 */
create or replace function public.career_finalize_podium(actor uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.career_podium_results (user_id, week_start, score, rank)
  with pod_epoch as (
    select coalesce((select effective_from from public.career_feature_config where feature = 'podium'), current_date) as ef
  ),
  server_today as (select current_date as d),
  -- Aktörün KENDİ closed aday haftaları + haftalık puanı (SUNUCU zamanına göre kapalı).
  actor_weeks as (
    select w.week_start, sum(re.rp_delta) as actor_score
    from public.rank_events as re
    cross join lateral (select (split_part(split_part(re.source_key, '#', 1), ':', 1))::date as ev) as e
    cross join lateral (select e.ev - (extract(isodow from e.ev)::integer - 1) as week_start) as w
    where re.user_id = actor and re.source_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      and w.week_start >= (select ef from pod_epoch)
      and (w.week_start + 6) < (select d from server_today)
    group by w.week_start
  ),
  -- Her aday haftanın KAPANIŞ ANINDA (bir sonraki Pazartesi 00:00 UTC) aktif arkadaşlar.
  week_friends as (
    select
      aw.week_start,
      case when fi.user_low = actor then fi.user_high else fi.user_low end as friend_id
    from actor_weeks as aw
    join public.friendship_intervals as fi
      on (fi.user_low = actor or fi.user_high = actor)
     and fi.started_at < ((aw.week_start + 7)::timestamptz)
     and (fi.ended_at is null or fi.ended_at >= ((aw.week_start + 7)::timestamptz))
  ),
  friend_scores as (
    select wf.week_start, sum(re.rp_delta) as score
    from week_friends as wf
    join public.rank_events as re on re.user_id = wf.friend_id and re.source_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    cross join lateral (select (split_part(split_part(re.source_key, '#', 1), ':', 1))::date as ev) as e
    cross join lateral (select e.ev - (extract(isodow from e.ev)::integer - 1) as ws) as w
    where w.ws = wf.week_start
    group by wf.week_start, wf.friend_id
  ),
  ranked as (
    select
      aw.week_start,
      aw.actor_score as score,
      1 + (
        select count(distinct fs.score)
        from friend_scores as fs
        where fs.week_start = aw.week_start and fs.score > aw.actor_score
      ) as rank
    from actor_weeks as aw
  )
  select actor, r.week_start, r.score, r.rank
  from ranked as r
  where not exists (
    select 1 from public.career_podium_results as x
    where x.user_id = actor and x.week_start = r.week_start
  )
  on conflict (user_id, week_start) do nothing;
$$;

revoke all on function public.career_finalize_podium(uuid) from public;
revoke all on function public.career_finalize_podium(uuid) from anon;
revoke all on function public.career_finalize_podium(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 4d) AI ANALİZ CLAIM/STATE DEFTERİ — atomik, eşzamanlılığa dayanıklı
-- ---------------------------------------------------------------------------
/**
 * `coach_to_the_top` kanıtı: workout kimliğine bağlı, BAŞARIYLA üretilmiş AI
 * analizleri. İSTEMCİ bu tabloya DOĞRUDAN yazamaz (grant yok). Edge Function
 * `service_role` ile YALNIZCA aşağıdaki RPC'ler üzerinden yazar.
 *
 * EŞZAMANLILIK — iki paralel istek AYNI anda Gemini çağıramaz. Durum makinesi:
 *   * `generating` (lease'li) → biri üretiyor.
 *   * `completed`  (result dolu) → sonuç hazır, cache.
 *   * `failed`     → yeniden denenebilir.
 * `claim_workout_analysis` ATOMİK bir upsert'le tek üreticiyi seçer; ikinci
 * istek ya cache'i ya da "devam ediyor" durumunu döner (yeni Gemini çağrısı YOK).
 * Kilit lease'lidir: üretici çökerse `lease_expires_at` dolunca güvenle
 * yeniden claim edilir (sonsuz kilit yok).
 *
 * BÜTÜNLÜK — DB trigger'ı, kaydın YALNIZCA kullanıcıya ait ve TAMAMLANMIŞ bir
 * session için açılmasını zorlar. `coach_to_the_top` YALNIZ `status='completed'
 * ve `result` dolu benzersiz session'ları sayar → başarısız/boş/devam-eden analiz
 * SAYILMAZ.
 */
create table if not exists public.ai_workout_analyses (
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  status text not null default 'generating' check (status in ('generating','completed','failed')),
  -- Üretilen AI analizi. YALNIZ `completed` durumunda dolu olmak ZORUNDA.
  result jsonb,
  -- Üretim kilidi lease'i; süresi dolan `generating` kaydı yeniden claim edilebilir.
  lease_expires_at timestamptz,
  -- SAHİPLİK TOKENI — her (yeni/stale-reclaim) claim'de yeni kriptografik uuid
  -- üretilir. `complete`/`fail` YALNIZ doğru token'la geçer → 90 sn'yi aşıp lease'i
  -- devredilen ESKİ üretici, YENİ claim'in sonucunu tamamlayamaz/başarısız yapamaz.
  -- Token istemciye ASLA verilmez; yalnız Edge service-role akışında taşınır.
  claim_token uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_workout_analyses_completed_has_result
    check (status <> 'completed' or result is not null),
  primary key (user_id, workout_session_id)
);
-- coach sayımı: yalnız completed satırları hızlı gezer.
create index if not exists ai_workout_analyses_user_completed_idx
  on public.ai_workout_analyses (user_id) where status = 'completed';

alter table public.ai_workout_analyses enable row level security;
revoke all on table public.ai_workout_analyses from anon;
revoke all on table public.ai_workout_analyses from authenticated;
-- TAMAMEN SUNUCU-İÇİ TABLO — istemciye HİÇBİR grant yok (SELECT dâhil). Dahili
-- üretim alanları (`claim_token`, `lease_expires_at`, `status`) hiçbir authenticated/
-- anon sorgusuyla OKUNAMAZ ("token istemciye asla verilmez" sözleşmesi). Analiz
-- sonucu uygulamaya YALNIZ doğrulamalı `workout-coach` Edge yanıtından gelir; başarım
-- sayımı `sync_my_achievements` (security definer, owner bağlamı) içinden yapılır.
-- Eski SELECT-own politikası KALDIRILDI (grant olmadığından işlevsizdi zaten).
drop policy if exists "ai_workout_analyses_select_own" on public.ai_workout_analyses;

comment on table public.ai_workout_analyses is
  'Server-only claim/state ledger of per-workout AI analyses (coach_to_the_top evidence). No client grants at all (SELECT included); claim_token/lease/state never client-readable. No RP/XP/currency.';

/**
 * BÜTÜNLÜK — service_role RLS'i bypass etse bile, kayıt YALNIZCA kullanıcıya ait
 * ve TAMAMLANMIŞ (deleted_at is null) bir session için AÇILABİLİR (insert). Başka
 * kullanıcının session'ı veya tamamlanmamış/silinmiş session reddedilir.
 */
create or replace function public.ai_workout_analyses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workout_sessions as s
    where s.id = new.workout_session_id
      and s.user_id = new.user_id
      and s.status = 'completed'
      and s.deleted_at is null
  ) then
    raise exception 'invalid_analysis_session' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Trigger fonksiyonu dışarıdan çağrılamaz; savunma derinliği için istemci EXECUTE
-- izinleri açıkça kaldırılır (yalnız trigger bağlamında çalışır).
revoke all on function public.ai_workout_analyses_guard() from public;
revoke all on function public.ai_workout_analyses_guard() from anon;
revoke all on function public.ai_workout_analyses_guard() from authenticated;

drop trigger if exists ai_workout_analyses_guard_trg on public.ai_workout_analyses;
create trigger ai_workout_analyses_guard_trg
  before insert on public.ai_workout_analyses
  for each row execute function public.ai_workout_analyses_guard();

/**
 * ATOMİK CLAIM — tek statement'lık koşullu upsert.
 *   * outcome='claimed'     → çağıran üretim hakkını aldı (Gemini'yi O çağırır).
 *   * outcome='completed'   → sonuç hazır (result döner; YENİ AI maliyeti YOK).
 *   * outcome='in_progress' → başka istek üretiyor (lease taze); yeni çağrı YOK.
 * Stale (`generating` + lease geçmiş) veya `failed` kayıt yeniden claim edilir.
 * YALNIZ `service_role` çalıştırır.
 */
create or replace function public.claim_workout_analysis(
  target_user uuid, target_session uuid, lease_seconds integer default 120
)
returns table (outcome text, result jsonb, claim_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected integer;
  new_token uuid := gen_random_uuid();
begin
  insert into public.ai_workout_analyses (user_id, workout_session_id, status, claim_token, lease_expires_at, updated_at)
  values (target_user, target_session, 'generating', new_token, timezone('utc', now()) + make_interval(secs => lease_seconds), timezone('utc', now()))
  on conflict (user_id, workout_session_id) do update
    set status = 'generating',
        result = null,
        claim_token = new_token,  -- her stale-reclaim YENİ token → eski üretici geçersizleşir
        lease_expires_at = timezone('utc', now()) + make_interval(secs => lease_seconds),
        updated_at = timezone('utc', now())
    where public.ai_workout_analyses.status = 'failed'
       or (public.ai_workout_analyses.status = 'generating'
           and public.ai_workout_analyses.lease_expires_at < timezone('utc', now()));
  get diagnostics affected = row_count;
  if affected = 1 then
    -- YALNIZ claim'i alan token'ı görür (üretim hakkı ONUN).
    return query select 'claimed'::text, null::jsonb, new_token;
    return;
  end if;
  -- Çakışma + güncelleme yok → mevcut kayıt completed ya da taze generating.
  -- Token DÖNMEZ (null): çağıran üretim hakkını almadı.
  return query
    select case when a.status = 'completed' then 'completed' else 'in_progress' end,
           case when a.status = 'completed' then a.result else null end,
           null::uuid
    from public.ai_workout_analyses as a
    where a.user_id = target_user and a.workout_session_id = target_session;
end;
$$;
revoke all on function public.claim_workout_analysis(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_workout_analysis(uuid, uuid, integer) to service_role;

/**
 * Üretimi TAMAMLA — YALNIZ claim sahibi. Güncelleme; kullanıcı, session,
 * `status='generating'` VE doğru `claim_token` eşleşmesini birlikte zorlar. Lease'i
 * devralınmış ESKİ üretici (token'ı artık geçersiz) hiçbir şeyi tamamlayamaz.
 * Başarıda token TEMİZLENİR (null) → aynı token ikinci kez kullanılamaz.
 */
create or replace function public.complete_workout_analysis(
  target_user uuid, target_session uuid, target_token uuid, analysis jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected integer;
begin
  if analysis is null then
    raise exception 'empty_analysis' using errcode = '22023';
  end if;
  update public.ai_workout_analyses
    set status = 'completed', result = analysis, claim_token = null, lease_expires_at = null, updated_at = timezone('utc', now())
    where user_id = target_user and workout_session_id = target_session
      and status = 'generating' and claim_token = target_token;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.complete_workout_analysis(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_workout_analysis(uuid, uuid, uuid, jsonb) to service_role;

/**
 * Üretim BAŞARISIZ — claim serbest bırakılır. YALNIZ doğru token'la ve yalnız
 * `generating` durumundayken. Böylece eski üretici, YENİ claim'i `failed`'e
 * çekemez (token eşleşmez → 0 satır). Token temizlenir.
 */
create or replace function public.fail_workout_analysis(target_user uuid, target_session uuid, target_token uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.ai_workout_analyses
    set status = 'failed', claim_token = null, lease_expires_at = null, updated_at = timezone('utc', now())
    where user_id = target_user and workout_session_id = target_session
      and status = 'generating' and claim_token = target_token;
$$;
revoke all on function public.fail_workout_analysis(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fail_workout_analysis(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5) SYNC RPC — kariyer başarımlarını uzlaştırır, 30 satırı SABİT sırada döner
-- ---------------------------------------------------------------------------
/**
 * KALICILIK — satırlar yalnız EKLENİR. Bir workout sonradan silinip ilerleme
 * düşse bile `is_unlocked` DEFTERDEN okunduğu için rozet geri alınmaz.
 * IDEMPOTENCY — `on conflict on constraint career_achievements_pkey do nothing`;
 * ikinci çağrı yeni satır yazmaz, `unlocked_at` değişmez.
 * GÜVENLİK — istemci yalnız `client_today` gönderir (±1 güne kilitli); user_id/
 * ilerleme GÖNDEREMEZ. Aktif kullanıcı `auth.uid()`.
 */
create or replace function public.sync_my_achievements(client_today date)
returns table (
  achievement_key text,
  category text,
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
  actor uuid := (select auth.uid());
  epoch_date date;
  -- türetilen metrikler
  m_workouts integer := 0;
  m_streak integer := 0;
  m_perfect boolean := false;
  m_programs integer := 0;
  m_cardio_sessions integer := 0;
  m_cardio_distance bigint := 0;
  m_cardio_duration bigint := 0;
  m_friends integer := 0;
  m_color_changed boolean := false;
  m_message boolean := false;
  m_manual_rose boolean := false;
  m_max_peak_rp integer := 0;
  m_max_single_volume bigint := 0;
  m_career_volume bigint := 0;
  m_total_sets integer := 0;
  m_level integer := 1;
  m_pr integer := 0;
  m_loyalty boolean := false;
  m_coach integer := 0;
  m_podium boolean := false;
  m_ai_genuine boolean := false;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform public.assert_client_today(client_today);

  select rs.rp_epoch into epoch_date from public.rank_settings as rs limit 1;

  -- Tamamlanmış antrenman sayısı (kanonik yüklem).
  select count(*)::integer into m_workouts
  from public.workout_sessions as s
  where s.user_id = actor and s.status = 'completed' and s.deleted_at is null;

  -- Kariyer disiplin serisi (epoch..bugün, epoch'tan sayılır).
  if epoch_date is not null then
    m_streak := public.rank_peak_streak(actor, epoch_date, client_today, epoch_date);
    m_loyalty := public.career_program_loyalty(actor, epoch_date, client_today);
  end if;

  -- Mükemmel hafta — herhangi bir sezonda net RP > 0 olan bir hafta.
  select exists (
    select 1 from public.rank_events as re
    where re.user_id = actor and re.event_type = 'weekly_perfect'
    group by re.season_index, split_part(split_part(re.source_key,'#',1),':',1)
    having sum(re.rp_delta) > 0
  ) into m_perfect;

  -- Program sayısı (sıfırdan; kopya/şablon özelliği şemada yok → her program geçerli).
  select count(*)::integer into m_programs
  from public.programs as p where p.owner_id = actor;

  -- Kardiyo: tamamlanmış oturumlardaki aktivite kayıtları.
  select
    count(distinct s.id)::integer,
    coalesce(sum(ar.distance_meters),0)::bigint,
    coalesce(sum(ar.duration_seconds),0)::bigint
  into m_cardio_sessions, m_cardio_distance, m_cardio_duration
  from public.workout_activity_records as ar
  join public.workout_sessions as s on s.id = ar.session_id
  where s.user_id = actor and s.status = 'completed' and s.deleted_at is null;

  -- AI Koç'tan BAŞARILI YANIT — yalnız GERÇEK bir kullanıcı mesajına bağlı
  -- assistant satırı sayılır (Edge Function service_role yazar). Otomatik
  -- karşılama/sistem mesajı veya kopuk satır AÇMAZ: assistant'ın
  -- `reply_to_message_id`'si, aktörün role='user' mesajına işaret etmeli.
  -- (Boş/başarısız/iptal yanıt zaten satır yazılmadığı için sayılmaz;
  --  aynı yanıt tek satırdır → sync iki kez saymaz.)
  select exists (
    select 1
    from public.ai_coach_messages as a
    join public.ai_coach_messages as u on u.id = a.reply_to_message_id
    where a.user_id = actor and a.role = 'assistant'
      and u.user_id = actor and u.role = 'user'
  ) into m_ai_genuine;

  -- coach_to_the_top — YALNIZ başarıyla tamamlanmış (completed + result dolu),
  -- benzersiz workout analizleri. Devam-eden/başarısız/boş analiz SAYILMAZ.
  select count(distinct wa.workout_session_id)::integer into m_coach
  from public.ai_workout_analyses as wa
  where wa.user_id = actor and wa.status = 'completed' and wa.result is not null;

  -- Kabul edilmiş arkadaşlık sayısı (anlık; unlock defterde latch'lenir).
  select count(*)::integer into m_friends
  from public.friendships as f
  where f.status = 'accepted' and (f.requester_id = actor or f.receiver_id = actor);

  -- Renk paleti varsayılandan değiştirilmiş mi (tema dark/light yerelde;
  -- renk preset'i sunucuda kalıcıdır — kanonik, doğrulanabilir kaynak).
  select exists (
    select 1 from public.profiles as p
    where p.id = actor and p.color_preset is not null and p.color_preset <> 'profileClay'
  ) into m_color_changed;

  -- Bir arkadaşa gönderilmiş kullanıcı mesajı (sistem değil; gönderen actor).
  select exists (
    select 1 from public.friend_messages as fm where fm.sender_id = actor
  ) into m_message;

  -- Manuel level rose seçimi (null = otomatik; non-null = manuel).
  select (up.selected_level_rose is not null) into m_manual_rose
  from public.user_progress as up where up.user_id = actor;
  m_manual_rose := coalesce(m_manual_rose, false);

  -- Rank: herhangi bir sezondaki en yüksek peak_rp (rank up / rosea kanıtı).
  select coalesce(max(usr.peak_rp),0)::integer into m_max_peak_rp
  from public.user_season_ranks as usr where usr.user_id = actor;

  -- Level: lifetime_xp → level.
  select coalesce(public.level_for_xp(up.lifetime_xp),1) into m_level
  from public.user_progress as up where up.user_id = actor;
  m_level := coalesce(m_level, 1);

  -- Hacim: tek-workout maksimumu ve kariyer toplamı (kg × tekrar, geçerli setler).
  with per_session as (
    select s.id,
           sum(ws.weight_kg * ws.repetitions)::bigint as vol
    from public.workout_sessions as s
    join public.workout_sets as ws on ws.session_id = s.id
    where s.user_id = actor and s.status = 'completed' and s.deleted_at is null
      and ws.weight_kg is not null and ws.weight_kg > 0
      and ws.repetitions is not null and ws.repetitions > 0
    group by s.id
  )
  select coalesce(max(vol),0)::bigint, coalesce(sum(vol),0)::bigint
  into m_max_single_volume, m_career_volume from per_session;

  -- Toplam geçerli/kaydedilmiş set (tamamlanmış, silinmemiş oturumlardan).
  select count(*)::integer into m_total_sets
  from public.workout_sets as ws
  join public.workout_sessions as s on s.id = ws.session_id
  where s.user_id = actor and s.status = 'completed' and s.deleted_at is null;

  -- PR olayları.
  m_pr := public.career_pr_count(actor);

  -- Podyum — YALNIZ henüz açılmadıysa: kapanmış haftaları FINALIZE et (değişmez
  -- snapshot) ve YALNIZ finalize edilmiş sonuçtan oku (puan>0 ve sıra<=3). Anlık
  -- yeniden hesap YOK; arkadaş/RP sonradan değişse de snapshot değişmez.
  if not exists (
    select 1 from public.career_achievements as a
    where a.user_id = actor and a.achievement_key = 'on_the_podium'
  ) then
    -- İstemci tarihi GEÇİRİLMEZ: finalizer kapanmış hafta kararını SUNUCU
    -- zamanıyla verir (erken finalizasyon imkânsız).
    perform public.career_finalize_podium(actor);
    select exists (
      select 1 from public.career_podium_results as r
      where r.user_id = actor and r.rank <= 3 and r.score > 0
    ) into m_podium;
  end if;

  -- Kazanılanları defterе yaz (yalnız EKLE). Artık 30'un HEPSİ türetilir:
  -- on_the_podium (kapanmış hafta) ve coach_to_the_top (AI analiz defteri) dahil.
  insert into public.career_achievements (user_id, achievement_key)
  select actor, k.achievement_key
  from (
    select 'first_step' as achievement_key, (m_workouts >= 1) as earned
    union all select 'warmup_done', m_workouts >= 5
    union all select 'rhythm_found', m_workouts >= 15
    union all select 'three_day_spark', m_streak >= 3
    union all select 'weekly_flame', m_streak >= 7
    union all select 'perfect_week', m_perfect
    union all select 'own_path', m_programs >= 1
    union all select 'pulse_rising', m_cardio_sessions >= 1
    union all select 'wise_counsel', m_ai_genuine
    union all select 'social_step', m_friends >= 1
    union all select 'new_perspective', m_color_changed
    union all select 'first_message', m_message
    union all select 'rose_bud', m_manual_rose
    union all select 'first_rank_up', m_max_peak_rp >= 200
    union all select 'cardio_discipline', m_cardio_sessions >= 10
    union all select 'strong_circle', m_friends >= 5
    union all select 'ten_ton_club', m_max_single_volume >= 10000
    union all select 'program_loyalty', m_loyalty
    union all select 'pr_hunter', m_pr >= 3
    union all select 'half_century', m_workouts >= 50
    union all select 'full_bloom', m_level >= 200
    union all select 'rosea_rank', m_max_peak_rp >= 1650
    union all select 'cardio_traveler', m_cardio_distance >= 100000
    union all select 'against_time', m_cardio_duration >= 30000
    union all select 'quarter_million', m_career_volume >= 250000
    union all select 'thirty_day_discipline', m_streak >= 30
    union all select 'iron_will_100', m_workouts >= 100
    union all select 'thousand_sets', m_total_sets >= 1000
    union all select 'on_the_podium', m_podium
    union all select 'coach_to_the_top', m_coach >= 30
  ) as k
  where k.earned
  on conflict on constraint career_achievements_pkey do nothing;

  -- 30 satırın tamamı SABİT sırada; kilit DEFTERDEN, ilerleme METRİKTEN.
  return query
  select
    c.achievement_key,
    c.category,
    (a.user_id is not null) as is_unlocked,
    a.unlocked_at,
    least(
      case c.achievement_key
        when 'first_step' then m_workouts
        when 'warmup_done' then m_workouts
        when 'rhythm_found' then m_workouts
        when 'half_century' then m_workouts
        when 'iron_will_100' then m_workouts
        when 'three_day_spark' then m_streak
        when 'weekly_flame' then m_streak
        when 'thirty_day_discipline' then m_streak
        when 'perfect_week' then (case when m_perfect then 1 else 0 end)
        when 'own_path' then m_programs
        when 'pulse_rising' then m_cardio_sessions
        when 'cardio_discipline' then m_cardio_sessions
        when 'wise_counsel' then (case when m_ai_genuine then 1 else 0 end)
        when 'social_step' then m_friends
        when 'strong_circle' then m_friends
        when 'new_perspective' then (case when m_color_changed then 1 else 0 end)
        when 'first_message' then (case when m_message then 1 else 0 end)
        when 'rose_bud' then (case when m_manual_rose then 1 else 0 end)
        when 'first_rank_up' then (case when m_max_peak_rp >= 200 then 1 else 0 end)
        when 'rosea_rank' then (case when m_max_peak_rp >= 1650 then 1 else 0 end)
        when 'ten_ton_club' then least(m_max_single_volume, 2147483647)::integer
        when 'quarter_million' then least(m_career_volume, 2147483647)::integer
        when 'program_loyalty' then (case when m_loyalty then 14 else 0 end)
        when 'pr_hunter' then m_pr
        when 'full_bloom' then m_level
        when 'cardio_traveler' then least(m_cardio_distance, 2147483647)::integer
        when 'against_time' then least(m_cardio_duration, 2147483647)::integer
        when 'thousand_sets' then m_total_sets
        when 'on_the_podium' then (case when m_podium then 1 else 0 end)
        when 'coach_to_the_top' then m_coach
        else 0
      end,
      c.target_progress
    ) as current_progress,
    c.target_progress
  from public.achievement_catalog() as c
  left join public.career_achievements as a
    on a.user_id = actor and a.achievement_key = c.achievement_key
  order by c.sort_order;
end;
$$;

revoke all on function public.sync_my_achievements(date) from public;
revoke all on function public.sync_my_achievements(date) from anon;
grant execute on function public.sync_my_achievements(date) to authenticated;

comment on function public.sync_my_achievements(date) is
  'Reconciles and returns the authenticated user permanent career achievements (30 rows, fixed order). Season-independent. Grants no RP, XP or currency.';

-- ---------------------------------------------------------------------------
-- 6) ACL DENETİMİ — bu migrationın TANIMLADIĞI security-definer fonksiyonların
--    izinleri sözleşmeye uymalı. YALNIZ bilinçli istemci RPC'si (sync) authenticated
--    tarafından çalıştırılabilir; geri kalan HEPSİ sunucu-içi (service_role veya
--    yalnız-definer). İzin sızarsa migration BAŞARISIZ olur (apply anında kanıt).
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  leaked text;
  -- authenticated tarafından çalıştırılması GEREKEN tek istemci RPC'si:
  intended_client text[] := array['sync_my_achievements(date)'];
  -- authenticated/anon tarafından ASLA çalıştırılmaması gereken sunucu-içi fonksiyonlar:
  server_only text[] := array[
    'consume_ai_quota(uuid, uuid, text, integer)',
    'career_pr_count(uuid)',
    'career_program_loyalty(uuid, date, date)',
    'friendship_intervals_sync()',
    'ai_workout_analyses_guard()',
    'career_finalize_podium(uuid)',
    'claim_workout_analysis(uuid, uuid, integer)',
    'complete_workout_analysis(uuid, uuid, uuid, jsonb)',
    'fail_workout_analysis(uuid, uuid, uuid)'
  ];
  allowlist text[] := intended_client || server_only;
  allow_oids oid[];
begin
  -- (a) LİSTE GÜNCEL: allowlist'teki her fonksiyon gerçekten VAR (yeniden adlandırma/
  --     kaldırma denetimden kaçamaz). Aynı anda allowlist OID kümesini toplarız.
  foreach fn in array allowlist loop
    if to_regprocedure('public.' || fn) is null then
      raise exception 'ACL AUDIT FAIL: allowlisted function % does not exist (stale list)', fn;
    end if;
  end loop;
  select array_agg(to_regprocedure('public.' || a)::oid) into allow_oids from unnest(allowlist) as a;

  -- (b) GENEL DENETİM (OID tabanlı — argüman-adı/format farklarından bağımsız): bu
  --     migrationın YENİ oluşturduğu (ön-snapshot OID'inde OLMAYAN) her security-definer
  --     fonksiyonu allowlist'te OLMALI. `create or replace` OID'i koruduğundan mevcut
  --     fonksiyon "yeni" sayılmaz → hem izole hem canlı ortamda doğru çalışır. Listeye
  --     eklenmemiş yeni bir security-definer fonksiyonu buraya takılır.
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.oid <> all (array(select s.oid from _career_pre_secdef s))
    and p.oid <> all (allow_oids);
  if leaked is not null then
    raise exception 'ACL AUDIT FAIL: unexpected security-definer function(s) created but not allowlisted: %', leaked;
  end if;

  -- (c) İstemci RPC'leri authenticated tarafından çalıştırılabilir OLMALI.
  foreach fn in array intended_client loop
    if not has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') then
      raise exception 'ACL AUDIT FAIL: intended client RPC % not executable by authenticated', fn;
    end if;
  end loop;

  -- (d) Sunucu-içi fonksiyonlar authenticated VE anon tarafından çalıştırılamaz;
  --     ayrıca PUBLIC varsayılan EXECUTE sızıntısı da olmamalı.
  foreach fn in array server_only loop
    if has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') then
      raise exception 'ACL AUDIT FAIL: server-only function % is EXECUTABLE by authenticated', fn;
    end if;
    if has_function_privilege('anon', 'public.' || fn, 'EXECUTE') then
      raise exception 'ACL AUDIT FAIL: server-only function % is EXECUTABLE by anon', fn;
    end if;
    if has_function_privilege('public', 'public.' || fn, 'EXECUTE') then
      raise exception 'ACL AUDIT FAIL: server-only function % has PUBLIC EXECUTE leak', fn;
    end if;
  end loop;

  -- (e) TABLO/KOLON GÖRÜNÜRLÜĞÜ (Item 1): ai_workout_analyses istemciye TAMAMEN kapalı.
  --     Dahili üretim alanları claim_token/lease_expires_at/status hiçbir authenticated
  --     ya da anon sorgusuyla okunamaz.
  if has_table_privilege('authenticated', 'public.ai_workout_analyses', 'SELECT') then
    raise exception 'ACL AUDIT FAIL: authenticated can SELECT ai_workout_analyses (token/lease leak)';
  end if;
  if has_table_privilege('anon', 'public.ai_workout_analyses', 'SELECT') then
    raise exception 'ACL AUDIT FAIL: anon can SELECT ai_workout_analyses';
  end if;
  foreach fn in array array['claim_token', 'lease_expires_at', 'status'] loop
    if has_column_privilege('authenticated', 'public.ai_workout_analyses', fn, 'SELECT') then
      raise exception 'ACL AUDIT FAIL: authenticated can read internal column ai_workout_analyses.%', fn;
    end if;
  end loop;

  -- (f) friendship_intervals de istemciye tamamen kapalı (server-internal).
  if has_table_privilege('authenticated', 'public.friendship_intervals', 'SELECT')
     or has_table_privilege('anon', 'public.friendship_intervals', 'SELECT') then
    raise exception 'ACL AUDIT FAIL: friendship_intervals is client-readable';
  end if;
end $$;

commit;
