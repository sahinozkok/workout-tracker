/**
 * Antrenman sahipliği ve ödül güvenliği.
 *
 * FAZ 1'DEN SONRA UYGULANIR ve ona BAĞIMLIDIR: `program_exercises.tracking_mode`
 * kolonu ve aktivite sözleşmesi `20260905120000_add_activity_tracking_foundation.sql`
 * tarafından kurulur. Bu dosya o migration'ı DEĞİŞTİRMEZ; yalnızca üzerine inşa eder.
 *
 * NEDEN GEREKLİ — kanıtlanmış boşluk:
 *
 *   `workout_sessions` politikalarının dördü de yalnızca `auth.uid() = user_id`
 *   kontrol eder. Oturumun `program_id`/`program_day_id` alanlarının kullanıcıya
 *   ait olduğu ve birbirleriyle tutarlı olduğu HİÇ doğrulanmaz. `workout_sets`
 *   politikaları da yalnızca oturum sahipliğine bakar ve `program_exercise_id`'ye
 *   hiç değinmez — dolayısıyla `program_exercises` üzerindeki RLS o yolda devreye
 *   bile girmez.
 *
 *   Ödül anahtarı `<tarih>:<program_exercise_id>:<set_number>` biçimindedir ve üç
 *   bileşeninin üçü de serbestçe değiştirilebilir durumdaydı: ilki oturumun
 *   `workout_date` alanından, diğer ikisi set satırından. `set_number` 1–100
 *   aralığında olduğu ve hedefle hiç karşılaştırılmadığı için tek gerçek bir set
 *   egzersiz başına günde 300 XP'ye kadar çoğaltılabiliyordu.
 *
 *   Faz 1 ayrıca YENİ bir yüzey açtı: hiçbir şey `tracking_mode = 'duration'` veya
 *   `'distance'` bir egzersize `workout_sets` satırı yazılmasını engellemiyordu.
 *   Bu satır hem 3 XP üretiyor hem de `exercise_done_units`'in `has_progress`
 *   sinyalini tetikleyerek koşu yapılmadan günü `partial` gösteriyordu.
 *
 * KAPSAM:
 *   1. Preflight veri denetimi (fail-closed, otomatik düzeltme YOK).
 *   2. `workout_sessions` INSERT/UPDATE politikalarına açık sahiplik zinciri.
 *   3. `workout_sessions` için dar bir BEFORE UPDATE guard.
 *   4. `workout_sets` INSERT politikasına tam zincir + `sets_reps` şartı;
 *      UPDATE yolunun tamamen kapatılması.
 *   5. `sync_workout_rewards` strength döngüsünün sıkılaştırılması.
 *
 * KORUNAN MEŞRU AKIŞLAR — bunların hiçbiri kısıtlanmaz:
 *   * Aktif OLMAYAN programda antrenman başlatma (`is_active` şartı YOKTUR).
 *   * Planlanmamış haftagününde antrenman başlatma (weekday şartı YOKTUR).
 *   * start / pause / resume / finish / soft-delete akışının tamamı.
 *   * Hedef üstü EKSTRA set kaydı — `workout_sets`'e yazılır ve history'de
 *     görünür; yalnızca ödül üretmez.
 *   * Program veya egzersiz silindikten sonra kalan tarihsel satırların
 *     okunabilirliği ve silinebilirliği.
 *
 * ESKİ MIGRATION'LAR DEĞİŞTİRİLMEZ. Politikalar `drop policy if exists` +
 * `create policy` ile, fonksiyon `create or replace` ile yeniden tanımlanır;
 * imza, `security definer`, `set search_path = ''` ve grant/revoke sözleşmeleri
 * birebir korunur.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) PREFLIGHT — mevcut veri yeni sözleşmeye uyuyor mu?
-- ---------------------------------------------------------------------------

/**
 * Yeni kısıtlar politika ve trigger düzeyindedir, tablo CHECK'i DEĞİL; bu yüzden
 * mevcut satırlar teknik olarak "geçersizleşmez" ve migration onlara dokunmadan
 * uygulanabilir. Yine de sessizce devam etmek yanlış olurdu: bozuk bir çapraz
 * bağlantı varsa bu, ödül ve takvim geçmişinin güvenilmez olduğu anlamına gelir.
 *
 * Bu blok bu yüzden FAIL-CLOSED çalışır: geçersiz satır bulursa transaction'ın
 * TAMAMI düşer ve aşağıdaki hiçbir DDL uygulanmaz.
 *
 * OTOMATİK DÜZELTME YOKTUR. Migration hiçbir satırı güncellemez veya silmez —
 * geri alınamaz bir veri kaybı riskini kullanıcı onayı olmadan almaz.
 *
 * GİZLİLİK: hata mesajı yalnızca kategori adları ve AGGREGATE sayılar taşır.
 * Satır kimliği, kullanıcı kimliği, e-posta veya başka kişisel veri YAZILMAZ.
 *
 * GEÇERLİ SAYILAN TARİHSEL DURUMLAR (hata değildir):
 *   * program silindikten sonra `program_id` ve `program_day_id` İKİSİ de NULL,
 *   * egzersiz silindikten sonra `workout_sets.program_exercise_id` NULL,
 *   * soft-delete edilmiş oturum ve ona bağlı setler,
 *   * `target_sets` üzerindeki ekstra setler.
 */
