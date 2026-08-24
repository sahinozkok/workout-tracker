/**
 * GEÇMİŞ DİSİPLİN TAKVİMİNİN KALICI HÂLE GETİRİLMESİ
 *
 * KÖK NEDEN
 * ---------
 * Otomatik disiplin durumları hiçbir yerde SAKLANMIYORDU; her açılışta o an
 * aktif olan programdan yeniden TÜRETİLİYORDU:
 *
 *   * `utils/workout-schedule.ts` → `getScheduledDisciplineStatus`, tarih
 *     `activeProgramStartedAt`'tan küçükse `undefined` döner.
 *   * `activate_program` yeni programın `active_from` değerini BUGÜNE çeker.
 *
 * Sonuç: program değiştiği anda eski dönemin bütün otomatik günleri (yeşil,
 * kısmi, atlanmış, off-day) hesaptan düşer ve takvim sıfırlanmış görünür.
 * İkinci katman kayıp: `sync_shared_discipline_days` payload'da bulunmayan
 * pencere içi günleri SİLDİĞİ için, sıfırlanmış takvim bir kez senkronize
 * olduğunda arkadaşlara görünen geçmiş de silinir.
 *
 * ÖDÜLLER ZATEN KORUNUYORDU: `20260820090000_add_progression_rewards.sql`
 * program değişmeden/silinmeden önce `reconcile_pending_days_all` çağırarak
 * DEĞİŞMEZ `reward_ledger` kayıtlarını yazar. Bu migration ödül tarafına
 * dokunmaz; yalnızca EKRANDA GÖRÜNEN geçmişi kalıcılaştırır.
 *
 * ÇÖZÜM
 * -----
 * 1. Sunucu kontrollü `discipline_day_history` tablosu (yalnızca SELECT).
 * 2. Ekran kurallarını birebir yansıtan PRIVATE `display_discipline_range`.
 *    `auto_discipline_range` (ödül kaynağı) BİLİNÇLİ olarak değiştirilmedi:
 *    o fonksiyon 'skipped' üretmez, çünkü atlanan gün ödüllendirilmez.
 * 3. Program değişmeden ve aktif program silinmeden ÖNCE snapshot.
 * 4. `shared_discipline_days` içinde HÂLÂ duran günlerin bir defalık kurtarma
 *    aktarımı.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Geçmiş tablosu
-- ---------------------------------------------------------------------------

/**
 * Dondurulmuş (immutable) görüntüleme geçmişi.
 *
 * `(user_id, discipline_date)` PRIMARY KEY: bir gün için tek satır; snapshot
 * tekrar çalışsa da çift kayıt oluşamaz.
 *
 * `source_program_id` yalnızca köken bilgisidir. Program silindiğinde
 * `on delete set null` ile boşalır; GEÇMİŞ SATIRI SİLİNMEZ.
 */
create table public.discipline_day_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  discipline_date date not null,
  status text not null check (status in ('completed', 'partial', 'skipped')),
  source_program_id uuid references public.programs(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, discipline_date)
);

create index discipline_day_history_user_idx on public.discipline_day_history (user_id);

create trigger discipline_day_history_set_updated_at
before update on public.discipline_day_history
for each row execute function public.set_updated_at();

alter table public.discipline_day_history enable row level security;

-- Supabase'in varsayılan geniş grant'lerine güvenilmez: `anon` hiçbir şey
-- yapamaz, `authenticated` YALNIZCA SELECT alır. Bütün yazmalar aşağıdaki
-- SECURITY DEFINER akışından geçer. `service_role` grant'lerine dokunulmaz.
revoke all on table public.discipline_day_history from anon;
revoke all on table public.discipline_day_history from authenticated;
grant select on table public.discipline_day_history to authenticated;

-- Tek politika: kullanıcı yalnızca KENDİ geçmişini okur. INSERT/UPDATE/DELETE
-- politikası bilinçli olarak YOKTUR; RLS altında politikasız komut reddedilir,
-- yani grant kazara geri gelse bile istemci yazamaz.
create policy "discipline_day_history_select_self"
on public.discipline_day_history for select
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2) Ekran kurallarının sunucu karşılığı (PRIVATE)
-- ---------------------------------------------------------------------------

