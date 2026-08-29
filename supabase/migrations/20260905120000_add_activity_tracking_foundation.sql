/**
 * Faz 1 — Egzersiz ölçüm türleri: VERİTABANI TEMELİ.
 *
 * Bu dosya TEK ve ATOMİKTİR. Açık `begin; … commit;` bloğu içindedir: parçalar
 * birbirine bağımlı olduğu için yarı uygulanmış bir şema mümkün olmamalıdır.
 * Örneğin `program_exercises.tracking_mode` eklenip tamamlama çekirdeği
 * güncellenmeseydi, kardiyo egzersizi paydaya hiç girmez ve kullanıcı koşuyu
 * yapmadan gün "tamamlandı" sayılırdı. Herhangi bir adım düşerse bütün Faz 1
 * geri alınır.
 *
 * KAPSAM — bu migration YALNIZCA sunucu tarafını kurar:
 *   1. `program_exercises` üç ölçüm türünü taşır (koşullu CHECK ile).
 *   2. `workout_activity_records` tablosu (süre/mesafe kayıtları).
 *   3. Tür-farkında tamamlama çekirdeği iki private yardımcıda toplanır.
 *   4. Dört mevcut fonksiyon bu çekirdeği kullanacak biçimde YENİDEN TANIMLANIR.
 *   5. `reward_ledger` yeni `activity` olay türünü kabul eder.
 *
 * İSTEMCİ BU FAZDA DEĞİŞMEZ. Kardiyo egzersizi oluşturacak arayüz yoktur ve
 * istemcideki TypeScript disiplin formülü hâlâ yalnızca set sayar. Dolayısıyla
 * bu migration TEK BAŞINA tamamlanmış bir kullanıcı özelliği DEĞİLDİR: hiçbir
 * `tracking_mode <> 'sets_reps'` satırı üretilemeyeceği için davranış, mevcut
 * veri üzerinde kanıtlanabilir biçimde DEĞİŞMEZ (bkz. "no-op kanıtı" altında).
 *
 * NO-OP KANITI — yalnızca `sets_reps` içeren veride yeni formül eskisiyle
 * matematiksel olarak aynıdır:
 *   * hedef birimi   = `target_sets` (eskisiyle aynı),
 *   * tamamlanan     = `least(set sayısı, target_sets)` (eskisiyle aynı),
 *   * `has_progress` = "en az bir set" ⇔ eski `total_done > 0`, çünkü
 *     `target_sets >= 1` olduğu için bir set kaydı `least(count, target) >= 1`
 *     verir. İki yön de birbirini gerektirir, dolayısıyla `partial` dalı aynı
 *     günlerde açılır.
 *
 * PAYLAŞILAN DİSİPLİN NOTU: `sync_shared_discipline_days` gün durumunu
 * İSTEMCİDEN JSON yükü olarak alır, bu fonksiyonlardan değil. Arkadaşlara yayılan
 * takvimin kardiyo-farkında olması, istemci formülünün genelleştirileceği
 * sonraki faza bağlıdır. Bu migration onu düzeltmez ve düzeltmiş gibi de
 * davranmaz.
 *
 * ESKİ MIGRATION'LAR DEĞİŞTİRİLMEZ. Dört fonksiyon burada `create or replace`
 * ile yeniden tanımlanır; imzaları, `security definer`/`stable` nitelikleri,
 * `set search_path = ''` sözleşmesi ve `revoke`/`grant` durumları BİREBİR
 * korunur.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) program_exercises — ölçüm türü
-- ---------------------------------------------------------------------------

/**
 * `tracking_mode` varsayılanı `sets_reps`'tir; bu yüzden MEVCUT BÜTÜN SATIRLAR
 * ayrı bir backfill olmadan geçerli kalır ve anlamsal olarak değişmez.
 */
alter table public.program_exercises
  add column if not exists tracking_mode text not null default 'sets_reps';

alter table public.program_exercises
  drop constraint if exists program_exercises_tracking_mode_check;

alter table public.program_exercises
  add constraint program_exercises_tracking_mode_check
  check (tracking_mode in ('sets_reps', 'duration', 'distance'));

/**
 * SÜRE ÜST SINIRI 86400 sn (24 saat).
 *
 * Alt sınır 10 sn: plank/izometrik gibi en kısa gerçek hedefler bile 10 saniyenin
 * üstündedir; daha küçük değerler veri girişi hatasıdır. Üst sınır bir akıl
 * sağlığı tavanıdır — tek bir egzersiz hedefi bir günü aşamaz. Mevcut
 * `rest_seconds` tavanı (3600) burada ÖLÇÜT DEĞİLDİR: o setler arası bir moladır,
 * bu ise egzersizin kendi süresidir.
 */
alter table public.program_exercises
  add column if not exists target_duration_seconds integer;

alter table public.program_exercises
  drop constraint if exists program_exercises_target_duration_check;

alter table public.program_exercises
  add constraint program_exercises_target_duration_check
  check (target_duration_seconds is null or target_duration_seconds between 10 and 86400);

/**
 * MESAFE ÜST SINIRI 500000 m (500 km).
 *
 * Alt sınır 10 m: daha küçük bir mesafe hedefi anlamlı bir kardiyo planı
 * değildir. Üst sınır ultra-mesafe bisiklet/koşu hedeflerini kapsayacak kadar
 * geniş, ama basamak hatasını (5 000 km) yakalayacak kadar dardır.
 *
 * Birim METREDİR. Arayüz kilometre gösterir; dönüşüm istemcide yapılır.
 * Mil desteği MVP dışıdır ve bu şemada karşılığı yoktur.
 */
