/**
 * PROGRAM SIRALAMASI + WORKOUT SOFT-DELETE
 *
 * Bu migration ileri yönlüdür ve TEKRAR ÇALIŞTIRILABİLİR: bütün nesneler
 * `if not exists` / `create or replace` / `drop ... if exists` ile korunur.
 * Daha önce uygulanmış hiçbir migration dosyası düzenlenmedi.
 *
 * ---------------------------------------------------------------------------
 * 1) `programs.sort_order` — kullanıcı içi el ile sıralama
 * ---------------------------------------------------------------------------
 * Kolon adı bilinçli olarak `position` DEĞİL: `position` SQL standardında
 * ayrılmış bir anahtar kelimedir (`position(x in y)`) ve tırnaksız kullanımda
 * sürprize açıktır.
 *
 * ---------------------------------------------------------------------------
 * 2) `workout_sessions.deleted_at` — soft delete
 * ---------------------------------------------------------------------------
 * KRİTİK TASARIM KARARI: silinen antrenman DİSİPLİN KANITI olarak durmaya
 * devam eder.
 *
 * Disiplin durumu (`auto_discipline_range`, `display_discipline_range`) ve
 * ödül uzlaştırması `workout_sets` → `workout_sessions` üzerinden hesaplanır.
 * Bu fonksiyonlara `deleted_at` filtresi EKLENMEZ; dolayısıyla:
 *   * o günün yeşil/turuncu rengi değişmez,
 *   * streak geçmişi geriye dönük bozulmaz,
 *   * daha önce yazılmış `reward_ledger` kayıtları ve `discipline_day_history`
 *     satırları etkilenmez.
 * Filtre YALNIZCA kullanıcıya görünen geçmiş ve analitik sorgularında uygulanır
 * (istemci `workout-context`, AI `workout-coach` edge function).
 *
 * Hard delete BİLİNÇLİ olarak kullanılmaz: `workout_sets` cascade ile silinirdi
 * ve o günün disiplin kanıtı geri dönülemez biçimde kaybolurdu.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Program sıralaması
-- ---------------------------------------------------------------------------

alter table public.programs
add column if not exists sort_order integer;

/**
 * Backfill DETERMİNİSTİK ve mevcut görünüm sırasını korur: liste bugüne kadar
 * `created_at desc` ile geliyordu, yani en yeni program en üstteydi. `id` ikinci
 * anahtar olarak eşit `created_at` durumunda sırayı sabitler.
 * Yalnızca boş satırlar doldurulur → tekrar çalıştırmada sıra bozulmaz.
 */
with ordered as (
  select
    p.id,
    (row_number() over (partition by p.owner_id order by p.created_at desc, p.id) - 1) as computed_order
  from public.programs as p
)
update public.programs as p
set sort_order = o.computed_order
from ordered as o
where o.id = p.id
  and p.sort_order is null;

create index if not exists programs_owner_sort_idx
on public.programs (owner_id, sort_order);

/**
 * Yeni program sahibinin listesinin SONUNA eklenir.
 *
 * `security definer` değildir: tetikleyici zaten tablo sahibinin hakkıyla
 * çalışır ve yalnızca eklenen satırın kendi alanını doldurur.
 *
 * KİLİT: `max(sort_order) + 1` okunmadan ÖNCE kullanıcıya özel transaction
 * advisory lock alınır. Kilit olmasaydı aynı kullanıcı için eşzamanlı iki
 * ekleme aynı `max` değerini okuyup AYNI `sort_order`'ı üretebilir, liste
 * sırası belirsizleşirdi.
 *
 * Anahtar bilinçli olarak `reorder_programs` ile AYNIDIR (`8022`): ekleme ve
 * yeniden sıralama aynı kullanıcı için karşılıklı dışlamalı çalışır. Anahtar
 * `owner_id` ile türetildiği için farklı kullanıcıların eklemeleri birbirini
 * BEKLETMEZ.
 */
create or replace function public.set_program_sort_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sort_order is null then
    perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 8022));

    select coalesce(max(p.sort_order) + 1, 0)
    into new.sort_order
    from public.programs as p
    where p.owner_id = new.owner_id;
  end if;

  return new;
end;
$$;

drop trigger if exists programs_set_sort_order on public.programs;
create trigger programs_set_sort_order
before insert on public.programs
for each row execute function public.set_program_sort_order();