do $$
declare
  bad_session_partial_link integer;
  bad_session_day_mismatch integer;
  bad_session_owner integer;
  bad_set_day_mismatch integer;
  bad_set_owner integer;
  bad_set_cardio integer;
  bad_set_broken_session integer;
  total integer;
begin
  -- Oturum: bağlardan yalnız biri NULL (yarım bağ). İkisi de NULL geçerlidir.
  select count(*) into bad_session_partial_link
  from public.workout_sessions as s
  where (s.program_id is null) <> (s.program_day_id is null);

  -- Oturum: iki bağ da dolu ama gün o programın altında değil.
  select count(*) into bad_session_day_mismatch
  from public.workout_sessions as s
  join public.program_days as pd on pd.id = s.program_day_id
  where s.program_id is not null
    and s.program_day_id is not null
    and pd.program_id is distinct from s.program_id;

  -- Oturum: iki bağ da dolu ama programın sahibi oturumun sahibi değil.
  select count(*) into bad_session_owner
  from public.workout_sessions as s
  join public.programs as pr on pr.id = s.program_id
  where s.program_id is not null
    and s.program_day_id is not null
    and pr.owner_id is distinct from s.user_id;

  -- Set: egzersiz oturumun gününe ait değil. NULL egzersiz geçerlidir.
  select count(*) into bad_set_day_mismatch
  from public.workout_sets as ws
  join public.workout_sessions as s on s.id = ws.session_id
  join public.program_exercises as pe on pe.id = ws.program_exercise_id
  where ws.program_exercise_id is not null
    and s.program_day_id is not null
    and pe.program_day_id is distinct from s.program_day_id;

  -- Set: egzersizin programının sahibi oturumun sahibi değil.
  select count(*) into bad_set_owner
  from public.workout_sets as ws
  join public.workout_sessions as s on s.id = ws.session_id
  join public.program_exercises as pe on pe.id = ws.program_exercise_id
  join public.program_days as pd on pd.id = pe.program_day_id
  join public.programs as pr on pr.id = pd.program_id
  where ws.program_exercise_id is not null
    and pr.owner_id is distinct from s.user_id;

  -- Set: Faz 1 sonrası kardiyo egzersizine yazılmış set satırı.
  select count(*) into bad_set_cardio
  from public.workout_sets as ws
  join public.program_exercises as pe on pe.id = ws.program_exercise_id
  where ws.program_exercise_id is not null
    and pe.tracking_mode is distinct from 'sets_reps';

  -- Set: bağlı olduğu oturumun program/gün bağı yarım.
  select count(*) into bad_set_broken_session
  from public.workout_sets as ws
  join public.workout_sessions as s on s.id = ws.session_id
  where ws.program_exercise_id is not null
    and (s.program_id is null) <> (s.program_day_id is null);

  total := bad_session_partial_link + bad_session_day_mismatch + bad_session_owner
         + bad_set_day_mismatch + bad_set_owner + bad_set_cardio + bad_set_broken_session;

  if total > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'workout_ownership_preflight_failed',
      detail = format(
        'session_partial_link=%s session_day_mismatch=%s session_owner=%s '
        || 'set_day_mismatch=%s set_owner=%s set_cardio=%s set_broken_session=%s total=%s',
        bad_session_partial_link, bad_session_day_mismatch, bad_session_owner,
        bad_set_day_mismatch, bad_set_owner, bad_set_cardio, bad_set_broken_session, total
      ),
      hint = 'Bozuk satirlar migration tarafindan DUZELTILMEZ. Once veriyi elle inceleyin.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) workout_sessions — açık sahiplik zinciri