alter table public.program_exercises
  add column if not exists target_distance_meters integer;

alter table public.program_exercises
  drop constraint if exists program_exercises_target_distance_check;

alter table public.program_exercises
  add constraint program_exercises_target_distance_check
  check (target_distance_meters is null or target_distance_meters between 10 and 500000);

/**
 * `target_sets` ve `target_reps` artık YALNIZCA `sets_reps` türünde doludur.
 *
 * Kardiyo BİLİNÇLİ OLARAK `target_sets = 1` gibi sahte bir set değeriyle
 * temsil EDİLMEZ: bu, `target_reps`'i de anlamsız bir değere zorlar ve
 * `program_exercises` okuyan her yüzeyi yanıltır. Bunun yerine kolonlar
 * nullable olur ve hedef birimi tür-farkında bir yardımcıyla hesaplanır.
 *
 * MEVCUT ARALIK KONTROLLERİ KALDIRILMAZ ve NULL değerlerde güvenlidir:
 * `target_sets between 1 and 20` ifadesi NULL girdide NULL üretir ve SQL
 * CHECK semantiğinde NULL "ihlal değil" sayılır. Aynısı
 * `char_length(target_reps) between 1 and 30` için de geçerlidir. Yani eski
 * satırların doğrulaması hiç gevşemez, yalnızca yeni türler için kolon boş
 * bırakılabilir.
 */
alter table public.program_exercises alter column target_sets drop not null;
alter table public.program_exercises alter column target_reps drop not null;

/**
 * TEK ve AÇIK koşullu sözleşme. Türle ilgisiz her kolonun NULL olması burada
 * garanti edilir; yanlış kombinasyon veritabanına GİREMEZ.
 *
 * `rest_seconds` mevcut `not null default 60` ve `between 0 and 3600`
 * kontrollerini korur. `duration`/`distance` türlerinde 0 zorunludur: bu
 * türlerde setler arası mola kavramı yoktur ve istemci mola sayacını/bildirimini
 * çalıştırmaz. 0 zaten mevcut aralığın içindedir, dolayısıyla eski kontrol
 * değişmeden geçerlidir.
 */
alter table public.program_exercises
  drop constraint if exists program_exercises_tracking_contract_check;

alter table public.program_exercises
  add constraint program_exercises_tracking_contract_check
  check (
    (
      tracking_mode = 'sets_reps'
      and target_sets is not null
      and target_reps is not null
      and target_duration_seconds is null
      and target_distance_meters is null
    )
    or (
      tracking_mode = 'duration'
      and target_sets is null
      and target_reps is null
      and target_duration_seconds is not null
      and target_distance_meters is null
      and rest_seconds = 0
    )
    or (
      tracking_mode = 'distance'
      and target_sets is null
      and target_reps is null
      and target_duration_seconds is null
      and target_distance_meters is not null
      and rest_seconds = 0
    )
  );

-- ---------------------------------------------------------------------------
-- 2) workout_activity_records — süre/mesafe kayıtları
-- ---------------------------------------------------------------------------

/**
 * Kardiyo kaydı `workout_sets`'e AYRI bir tabloya yazılır, o tabloya nullable
 * kolon eklenerek DEĞİL.
 *
 * Gerekçe güvenliktir, estetik değil: `workout_sets` üzerinde
 * `unique (session_id, program_exercise_id, set_number)` vardır ve
 * `sync_workout_rewards`'ın `'set'` döngüsü o tablonun HER satırını 3 XP'lik bir
 * set sayar. Kardiyo kaydı oraya `set_number = 1` ile sıkıştırılsaydı sessizce
 * set ödülü üretir ve idempotency anahtarı anlamsızlaşırdı. Ayrı tablo bu yolu
 * şema düzeyinde kapatır.
 *
 * TEMPO SAKLANMAZ. `distance_meters / duration_seconds`'tan türetilir; saklamak
 * üçüncü bir doğruluk kaynağı yaratır ve kayıt düzenlendiğinde tutarsızlaşır.
 *
 * KAPSAM DIŞI: kalori, ortalama nabız, hız, eğim, GPS rotası, HealthKit/Strava
 * alanları ve mil birimi bilinçli olarak YOKTUR.
 */