/**
 * `getScheduledDisciplineStatus` (istemci) kurallarının BİREBİR karşılığı:
 *
 *   * o hafta gününe planlanmış program günü yok      → durum yok
 *   * tarih `active_from`'dan önce                    → durum yok
 *   * gün off-day                                     → 'completed'
 *   * hedef set toplamı 0                             → 'skipped'
 *   * bütün hedef setler tamamlanmış                  → 'completed'
 *   * kısmen tamamlanmış                              → 'partial'
 *   * hiç ilerleme yok                                → 'skipped'
 *
 * `auto_discipline_range` ile FARKI yalnızca 'skipped' üretmesidir. Ödül
 * hesabı atlanan günü ödüllendirmediği için orada NULL doğrudur; ekran geçmişi
 * ise atlanan günü kırmızı/gri göstermek zorundadır. Bu yüzden ödül
 * fonksiyonunu değiştirmek yerine AYRI bir fonksiyon yazıldı.
 *
 * `open_day` — HENÜZ BİTMEMİŞ gün. İstemcideki "bugün 0 ilerleme atlandı
 * sayılmaz" istisnasının birebir karşılığıdır: bu tarihte sonuç 'skipped'
 * olacaksa NULL döner (durum üretilmez). Program DEĞİŞİMİNDE bütün günler
 * kesin geçmiş olduğu için NULL geçilir; program SİLİNMESİNDE bugün de
 * kapsandığı için `current_date` geçilir.
 *
 * Hiçbir role grant edilmez; yalnızca aşağıdaki snapshot fonksiyonu çağırır.
 */
-- Bu migration'ın erken bir kopyası uygulanmış olabilir: 3 argümanlı sürüm
-- kalırsa overload belirsizliği doğardı.
drop function if exists public.display_discipline_range(uuid, date, date);

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
      -- Hedef seti olmayan gün: bitmiş günde 'skipped', açık günde durum yok.
      when t.total_target = 0 then case when t.day_date = open_day then null else 'skipped' end
      when t.total_done >= t.total_target then 'completed'
      when t.total_done > 0 then 'partial'
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
-- 3) Snapshot (PRIVATE)
-- ---------------------------------------------------------------------------

/**
 * Aktif programın penceresini `through_date` dahil olacak şekilde dondurur.
 *
 * TARİH SINIRI: [aktif programın `active_from`, `through_date`].
 *
 *   * PROGRAM DEĞİŞİMİ → `through_date = current_date - 1`, `open_day = null`.
 *     Değişim günü DAHİL DEĞİLDİR: o gün ve sonrası yeni programa aittir
 *     (`activate_program` yeni `active_from` değerini `current_date` yapar).
 *   * PROGRAM SİLİNMESİ → `through_date = current_date`, `open_day = current_date`.
 *     Yerine geçen program OLMADIĞI için bugün de kapsanır; ama gün henüz
 *     bitmediğinden sıfır ilerleme 'skipped' YAZILMAZ. Tamamlanan, kısmi ve
 *     off-day durumları korunur.
 *
 * `on conflict do nothing` üç şeyi birden sağlar:
 *   * aynı çağrı tekrarlanırsa çift kayıt veya farklı sonuç üretmez,
 *   * daha önce dondurulmuş günler ASLA yeniden yazılmaz (program sonradan
 *     düzenlense, silinse veya geri aktifleştirilse bile),
 *   * kurtarma aktarımıyla gelen satırlar ezilmez.
 *
 * Hiçbir role grant edilmez.
 */
-- Bkz. `display_discipline_range`: eski 2 argümanlı sürüm overload belirsizliği
-- yaratmasın diye düşürülür.
drop function if exists public.snapshot_active_program_history(uuid, date);