-- ---------------------------------------------------------------------------

/**
 * SELECT ve DELETE politikaları BİLİNÇLİ OLARAK DEĞİŞTİRİLMEZ.
 *
 * Program silindikten sonra `program_id`/`program_day_id` NULL'a düşen tarihsel
 * oturum, sahibi tarafından okunabilir ve silinebilir kalmalıdır. Bu politikalara
 * zincir eklenseydi o satırlar kullanıcıya görünmez olurdu.
 */

/**
 * INSERT — zincirin HER halkası açıkça yazılır.
 *
 * `program_exercises` gibi başka bir tablonun kendi RLS'ine GÜVENİLMEZ: politika
 * alt sorgusunda o tablonun RLS'inin uygulanmasına dayanmak örtük bir varsayımdır
 * ve ileride bir `security definer` yol veya politika değişikliği onu sessizce
 * bozabilir.
 *
 * AKTİF PROGRAM VE PLANLI GÜN ŞARTI BİLİNÇLİ OLARAK YOKTUR: kullanıcı herhangi
 * bir programının herhangi bir gününü açıp antrenman başlatabilir ve bu meşru
 * mevcut davranıştır. `is_active` veya `scheduled_weekday` şartı eklemek çalışan
 * bir akışı kırardı.
 *
 * Plansız (bağsız) oturum DESTEKLENMEZ: iki bağ da zorunludur. Uygulamada
 * programsız antrenman akışı yoktur; NULL bağ yalnızca program silindikten
 * SONRA, foreign key'in `on delete set null` davranışıyla oluşur.
 */
drop policy if exists "workout_sessions_insert_own" on public.workout_sessions;
create policy "workout_sessions_insert_own"
on public.workout_sessions for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and program_id is not null
  and program_day_id is not null
  and exists (
    select 1
    from public.program_days as pd
    join public.programs as pr on pr.id = pd.program_id
    where pd.id = workout_sessions.program_day_id
      and pr.id = workout_sessions.program_id
      and pr.owner_id = (select auth.uid())
  )
);

/**
 * UPDATE — sahiplik korunur; bağ DOLUYSA zincir de doğrulanır.
 *
 * `program_id is null and program_day_id is null` dalı, program silindikten
 * sonra kalan tarihsel oturumun `status`, `notes`, sayaç alanları ve ilk kez
 * `deleted_at` yazımı için güncellenebilir kalmasını sağlar. Alan düzeyindeki
 * değişmezlik guard trigger'ına aittir.
 */
drop policy if exists "workout_sessions_update_own" on public.workout_sessions;
create policy "workout_sessions_update_own"
on public.workout_sessions for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    (program_id is null and program_day_id is null)
    or exists (
      select 1
      from public.program_days as pd
      join public.programs as pr on pr.id = pd.program_id
      where pd.id = workout_sessions.program_day_id
        and pr.id = workout_sessions.program_id
        and pr.owner_id = (select auth.uid())
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3) workout_sessions — değişmezlik guard'ı
-- ---------------------------------------------------------------------------

/**
 * RLS `using` (ESKİ satır) ve `with check` (YENİ satır) ifadelerini ayrı
 * değerlendirir; "bu alan eskiden neydi" karşılaştırması orada yazılamaz. Alan
 * düzeyindeki değişmezlik bu yüzden trigger'a taşınır.
 *
 * DEĞİŞMEZ: `user_id`, `workout_date`, `started_at`, `created_at`.
 *   `workout_date` ödül anahtarının tarih önekidir; değişebilir olması aynı seti
 *   birden çok tarihte ödüllendirmeye izin veriyordu. İstemci bu alanların
 *   hiçbirini güncellemez.
 *
 * DÜZENLENEBİLİR: `status`, `last_resumed_at`, `accumulated_duration_seconds`,
 *   `completed_at`, `notes` — start/pause/resume/finish akışının tamamı.
 *
 * PROGRAM BAĞLARI:
 *   non-null → NULL      : SERBEST (foreign key'in `on delete set null` davranışı
 *                          tam olarak budur; engellenirse program silinemez).
 *   non-null → başka non-null : YASAK.
 *   NULL → non-null      : YASAK (kopmuş tarihsel oturum yeniden bağlanamaz).
 *
 * DÜRÜST GÜVENLİK NOTU — "NULL'a yalnızca foreign key düşürebilir" İDDİA
 * EDİLMİYOR. Postgres'te BEFORE UPDATE trigger'ı güncellemenin FK eyleminden mi
 * kullanıcı ifadesinden mi geldiğini güvenilir biçimde ayırt edemez; dolayısıyla
 * kullanıcı KENDİ oturumunun bağını NULL'a düşürebilir. Bu YENİ ÖDÜL ÜRETMEZ:
 * ödül döngüsü artık oturumun program/gün bağının GEÇERLİ olmasını şart koşar,
 * yani bağını koparan kullanıcı o oturumun setlerini ödüllendiremez hâle gelir —
 * etki tamamen kendi aleyhinedir. Kullanıcı zaten oturumu tamamen silebilir.
 *
 * `deleted_at` TEK YÖNLÜDÜR:
 *   NULL → non-null      : SERBEST (mevcut `soft_delete_workout_session` akışı).
 *   non-null → NULL      : YASAK (undelete özelliği yoktur).
 *   non-null → başka değer: YASAK (silme zamanı geriye dönük değiştirilemez).
 */