create table if not exists public.workout_activity_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  /**
   * Program silindiğinde NULL'a düşer ama SATIR KALIR: `exercise_name` snapshot'ı
   * sayesinde geçmiş antrenman aynen görünmeye devam eder. Bu, `workout_sets`'in
   * bugünkü davranışının birebir aynısıdır.
   */
  program_exercise_id uuid references public.program_exercises(id) on delete set null,
  exercise_name text not null check (char_length(exercise_name) between 1 and 100),
  tracking_mode text not null check (tracking_mode in ('duration', 'distance')),
  /** Kayıt anındaki hedeflerin snapshot'ı; plan sonradan değişse de kayıt okunabilir. */
  target_duration_seconds integer check (
    target_duration_seconds is null or target_duration_seconds between 10 and 86400
  ),
  target_distance_meters integer check (
    target_distance_meters is null or target_distance_meters between 10 and 500000
  ),
  duration_seconds integer not null check (duration_seconds between 1 and 86400),
  distance_meters integer check (distance_meters is null or distance_meters between 1 and 500000),
  /** `workout_sets.rpe` ile BİREBİR aynı tip ve aralık. */
  rpe numeric(3,1) check (rpe is null or rpe between 0 and 10),
  completed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  /**
   * Oturum + egzersiz başına TEK kayıt. Bu, idempotency sınırının kendisidir:
   * kullanıcı aynı egzersizi yeniden kaydettiğinde ikinci satır yerine mevcut
   * satır güncellenir (`on conflict … do update`).
   */
  unique (session_id, program_exercise_id),
  /**
   * `duration` kaydında mesafe İSTEĞE BAĞLIDIR (girilirse tempo türetilebilir)
   * ama tamamlama ölçütü DEĞİLDİR. `distance` kaydında mesafe ZORUNLUDUR;
   * süre de zorunludur çünkü kolon `not null`'dır ve tempo ondan türetilir.
   */
  constraint workout_activity_records_distance_requires_value check (
    tracking_mode <> 'distance' or distance_meters is not null
  ),
  /**
   * HEDEF SNAPSHOT'I DA TÜRE BAĞLIDIR.
   *
   * Performans kuralları (yukarıda) "kullanıcı ne yaptı" sorusunu, bu kısıt ise
   * "hangi hedefe karşı yaptı" sorusunu kısıtlar. İkisi ayrı sözleşmedir:
   * bir `duration` kaydında mesafe İSTEĞE BAĞLI olarak ölçülebilir
   * (`distance_meters`), ama mesafe HEDEFİ (`target_distance_meters`) bulunamaz —
   * çünkü plan mesafe hedefi taşımıyordu.
   */
  constraint workout_activity_records_target_snapshot_check check (
    (
      tracking_mode = 'duration'
      and target_duration_seconds is not null
      and target_distance_meters is null
    )
    or (
      tracking_mode = 'distance'
      and target_duration_seconds is null
      and target_distance_meters is not null
    )
  )
);

create index if not exists workout_activity_records_session_idx
  on public.workout_activity_records (session_id);

create index if not exists workout_activity_records_exercise_idx
  on public.workout_activity_records (program_exercise_id, completed_at desc);

drop trigger if exists workout_activity_records_set_updated_at on public.workout_activity_records;
create trigger workout_activity_records_set_updated_at
before update on public.workout_activity_records
for each row execute function public.set_updated_at();

/**
 * GEÇİŞ DEĞİŞMEZLERİ — RLS'in tek bir ifadede anlatamayacağı kurallar.
 *
 * RLS `using` (ESKİ satır) ve `with check` (YENİ satır) ifadelerini ayrı
 * değerlendirir; "bu alan eskiden neydi" karşılaştırması orada yazılamaz.
 *
 * DEĞİŞMEZ (kayıt oluşturulduktan sonra sabit):
 *   `session_id`               — kayıt başka bir oturuma taşınamaz
 *   `tracking_mode`            — ölçüm türü sonradan yeniden yorumlanamaz
 *   `target_duration_seconds`  — hedef snapshot'ı geçmişe dönük değiştirilemez
 *   `target_distance_meters`   — aynı
 *   `exercise_name`            — geçmişteki egzersiz adı yeniden yazılamaz
 *
 * DÜZENLENEBİLİR (kullanıcı gerçekten yaptığı işi düzeltebilmeli):
 *   `duration_seconds`, `distance_meters`, `rpe`, `completed_at`
 *
 * `program_exercise_id` BAŞKA bir egzersize çevrilemez. NULL'a düşmesine izin
 * verilir, çünkü foreign key'in `on delete set null` davranışı tam olarak bunu
 * yapar ve trigger onu engelleseydi program silinemezdi.
 *
 * DÜRÜST GÜVENLİK NOTU — "NULL'a yalnızca FK düşürebilir" İDDİA EDİLMİYOR.
 * Postgres'te bir BEFORE UPDATE trigger'ı, güncellemenin foreign key eyleminden
 * mi yoksa kullanıcı ifadesinden mi geldiğini güvenilir biçimde ayırt edemez.
 * Dolayısıyla kullanıcı KENDİ satırının `program_exercise_id` alanını NULL'a
 * çevirebilir. Bunun ödül yükseltme etkisi YOKTUR:
 *   * ödül anahtarı `<tarih>:<program_exercise_id>:activity` biçimindedir ve
 *     ledger append-only'dir; satırı koparmak yazılmış ödülü silmez,
 *   * aynı egzersiz yeniden kaydedildiğinde anahtar aynı kaldığı için ikinci
 *     ödül yazılmaz,
 *   * kopuk satır tamamlama payına katkı vermez, yani etki kullanıcının kendi
 *     aleyhinedir,
 *   * kullanıcı zaten satırın TAMAMINI silebilir (`delete` politikası), ki bu
 *     kesinlikle daha yıkıcıdır. NULL'a çevirmek yeni bir yetenek açmaz.
 */
create or replace function public.workout_activity_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id is distinct from old.session_id then
    raise exception 'activity_session_immutable' using errcode = '42501';
  end if;

  if new.program_exercise_id is not null
     and old.program_exercise_id is not null
     and new.program_exercise_id is distinct from old.program_exercise_id then
    raise exception 'activity_exercise_immutable' using errcode = '42501';
  end if;

  if new.tracking_mode is distinct from old.tracking_mode
     or new.target_duration_seconds is distinct from old.target_duration_seconds
     or new.target_distance_meters is distinct from old.target_distance_meters
     or new.exercise_name is distinct from old.exercise_name then
    raise exception 'activity_snapshot_immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