create or replace function public.snapshot_active_program_history(
  actor uuid,
  through_date date,
  open_day date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_program_id uuid;
  active_start date;
  written integer := 0;
begin
  if actor is null or through_date is null then
    return 0;
  end if;

  -- Hesap silinirken `programs` cascade ile gider; `auth.users` satırı çoktan
  -- gitmiş olabilir. O durumda FK ihlali yaratmamak için hiçbir şey yazılmaz.
  if not exists (select 1 from auth.users as u where u.id = actor) then
    return 0;
  end if;

  select p.id, p.active_from
  into active_program_id, active_start
  from public.programs as p
  where p.owner_id = actor and p.is_active
  limit 1;

  if active_program_id is null or active_start is null or active_start > through_date then
    return 0;
  end if;

  insert into public.discipline_day_history (user_id, discipline_date, status, source_program_id)
  select actor, r.discipline_date, r.status, active_program_id
  from public.display_discipline_range(actor, active_start, through_date, open_day) as r
  where r.status is not null
  on conflict (user_id, discipline_date) do nothing;

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke all on function public.snapshot_active_program_history(uuid, date, date) from public;
revoke all on function public.snapshot_active_program_history(uuid, date, date) from anon;
revoke all on function public.snapshot_active_program_history(uuid, date, date) from authenticated;

-- ---------------------------------------------------------------------------
-- 4) Program DEĞİŞİMİ: eski program hâlâ aktifken dondur
-- ---------------------------------------------------------------------------

/**
 * `activate_program` İMZASI DEĞİŞMEDİ: (uuid, date). Gövdeye yalnızca
 * görüntüleme snapshot'ı eklendi; ödül uzlaştırması aynen korundu.
 *
 * Snapshot, eski program KAPATILMADAN önce ve aynı transaction içinde alınır.
 * Snapshot hata verirse program değişimi de geri alınır (istenen davranış 7).
 */
create or replace function public.activate_program(
  target_program_id uuid,
  client_today date default null
)
returns void
language plpgsql
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

  /**
   * GERÇEK NO-OP: hedef program zaten aktifse hiçbir şey yapılmadan dönülür.
   *
   * Kilitten SONRA okunur, aksi hâlde eşzamanlı bir aktivasyon araya girip
   * kontrolü yanıltabilirdi. Erken dönüş şunları engeller:
   *   * `active_from` bugüne çekilip programın gerçek başlangıcının kayması,
   *   * geçmişin bugüne kadar erken dondurulması,
   *   * ödül uzlaştırmasının ikinci kez çalışması.
   */
  if exists (
    select 1
    from public.programs as p
    where p.id = target_program_id
      and p.owner_id = actor
      and p.is_active
  ) then
    return;
  end if;

  -- Eski programın penceresi HÂLÂ görünürken bekleyen günler uzlaştırılır.
  select p.active_from into previous_program_start
  from public.programs as p
  where p.owner_id = actor and p.is_active
  limit 1;

  if previous_program_start is not null then
    reconcile_through := coalesce(client_today, current_date);
    if reconcile_through < current_date - 1 or reconcile_through > current_date + 1 then
      reconcile_through := current_date;
    end if;

    perform public.ensure_user_progress(actor);

    select up.created_at::date into progress_start
    from public.user_progress as up
    where up.user_id = actor;

    reconciliation_start := greatest(previous_program_start, coalesce(progress_start, current_date));

    if reconciliation_start is not null and reconciliation_start <= reconcile_through then
      perform public.reconcile_pending_days_all(actor, reconciliation_start, reconcile_through);
    end if;
  end if;

  /**
   * GÖRÜNTÜLEME GEÇMİŞİ — eski program hâlâ aktifken dondurulur.
   *
   * Ödül uzlaştırmasından FARKLI olarak `user_progress.created_at` alt sınırı
   * UYGULANMAZ: ekran geçmişi ödül değildir, progression sisteminden önceki
   * günler de takvimde görünmelidir. Üst sınır `current_date - 1`; değişim
   * günü yeni programa aittir.
   */
  perform public.snapshot_active_program_history(actor, current_date - 1, null);

  update public.programs as p
  set is_active = false,
      active_from = null
  where p.owner_id = actor and p.is_active;

  update public.programs as p
  set is_active = true,
      active_from = current_date
  where p.id = target_program_id and p.owner_id = actor;
end;
$$;