create or replace function public.workout_sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.workout_date is distinct from old.workout_date
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'session_identity_immutable' using errcode = '42501';
  end if;

  -- Bağ yalnızca "kopabilir"; yeniden bağlanamaz ve başka bir bağa geçemez.
  if new.program_id is not null and new.program_id is distinct from old.program_id then
    raise exception 'session_program_immutable' using errcode = '42501';
  end if;

  if new.program_day_id is not null
     and new.program_day_id is distinct from old.program_day_id then
    raise exception 'session_program_day_immutable' using errcode = '42501';
  end if;

  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'session_delete_marker_immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

/**
 * Trigger fonksiyonu istemci tarafından DOĞRUDAN çağrılmaz. PostgreSQL trigger'ı
 * tablo sahibinin adına çalıştırır ve çağıranın fonksiyon üzerinde `execute`
 * ayrıcalığı olmasını ARAMAZ; yetkilerin kaldırılması trigger'ın çalışmasını
 * etkilemez, yalnızca doğrudan çağrı yüzeyini kapatır.
 */
revoke all on function public.workout_sessions_guard() from public;
revoke all on function public.workout_sessions_guard() from anon;
revoke all on function public.workout_sessions_guard() from authenticated;

drop trigger if exists workout_sessions_guard on public.workout_sessions;
create trigger workout_sessions_guard
before update on public.workout_sessions
for each row execute function public.workout_sessions_guard();

-- ---------------------------------------------------------------------------
-- 4) workout_sets — açık zincir ve kapatılmış UPDATE yolu
-- ---------------------------------------------------------------------------

/**
 * SELECT ve DELETE politikaları DEĞİŞTİRİLMEZ.
 *
 * Undo akışı `delete` kullanır; ayrıca program veya egzersiz silindikten sonra
 * `program_exercise_id` NULL'a düşen tarihsel satır sahibi tarafından okunabilir
 * ve silinebilir kalmalıdır.
 */

/**
 * INSERT — Faz 1'in aktivite politikasının birebir eşleniği, artı `sets_reps` şartı.
 *
 * Join zorunlu olduğu için `program_exercise_id = NULL` ile doğrudan insert
 * KENDİLİĞİNDEN reddedilir: NULL hiçbir egzersizle eşleşmez. NULL yalnızca
 * sonradan, foreign key'in `on delete set null` davranışıyla oluşabilir.
 *
 * `set_number` ile `target_sets` arasında BİLİNÇLİ OLARAK kısıt yoktur: hedef
 * üstü ekstra set gerçek bir antrenman olayıdır, kaydedilir ve history/progress
 * ekranlarında görünür. Ekstra setin ödül üretmemesi ödül fonksiyonunda çözülür,
 * kaydın engellenmesiyle değil.
 */
drop policy if exists "workout_sets_insert_own" on public.workout_sets;
create policy "workout_sets_insert_own"
on public.workout_sets for insert
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
      on pe.id = workout_sets.program_exercise_id
     and pe.program_day_id = pd.id
    where s.id = workout_sets.session_id
      and s.user_id = (select auth.uid())
      and pr.owner_id = (select auth.uid())
      and s.program_id = pr.id
      and s.program_day_id = pd.id
      and pe.tracking_mode = 'sets_reps'
  )
);