/**
 * Sıralamayı TEK transaction içinde yazar.
 *
 * Doğrulamalar (hepsi hata fırlatır, sessizce düzeltme YOK):
 *   * oturum açık olmalı,
 *   * dizi null/boş olmamalı,
 *   * tekrar eden id olmamalı,
 *   * dizideki her id çağıran kullanıcıya ait olmalı — başka kullanıcının
 *     programı gönderilirse `not_owner` hatası döner ve HİÇBİR satır yazılmaz,
 *   * dizi kullanıcının programlarının TAMAMINI içermeli (eksik id reddedilir),
 *     aksi hâlde listede boşluk/çakışan sıra oluşurdu.
 *
 * Yazma `owner_id = actor` ile sınırlıdır; başka kullanıcının sırası hiçbir
 * durumda değişmez.
 */
create or replace function public.reorder_programs(program_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  incoming_count integer;
  distinct_count integer;
  owned_count integer;
  total_count integer;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if program_ids is null or array_length(program_ids, 1) is null then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  select count(*), count(distinct id)
  into incoming_count, distinct_count
  from unnest(program_ids) as id;

  if incoming_count <> distinct_count then
    raise exception 'duplicate_program_ids' using errcode = '22023';
  end if;

  -- Aynı kullanıcının eşzamanlı sıralama çağrıları sıraya alınır.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8022));

  select count(*)
  into owned_count
  from public.programs as p
  where p.owner_id = actor
    and p.id = any(program_ids);

  if owned_count <> incoming_count then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select count(*) into total_count
  from public.programs as p
  where p.owner_id = actor;

  if total_count <> incoming_count then
    raise exception 'incomplete_program_list' using errcode = '22023';
  end if;

  update public.programs as p
  set sort_order = ordered.new_order
  from (
    select id, (ordinality - 1)::integer as new_order
    from unnest(program_ids) with ordinality as t(id, ordinality)
  ) as ordered
  where p.id = ordered.id
    and p.owner_id = actor
    and p.sort_order is distinct from ordered.new_order;
end;
$$;

revoke all on function public.reorder_programs(uuid[]) from public;
revoke all on function public.reorder_programs(uuid[]) from anon;
grant execute on function public.reorder_programs(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Antrenman soft-delete
-- ---------------------------------------------------------------------------

alter table public.workout_sessions
add column if not exists deleted_at timestamptz;

-- Kısmi indeks: canlı geçmiş sorguları yalnızca silinmemiş satırları tarar.
create index if not exists workout_sessions_user_active_idx
on public.workout_sessions (user_id, workout_date desc)
where deleted_at is null;

/**
 * TAMAMLANMIŞ bir antrenmanı kullanıcıya görünmez yapar; satır ve setleri
 * KORUNUR.
 *
 *   * Sahiplik `auth.uid()` ile doğrulanır; başka kullanıcının session'ı
 *     `not_found` ile reddedilir (varlık bilgisi sızdırılmaz).
 *   * YALNIZCA `status = 'completed'` satırlar silinebilir. Kullanıcının kendi
 *     `running`/`paused` session'ı `invalid_session_status` ile reddedilir:
 *     bu ekran yalnızca GEÇMİŞ antrenmanları siler, devam eden bir antrenmanın
 *     yarıda kaybolması veri kaybı olurdu. Durum kontrolü sahiplik
 *     kontrolünden AYRI yapılır; böylece başka kullanıcının satırı yine
 *     `not_found` döner ve durum bilgisi sızmaz.
 *   * IDEMPOTENT: zaten silinmiş bir completed session için hata vermez ve
 *     `deleted_at` değerini DEĞİŞTİRMEZ (ilk silme zamanı korunur).
 *   * `workout_sets` silinmez → o günün disiplin kanıtı ve daha önce verilmiş
 *     ödüller olduğu gibi kalır.
 */
create or replace function public.soft_delete_workout_session(session_id uuid)
returns void
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

  if not exists (
    select 1
    from public.workout_sessions as s
    where s.id = session_id
      and s.user_id = actor
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.workout_sessions as s
    where s.id = session_id
      and s.user_id = actor
      and s.status = 'completed'
  ) then
    raise exception 'invalid_session_status' using errcode = '22023';
  end if;

  update public.workout_sessions as s
  set deleted_at = timezone('utc', now())
  where s.id = session_id
    and s.user_id = actor
    and s.status = 'completed'
    and s.deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_workout_session(uuid) from public;
revoke all on function public.soft_delete_workout_session(uuid) from anon;
grant execute on function public.soft_delete_workout_session(uuid) to authenticated;

commit;