/**
 * Trigger fonksiyonu istemci tarafından DOĞRUDAN çağrılmaz; yetkiler kapatılır.
 * PostgreSQL trigger'ı TABLO SAHİBİNİN adına çalıştırır ve çağıranın fonksiyon
 * üzerinde `execute` ayrıcalığı OLMASINI ARAMAZ — yetkilerin kaldırılması
 * trigger'ın çalışmasını etkilemez, yalnızca doğrudan çağrı yüzeyini kapatır.
 */
revoke all on function public.workout_activity_records_guard() from public;
revoke all on function public.workout_activity_records_guard() from anon;
revoke all on function public.workout_activity_records_guard() from authenticated;

drop trigger if exists workout_activity_records_guard on public.workout_activity_records;
create trigger workout_activity_records_guard
before update on public.workout_activity_records
for each row execute function public.workout_activity_records_guard();

/**
 * ÖLÇÜM TÜRÜ GEÇMİŞTEN SONRA DEĞİŞTİRİLEMEZ.
 *
 * `tracking_mode` serbestçe değiştirilebilseydi, mevcut performans kayıtları
 * YENİ tür altında yeniden yorumlanırdı: `sets_reps` bir egzersiz `distance`'a
 * çevrildiğinde eski `workout_sets` satırları paydadan düşer, gün geriye dönük
 * "tamamlanmamış" olur; tersi yönde ise bir `distance` egzersizi `sets_reps`'e
 * çevrildiğinde `workout_activity_records` kanıtı görünmez hâle gelir. Her iki
 * yön de geçmiş takvimi ve rank kanıtını sessizce bozar.
 *
 * KURAL DAR TUTULUR: yalnızca TÜR DEĞİŞİMİ ve yalnızca o egzersizin PERFORMANS
 * KAYDI VARSA reddedilir.
 *   * Hiç kaydı olmayan egzersizin türü serbestçe değiştirilebilir (kullanıcı
 *     planı henüz uygulamamıştır).
 *   * `target_sets`, `target_reps`, `rest_seconds`, `visual`, `position` gibi
 *     olağan hedef düzenlemeleri HİÇ ETKİLENMEZ — trigger `when` yan tümcesi
 *     sayesinde bu güncellemelerde ateşlenmez bile.
 *   * Hedef kolonlarının yeni türe uyması zaten
 *     `program_exercises_tracking_contract_check` tarafından aynı UPDATE içinde
 *     zorlanır; burada tekrar edilmez.
 *   * Silme, cascade ve `on delete set null` yolları UPDATE olmadığı için
 *     etkilenmez.
 */
create or replace function public.program_exercises_mode_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Savunma amaçlı: `when` yan tümcesi zaten bunu garanti eder.
  if new.tracking_mode is not distinct from old.tracking_mode then
    return new;
  end if;

  if exists (
    select 1 from public.workout_sets as ws
    where ws.program_exercise_id = old.id
  ) or exists (
    select 1 from public.workout_activity_records as ar
    where ar.program_exercise_id = old.id
  ) then
    raise exception 'exercise_tracking_mode_locked' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.program_exercises_mode_guard() from public;
revoke all on function public.program_exercises_mode_guard() from anon;
revoke all on function public.program_exercises_mode_guard() from authenticated;

drop trigger if exists program_exercises_mode_guard on public.program_exercises;
create trigger program_exercises_mode_guard
before update on public.program_exercises
for each row
when (old.tracking_mode is distinct from new.tracking_mode)
execute function public.program_exercises_mode_guard();

-- ---------------------------------------------------------------------------
-- 3) workout_activity_records — RLS
-- ---------------------------------------------------------------------------

alter table public.workout_activity_records enable row level security;

/**
 * TABLO YETKİSİ — RLS politikası TEK BAŞINA YETMEZ.
 *
 * `create policy` yalnızca "hangi satırlar" sorusunu yanıtlar; rolün tablo
 * üzerinde `select/insert/update/delete` AYRICALIĞI yoksa istek RLS'e hiç
 * ulaşmadan `permission denied` ile düşer. Depoda `alter default privileges`
 * kurulumu YOKTUR (aranıp doğrulandı), dolayısıyla yeni tabloya açık grant
 * zorunludur — `initial_schema` bütün tablolarında aynı kalıbı kullanır.
 *
 * `public` (PUBLIC rolü) ve `anon` her yetkiden arındırılır; `authenticated`
 * yalnızca dört veri işlemini alır. Şema üzerinde `usage` zaten mevcuttur ve
 * burada genişletilmez. Birincil anahtar `gen_random_uuid()` ürettiği için
 * tabloya bağlı bir sequence YOKTUR; gereksiz `grant usage on sequence`
 * eklenmez.
 */
revoke all on table public.workout_activity_records from public;
revoke all on table public.workout_activity_records from anon;
grant select, insert, update, delete on table public.workout_activity_records to authenticated;