/**
 * UPDATE YOLU TAMAMEN KAPATILIR.
 *
 * İstemci `workout_sets` üzerinde hiç UPDATE kullanmaz — yalnızca insert, delete
 * ve select. Bu yüzden alan düzeyinde bir guard trigger'ı yazmak yerine yolun
 * kendisi kapatılır; bu hem daha basit hem de daha güçlüdür.
 *
 * İKİ KATMAN birlikte uygulanır:
 *   1. Politikanın kaldırılması — RLS altında politikası olmayan komut hiçbir
 *      satırı etkilemez.
 *   2. Tablo düzeyinde `revoke update` — istek RLS'e ulaşmadan reddedilir.
 *
 * SELECT/INSERT/DELETE yetkileri AÇIKÇA yeniden verilir, böylece revoke'un
 * kapsamı belirsiz kalmaz.
 *
 * Foreign key'in `on delete set null` eylemi bu revoke'tan ETKİLENMEZ: referans
 * bütünlüğü eylemleri sistem düzeyinde, referans edilen tablonun sahibinin
 * ayrıcalıklarıyla yürütülür ve `authenticated` rolünün UPDATE ayrıcalığını
 * aramaz. Bu, runtime testinde ayrıca doğrulanır.
 */
drop policy if exists "workout_sets_update_own" on public.workout_sets;

revoke update on table public.workout_sets from authenticated;
grant select, insert, delete on table public.workout_sets to authenticated;

-- ---------------------------------------------------------------------------
-- 5) sync_workout_rewards — strength döngüsünün sıkılaştırılması
-- ---------------------------------------------------------------------------

/**
 * DEĞİŞEN TEK ŞEY strength set döngüsünün NEREDEN okuduğudur.
 *
 * KORUNAN HER ŞEY:
 *   * imza, `security definer`, `set search_path = ''`, grant/revoke,
 *   * `assert_client_today` ve hedef tarih penceresi,
 *   * advisory lock,
 *   * `source_key` biçimi: `<tarih>:<program_exercise_id>:<set_number>` —
 *     session kimliği anahtara EKLENMEZ, dolayısıyla aynı gün birden fazla
 *     oturumda aynı (egzersiz, set) tek ödül üretmeye devam eder ve
 *     sil-yeniden-ekle ikinci ödül vermez,
 *   * aktivite döngüsü (Faz 1): 9 XP / 9 gül, `activity` olay türü,
 *   * gün / off-day / streak uzlaştırmasının ortak transaction davranışı,
 *   * ödül tutarları: planlı set 3 XP / 3 gül.
 *
 * `deleted_at` FİLTRESİ EKLENMEZ. Takvim fonksiyonları da bu filtreyi bilinçli
 * olarak uygulamaz; ödül yolunun onlarla tutarlı kalması gerekir. Rank tarafının
 * kendi `deleted_at` filtresi Faz 1'de olduğu gibi korunur. Append-only ledger
 * hiçbir koşulda geri alınmaz.
 *
 * EKLENEN KOŞULLAR:
 *   * oturumun program/gün bağı GEÇERLİ olmalı (yarım veya kopuk bağ ödül üretmez),
 *   * programın sahibi ödülü alan kullanıcı olmalı,
 *   * egzersiz oturumun gününe ait olmalı,
 *   * egzersiz `tracking_mode = 'sets_reps'` olmalı — kardiyo egzersizine
 *     yazılmış bir set satırı artık 3 XP üretemez,
 *   * `set_number <= target_sets` — hedef üstü EKSTRA set ödül üretmez.
 *     Ekstra set `workout_sets` içinde KALIR ve history/progress'te görünür;
 *     yalnızca ödül döngüsüne girmez. Disiplin ilerlemesi zaten
 *     `least(count, target_sets)` ile sınırlıydı; ödül artık aynı tavanı kullanır.
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

  -- 1) PLANLI tamamlanan setler: +3 XP / +3 gül.
  for set_row in
    select ws.program_exercise_id, ws.set_number
    from public.workout_sets as ws
    join public.workout_sessions as s on s.id = ws.session_id
    join public.program_days as pd on pd.id = s.program_day_id
    join public.programs as pr on pr.id = pd.program_id
    join public.program_exercises as pe
      on pe.id = ws.program_exercise_id
     and pe.program_day_id = pd.id
    where s.user_id = actor
      and s.workout_date = target_date
      and ws.program_exercise_id is not null
      and s.program_id = pr.id
      and pr.owner_id = actor
      and pe.tracking_mode = 'sets_reps'
      and pe.target_sets is not null
      and ws.set_number <= pe.target_sets
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
  --    Faz 1'de tanımlandığı gibi DEĞİŞMEDİ.
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