revoke all on function public.activate_program(uuid, date) from public;
revoke all on function public.activate_program(uuid, date) from anon;
grant execute on function public.activate_program(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Program SİLİNMESİ: silinmeden önce dondur
-- ---------------------------------------------------------------------------

/**
 * Mevcut ödül uzlaştırma tetikleyicisine görüntüleme snapshot'ı eklendi.
 * Snapshot, satır silinmeden ÖNCE (before delete) çalışır; `program_days`
 * cascade ile gittikten sonra o dönem bir daha hesaplanamazdı.
 *
 * Yazılan satırların `source_program_id` değeri, silme tamamlandığında FK'nın
 * `on delete set null` kuralıyla boşalır — satırın kendisi KALIR.
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

    select up.created_at::date into progress_start
    from public.user_progress as up
    where up.user_id = old.owner_id;

    reconciliation_start := greatest(old.active_from, coalesce(progress_start, current_date));

    if reconciliation_start is not null and reconciliation_start <= current_date then
      perform public.reconcile_pending_days_all(old.owner_id, reconciliation_start, current_date);
    end if;

    /**
     * Görüntüleme geçmişi: ödül alt sınırı olmadan, program hâlâ dururken.
     *
     * Program DEĞİŞİMİNDEN farklı olarak BUGÜN de kapsanır (`through_date =
     * current_date`), çünkü yerine geçen bir program yoktur; bugünü dışarıda
     * bırakmak, bugün yapılmış gerçek ilerlemeyi silerdi. `open_day` da bugün
     * olduğu için sıfır ilerleme 'skipped' yazılmaz — gün henüz bitmedi.
     */
    perform public.snapshot_active_program_history(old.owner_id, current_date, current_date);
  end if;

  return old;
end;
$$;

revoke all on function public.reconcile_before_program_delete() from public;
revoke all on function public.reconcile_before_program_delete() from anon;
revoke all on function public.reconcile_before_program_delete() from authenticated;

-- ---------------------------------------------------------------------------
-- 6) Bir defalık kurtarma aktarımı
-- ---------------------------------------------------------------------------

/**
 * `shared_discipline_days` içinde HÂLÂ duran günler yeni geçmiş tablosuna
 * taşınır. Bu tablo arkadaş görünümü için tutulur ve program değişiminden
 * SONRA senkronizasyon çalışmadıysa eski günleri hâlâ barındırıyor olabilir.
 *
 * TARİH SINIRI — yalnızca CANLI hesapla artık üretilemeyen dönem:
 *
 *   * Aktif programı OLAN kullanıcıda yalnızca `discipline_date <
 *     active_from` satırları taşınır. Aktif dönemin günleri her açılışta
 *     canlı hesaplanmaya devam ettiği için buraya KOPYALANMAZ. Kopyalansaydı
 *     bugünkü `partial` durum değişmez geçmişe erken donar; kullanıcı günü
 *     sonradan `completed` yapsa bile gerçek snapshot `on conflict do
 *     nothing` kullandığı için satır düzelmez ve program değişiminde takvim
 *     yeniden `partial` görünürdü.
 *   * Aktif programı OLMAYAN kullanıcıda canlı hesap zaten hiçbir gün
 *     üretemez; shared geçmişin tamamı kurtarılır.
 *
 * Diğer güvenceler:
 *   * `lateral` alt sorgu `d.user_id` ile korelasyonludur → kullanıcılar
 *     arası karışma olamaz.
 *   * `on conflict do nothing` → mevcut değişmez satır ezilmez.
 *   * `status` zaten ('completed','partial','skipped') ile kısıtlı; `where`
 *     ikinci bir güvenlik katmanı.
 *   * Gelecek tarih taşınmaz.
 *   * `source_program_id` NULL: bu günlerin hangi programdan geldiği artık
 *     bilinmiyor. TAHMİN EDİLMEZ.
 *
 * Bu aktarım yalnızca veritabanında HÂLÂ bulunan veriyi kurtarabilir.
 * Senkronizasyon sırasında silinmiş günler geri getirilemez.
 */
insert into public.discipline_day_history (user_id, discipline_date, status, source_program_id)
select d.user_id, d.discipline_date, d.status, null
from public.shared_discipline_days as d
left join lateral (
  select p.active_from
  from public.programs as p
  where p.owner_id = d.user_id
    and p.is_active
  limit 1
) as ap on true
where d.status in ('completed', 'partial', 'skipped')
  and d.discipline_date <= current_date
  and (ap.active_from is null or d.discipline_date < ap.active_from)
on conflict (user_id, discipline_date) do nothing;

commit;