/**
 * SAHİPLİK `workout_sets` kalıbının aynısıdır (oturum üzerinden), ama YAZMA
 * yolunda BİR KAT DAHA SIKIDIR.
 *
 * `workout_sets` insert'te yalnızca oturum sahipliğine bakar. Burada ek olarak
 * egzersizin GERÇEKTEN o oturumun program gününe ait olduğu doğrulanır. Bunun
 * iki sonucu vardır:
 *
 *   * İstemci PLANSIZ aktivite kaydı ekleyemez — `program_exercise_id` NULL
 *     olan bir satır insert edilemez, çünkü join eşleşmez. NULL yalnızca
 *     sonradan, program silindiğinde oluşabilir.
 *   * Başka kullanıcının oturum/egzersiz kimlikleri birleştirilemez: oturum
 *     `auth.uid()`'e, egzersiz de o oturumun gününe bağlıdır.
 *
 * `tracking_mode` eşitliği de burada zorlanır: `distance` planlı bir egzersize
 * `duration` kaydı yazılamaz.
 */
drop policy if exists "workout_activity_records_select_own" on public.workout_activity_records;
create policy "workout_activity_records_select_own"
on public.workout_activity_records for select
to authenticated
using (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_activity_records.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
);

/**
 * SAHİPLİK ZİNCİRİ AÇIKÇA KURULUR — `program_exercises`'in kendi RLS
 * görünürlüğüne GÜVENİLMEZ.
 *
 * Gerekçe kanıtlanmış bir boşluktur: `workout_sessions_insert_own` yalnızca
 * `auth.uid() = user_id` kontrol eder ve oturumun `program_id`/`program_day_id`
 * alanlarının kullanıcıya ait olduğunu DOĞRULAMAZ. Yani kullanıcı kendi
 * oturumunu başka birinin `program_day_id` değerine işaret edecek biçimde
 * oluşturabilir. Bağlam yalnızca `pe.program_day_id = s.program_day_id`
 * eşitliğine bırakılsaydı, koruma tamamen `program_exercises` üzerindeki RLS'in
 * alt sorguda da uygulanmasına bağlı kalırdı — bu örtük bir varsayımdır ve
 * ileride bir `security definer` yol veya politika değişikliği onu sessizce
 * bozabilir.
 *
 * Bu yüzden zincirin HER HALKASI burada yazılır:
 *   oturum → kullanıcı, gün → program, program → sahip,
 *   oturumun `program_id` ve `program_day_id` alanları o programa ve o güne.
 */
drop policy if exists "workout_activity_records_insert_own" on public.workout_activity_records;
create policy "workout_activity_records_insert_own"
on public.workout_activity_records for insert
to authenticated
with check (
  exists (
    select 1
    from public.workout_sessions as s
    join public.program_days as pd
      on pd.id = s.program_day_id
    join public.programs as pr
      on pr.id = pd.program_id
    join public.program_exercises as pe
      on pe.id = workout_activity_records.program_exercise_id
     and pe.program_day_id = pd.id
    where s.id = workout_activity_records.session_id
      and s.user_id = (select auth.uid())
      and pr.owner_id = (select auth.uid())
      and s.program_id = pr.id
      and s.program_day_id = pd.id
      -- Tür ve hedefler PLANDAN gelir; kullanıcı keyfî snapshot yazamaz.
      and pe.tracking_mode = workout_activity_records.tracking_mode
      and pe.target_duration_seconds
            is not distinct from workout_activity_records.target_duration_seconds
      and pe.target_distance_meters
            is not distinct from workout_activity_records.target_distance_meters
  )
);

drop policy if exists "workout_activity_records_update_own" on public.workout_activity_records;
create policy "workout_activity_records_update_own"
on public.workout_activity_records for update
to authenticated
using (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_activity_records.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_activity_records.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
  and (
    /**
     * Program silindikten sonra kalan KOPUK satır güncellenebilir kalır:
     * kullanıcı kendi geçmiş kaydının süre/mesafe/RPE değerlerini hâlâ
     * düzeltebilmelidir. Sahiplik bu dalda oturum üzerinden kurulur (yukarıdaki
     * `exists`), snapshot alanları ise guard trigger'ı tarafından dondurulur.
     */
    workout_activity_records.program_exercise_id is null
    or exists (
      select 1
      from public.workout_sessions as s
      join public.program_days as pd
        on pd.id = s.program_day_id
      join public.programs as pr
        on pr.id = pd.program_id
      join public.program_exercises as pe
        on pe.id = workout_activity_records.program_exercise_id
       and pe.program_day_id = pd.id
      where s.id = workout_activity_records.session_id
        and s.user_id = (select auth.uid())
        and pr.owner_id = (select auth.uid())
        and s.program_id = pr.id
        and s.program_day_id = pd.id
        and pe.tracking_mode = workout_activity_records.tracking_mode
        and pe.target_duration_seconds
              is not distinct from workout_activity_records.target_duration_seconds
        and pe.target_distance_meters
              is not distinct from workout_activity_records.target_distance_meters
    )
  )
);

drop policy if exists "workout_activity_records_delete_own" on public.workout_activity_records;
create policy "workout_activity_records_delete_own"
on public.workout_activity_records for delete
to authenticated
using (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_activity_records.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- 4) Tamamlama çekirdeği — iki private yardımcı
-- ---------------------------------------------------------------------------

/**
 * Bir egzersizin HEDEF BİRİMİ. Saf, tablo okumayan skaler.
 *
 * Tamamlama formülü bugün dört yerde kopyalanmış durumda (üç SQL fonksiyonu +
 * istemcideki TypeScript hesabı). Bu yardımcı SQL tarafındaki üç kopyanın tür
 * mantığını TEK OTORİTEDE toplar; istemci karşılığı sonraki fazda eklenecek ve
 * harness ikisinin aynı kararı verdiğini kanıtlayacaktır.
 *
 * `sets_reps` → `target_sets` (eski davranışın aynısı)
 * `duration` / `distance` → 1 (sahte set DEĞİL, bir hedefin kendisi)
 */
create or replace function public.exercise_target_units(
  mode text,
  target_sets smallint
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when mode = 'sets_reps' then coalesce(target_sets, 0)::integer
    when mode in ('duration', 'distance') then 1
    else 0
  end;
$$;

revoke all on function public.exercise_target_units(text, smallint) from public;
revoke all on function public.exercise_target_units(text, smallint) from anon;
revoke all on function public.exercise_target_units(text, smallint) from authenticated;

/**
 * Bir egzersizin gün başına TAMAMLANAN BİRİMİ ve İLERLEME sinyali.
 *
 * `workout_sets` ve `workout_activity_records` kanıtlarını TEK yerde birleştirir.
 *
 * GÜN İÇİ TOPLAMA: aynı egzersiz aynı günde birden fazla oturumda görünebilir
 * (ör. sabah/akşam). Süre ve mesafe bu yüzden `workout_date` düzeyinde
 * TOPLANIR. Oturum içi `unique (session_id, program_exercise_id)` sınırı bundan
 * bağımsızdır ve korunur: bir oturumda tek satır, günde birden çok oturum.
 *
 * `exclude_deleted` YALNIZCA `rank_day_state` için `true` geçilir. Takvim
 * fonksiyonları (`auto_discipline_range`, `display_discipline_range`) bu filtreyi
 * bilinçli olarak UYGULAMAZ; bu ayrım mevcut davranıştır ve korunur.
 *
 * `has_progress` ayrı bir sinyaldir çünkü kardiyoda tamamlanan birim İKİLİDİR
 * (0 veya 1): hedefin altında biten gerçek bir koşu `done_units = 0` üretir ama
 * gün için `partial` sayılmalıdır. Strength tarafında `has_progress` ile eski
 * `total_done > 0` testi matematiksel olarak EŞDEĞERDİR, bu yüzden mevcut veride
 * hiçbir gün durumu değişmez.
 */
create or replace function public.exercise_done_units(
  target_user uuid,
  from_date date,
  to_date date,
  exclude_deleted boolean
)
returns table (
  day_date date,
  program_exercise_id uuid,
  done_units integer,
  has_progress boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with owned_sessions as (
    select s.id, s.workout_date
    from public.workout_sessions as s
    where s.user_id = target_user
      and s.workout_date between from_date and to_date
      and (not exclude_deleted or s.deleted_at is null)
  ),
  set_counts as (
    select
      os.workout_date as day_date,
      ws.program_exercise_id as exercise_id,
      count(*)::integer as completed_count
    from public.workout_sets as ws
    join owned_sessions as os on os.id = ws.session_id
    where ws.program_exercise_id is not null
    group by os.workout_date, ws.program_exercise_id
  ),
  activity_totals as (
    select
      os.workout_date as day_date,
      ar.program_exercise_id as exercise_id,
      coalesce(sum(ar.duration_seconds), 0)::bigint as total_duration,
      coalesce(sum(ar.distance_meters), 0)::bigint as total_distance
    from public.workout_activity_records as ar
    join owned_sessions as os on os.id = ar.session_id
    where ar.program_exercise_id is not null
    group by os.workout_date, ar.program_exercise_id
  ),
  merged as (
    select
      coalesce(sc.day_date, act.day_date) as day_date,
      coalesce(sc.exercise_id, act.exercise_id) as exercise_id,
      coalesce(sc.completed_count, 0) as completed_count,
      coalesce(act.total_duration, 0) as total_duration,
      coalesce(act.total_distance, 0) as total_distance
    from set_counts as sc
    full outer join activity_totals as act
      on act.day_date = sc.day_date
     and act.exercise_id = sc.exercise_id
  )
  select
    m.day_date,
    m.exercise_id,
    case e.tracking_mode
      when 'sets_reps' then least(m.completed_count, coalesce(e.target_sets, 0))::integer
      when 'duration' then
        case
          when e.target_duration_seconds is not null
           and m.total_duration >= e.target_duration_seconds then 1
          else 0
        end
      when 'distance' then
        case
          when e.target_distance_meters is not null
           and m.total_distance >= e.target_distance_meters then 1
          else 0
        end
      else 0
    end,
    (m.completed_count > 0 or m.total_duration > 0 or m.total_distance > 0)
  from merged as m
  join public.program_exercises as e on e.id = m.exercise_id;
$$;

revoke all on function public.exercise_done_units(uuid, date, date, boolean) from public;
revoke all on function public.exercise_done_units(uuid, date, date, boolean) from anon;
revoke all on function public.exercise_done_units(uuid, date, date, boolean) from authenticated;

-- ---------------------------------------------------------------------------
-- 5) auto_discipline_range — tamamlama çekirdeği activity-aware
-- ---------------------------------------------------------------------------

/**
 * DEĞİŞEN TEK ŞEY tamamlama çekirdeğidir:
 *   * payda `sum(target_sets)` yerine `sum(exercise_target_units(...))`,
 *   * pay `set_counts` yerine `exercise_done_units(...)`,
 *   * `partial` dalı `total_done > 0` yerine `has_progress`.
 *
 * KORUNAN HER ŞEY: imza, `stable`/`security definer`, `set search_path = ''`,
 * `revoke` durumu, aktif program çözümü, `active_from` penceresi, off-day
 * davranışı, `off_day_count` çıktısı, `deleted_at` FİLTRESİZLİĞİ ve satır sırası.
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
  -- Aralıktaki bütün tamamlama kanıtı (set + aktivite) TEK yardımcıdan okunur.
  evidence as (
    select ev.day_date, ev.program_exercise_id, ev.done_units, ev.has_progress
    from public.exercise_done_units(target_user, from_date, to_date, false) as ev
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
  totals as (
    select
      sc.day_date,
      sc.active_from,
      sc.day_id,
      sc.day_is_off,
      coalesce(sum(public.exercise_target_units(e.tracking_mode, e.target_sets)), 0)::integer
        as total_target,
      coalesce(sum(coalesce(ev.done_units, 0)), 0)::integer as total_done,
      coalesce(bool_or(coalesce(ev.has_progress, false)), false) as has_progress
    from scheduled as sc
    left join public.program_exercises as e on e.program_day_id = sc.day_id
    left join evidence as ev on ev.program_exercise_id = e.id and ev.day_date = sc.day_date
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
      when t.has_progress then 'partial'
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

-- ---------------------------------------------------------------------------
-- 6) display_discipline_range — tamamlama çekirdeği activity-aware
-- ---------------------------------------------------------------------------

/**
 * `open_day` davranışı BİREBİR KORUNUR: sıfır ilerleme açık günde `null`,
 * bitmiş günde `skipped`. Hedef birimi olmayan gün de aynı ayrımı kullanır.
 * `deleted_at` filtresi burada da UYGULANMAZ (mevcut davranış).
 */
create or replace function public.display_discipline_range(
  target_user uuid,
  from_date date,
  to_date date,
  open_day date
)
returns table (discipline_date date, status text)
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
  evidence as (
    select ev.day_date, ev.program_exercise_id, ev.done_units, ev.has_progress
    from public.exercise_done_units(target_user, from_date, to_date, false) as ev
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
  totals as (
    select
      sc.day_date,
      sc.active_from,
      sc.day_id,
      sc.day_is_off,
      coalesce(sum(public.exercise_target_units(e.tracking_mode, e.target_sets)), 0)::integer
        as total_target,
      coalesce(sum(coalesce(ev.done_units, 0)), 0)::integer as total_done,
      coalesce(bool_or(coalesce(ev.has_progress, false)), false) as has_progress
    from scheduled as sc
    left join public.program_exercises as e on e.program_day_id = sc.day_id
    left join evidence as ev on ev.program_exercise_id = e.id and ev.day_date = sc.day_date
    group by sc.day_date, sc.active_from, sc.day_id, sc.day_is_off
  )
  select
    t.day_date,
    case
      when t.day_id is null then null
      when t.day_date < t.active_from then null
      when t.day_is_off then 'completed'::text
      -- Hedef birimi olmayan gün: bitmiş günde 'skipped', açık günde durum yok.
      when t.total_target = 0 then case when t.day_date = open_day then null else 'skipped' end
      when t.total_done >= t.total_target then 'completed'
      when t.has_progress then 'partial'
      -- Sıfır ilerleme: gün bitmişse 'skipped', bugün ise henüz bitmedi.
      else case when t.day_date = open_day then null else 'skipped' end
    end
  from totals as t
  order by t.day_date;
$$;

revoke all on function public.display_discipline_range(uuid, date, date, date) from public;
revoke all on function public.display_discipline_range(uuid, date, date, date) from anon;
revoke all on function public.display_discipline_range(uuid, date, date, date) from authenticated;

-- ---------------------------------------------------------------------------
-- 7) rank_day_state — tamamlama çekirdeği activity-aware
-- ---------------------------------------------------------------------------

/**
 * Rank'ı takvimden ayıran iki özellik BİREBİR KORUNUR:
 *   * donmuş geçmiş üzerinden program çözümü (`discipline_day_history`),
 *   * `deleted_at is null` filtresi — burada `exclude_deleted = true` geçilir.
 *
 * `h.status` yine OKUNMAZ; donmuş satır yalnızca "o gün hangi programa aitti"
 * bilgisi için kullanılır.
 */
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
  frozen as (
    select h.discipline_date, h.source_program_id
    from public.discipline_day_history as h
    where h.user_id = target_user
      and h.discipline_date between from_date and to_date
  ),
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
   * Takvim fonksiyonları bu filtreyi uygulamaz; ayrım korunur.
   */
  evidence as (
    select ev.day_date, ev.program_exercise_id, ev.done_units, ev.has_progress
    from public.exercise_done_units(target_user, from_date, to_date, true) as ev
  ),
  totals as (
    select
      dl.day_date,
      dl.is_frozen,
      dl.program_id,
      dl.day_id,
      dl.day_is_off,
      coalesce(sum(public.exercise_target_units(e.tracking_mode, e.target_sets)), 0)::integer
        as total_target,
      coalesce(sum(coalesce(ev.done_units, 0)), 0)::integer as total_done,
      coalesce(bool_or(coalesce(ev.has_progress, false)), false) as has_progress
    from day_link as dl
    left join public.program_exercises as e on e.program_day_id = dl.day_id
    left join evidence as ev on ev.program_exercise_id = e.id and ev.day_date = dl.day_date
    group by dl.day_date, dl.is_frozen, dl.program_id, dl.day_id, dl.day_is_off
  )
  select
    t.day_date,
    -- Durum HER ZAMAN canlı kanıttan hesaplanır; donmuş status kullanılmaz.
    case
      when t.day_id is null then null
      when t.day_is_off then 'completed'::text
      when t.total_target = 0 then null
      when t.total_done >= t.total_target then 'completed'
      when t.has_progress then 'partial'
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

-- ---------------------------------------------------------------------------
-- 8) reward_ledger — `activity` olay türü
-- ---------------------------------------------------------------------------

/**
 * Olay kümesi YALNIZCA GENİŞLETİLİR; mevcut hiçbir değer kaldırılmaz veya
 * yeniden adlandırılmaz, dolayısıyla eski ledger satırlarının hiçbiri
 * geçersizleşmez.
 *
 * Kısıt satır içi yazıldığı için adı Postgres tarafından üretilmiştir. Adı
 * varsaymak yerine `reward_ledger` üzerindeki, tanımında `daily_login` geçen
 * CHECK kısıtı bulunup düşürülür: ad farklı olsaydı `drop constraint if exists`
 * sessizce hiçbir şey yapmaz ve eski kısıt `activity` değerini engellemeye devam
 * ederdi.
 */
do $$
declare
  existing_name text;
begin
  select con.conname into existing_name
  from pg_constraint as con
  join pg_class as rel on rel.oid = con.conrelid
  join pg_namespace as nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'reward_ledger'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%daily_login%'
  limit 1;

  if existing_name is not null then
    execute format('alter table public.reward_ledger drop constraint %I', existing_name);
  end if;
end;
$$;

alter table public.reward_ledger
  drop constraint if exists reward_ledger_event_type_check;

alter table public.reward_ledger
  add constraint reward_ledger_event_type_check
  check (
    event_type in ('set', 'day', 'streak', 'weekly', 'pet', 'daily_login', 'activity')
  );

-- ---------------------------------------------------------------------------
-- 9) sync_workout_rewards — aktivite ödülü
-- ---------------------------------------------------------------------------

/**
 * MEVCUT SET ÖDÜLLERİ AYNEN KORUNUR: aynı sorgu, aynı `'set'` olay türü, aynı
 * `source_key` şeması, aynı 3 XP / 3 gül. Gün/off-day/streak uzlaştırması da
 * aynı ortak transaction içinde, aynı yardımcıyla kalır.
 *
 * EKLENEN TEK ŞEY hedefi tamamlanmış planlı aktivite ödülüdür.
 *
 * IDEMPOTENCY ANAHTARI GÜNLÜK PLAN KİMLİĞİDİR:
 *     `<tarih>:<program_exercise_id>:activity`
 *
 * Aktivite SATIR KİMLİĞİ bilinçli olarak anahtar DEĞİLDİR. Satır kimliği
 * kullanılsaydı kaydı silip yeniden oluşturmak yeni bir kimlik üretir ve ikinci
 * ödül yazılırdı. Plan kimliğine bağlı anahtar sayesinde:
 *   * aynı gün içinde birden fazla oturumda kayıt → tek ödül,
 *   * kaydın güncellenmesi → tek ödül,
 *   * sil + yeniden oluştur → tek ödül,
 *   * ağ tekrarı / çift istek → tek ödül
 * (`reward_ledger` üzerindeki `(user_id, event_type, source_key)` unique index
 * ve `record_reward`'ın `on conflict do nothing` davranışı sayesinde).
 *
 * HEDEF ALTINDA ÖDÜL YOKTUR: döngü yalnızca `done_units = 1` satırlarını
 * gezer. Kullanıcı aynı gün içinde hedefe sonradan ulaşırsa ödül BİR KEZ üretilir.
 *
 * GERİ ALMA YOKTUR: tamamlanmış bir aktivite sonradan hedefin altına düzenlenir
 * veya silinirse daha önce yazılmış ödül geri alınmaz. Bu, setlerin bugünkü
 * davranışıyla tutarlıdır — `reward_ledger` append-only'dir.
 *
 * TUTARLAR SUNUCUDA SABİTTİR: istemci hiçbir XP/gül miktarı gönderemez ve
 * `reward_ledger` üzerinde yalnızca `select` politikası vardır.
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
  activity_row record;
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

  -- 1) Tamamlanan setler: +3 XP / +3 gül. DEĞİŞMEDİ.
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

  -- 2) Hedefi tamamlanmış planlı süre/mesafe egzersizleri: +9 XP / +9 gül.
  for activity_row in
    select ev.program_exercise_id
    from public.exercise_done_units(actor, target_date, target_date, false) as ev
    join public.program_exercises as e on e.id = ev.program_exercise_id
    where e.tracking_mode in ('duration', 'distance')
      and ev.done_units = 1
    order by ev.program_exercise_id
  loop
    total_xp := total_xp + public.record_reward(
      actor,
      'activity',
      target_date::text || ':' || activity_row.program_exercise_id::text || ':activity',
      9, 9, target_date,
      jsonb_build_object('program_exercise_id', activity_row.program_exercise_id)
    );
  end loop;

  -- 3) Gün/off-day temel ödülü + streak bonusu AYNI transaction içinde, ortak
  --    yardımcıyla. DEĞİŞMEDİ.
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

commit;
