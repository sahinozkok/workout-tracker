-- Arkadaş mesajlarında OKUNMAMIŞ farkındalığı — hafif `last_read_at` modeli.
--
-- KAPSAM: yalnızca veritabanı. Uzaktan push, Edge Function, webhook veya
-- bildirim altyapısı YOKTUR; bu migration yalnızca "bu arkadaştan okunmamış
-- mesajım var mı" sorusunu ucuza yanıtlar.
--
-- TASARIM: mesaj başına read receipt TUTULMAZ. Kullanıcı–arkadaş YÖNÜ başına
-- en fazla TEK satır vardır, bu yüzden tablo mesaj sayısıyla BÜYÜMEZ: bir
-- konuşmada 10.000 mesaj olsa bile en fazla iki satır oluşur (her yön için
-- bir tane).
--
-- Güvenlik modeli:
--   * RLS açıktır. `anon` HİÇBİR yetki almaz.
--   * `authenticated` yalnızca KENDİ satırını SELECT eder; yazma yetkisi
--     YOKTUR — güncelleme dar amaçlı SECURITY DEFINER RPC'den geçer.
--   * RPC `auth.uid()` dışında hiçbir kullanıcı adına yazamaz.
--   * `has_unread` yalnızca KARŞI TARAFTAN gelen, süresi DOLMAMIŞ ve hâlâ
--     kabul edilmiş arkadaşlığa ait mesajlar için true olur.
--
-- DOKUNULMAYANLAR: 24 saatlik `friend_messages` expiry'si ve
-- `cleanup-expired-friend-messages` cron'u, engelleme/şikâyet kuralları,
-- içerik filtresi ve `list_friends()` davranışı DEĞİŞMEZ.
--
-- YENİDEN ÇALIŞTIRILABİLİRLİK: `if not exists`, `drop ... if exists` +
-- `create`, `create or replace` ve `on conflict` ile baştan sona idempotenttir.

begin;

-- ---------------------------------------------------------------------------
-- Tablo
-- ---------------------------------------------------------------------------

create table if not exists public.friend_message_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  /** Bu arkadaşla olan konuşmanın en son okunduğu an (sunucu zamanı). */
  last_read_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  /*
   * Birincil anahtar AÇIKÇA ADLANDIRILIR.
   *
   * Upsert'in `on conflict` cümlesi sütun LİSTESİ yerine bu ADI kullanır:
   * PL/pgSQL'de `on conflict (…)` içindeki sütun adları ifade olarak
   * çözümlenir ve fonksiyonun `friend_id` parametresiyle çakışıp çalışma
   * anında `42702 ambiguous column reference` üretebilirdi. Constraint adı
   * ifade değildir, bu yüzden belirsizlik YAPISAL OLARAK imkânsızdır.
   */
  constraint friend_message_reads_pkey primary key (user_id, friend_id),
  constraint friend_message_reads_no_self_check check (user_id <> friend_id)
);

-- Okuma sorgusu her zaman `user_id` ile başlar; birincil anahtar yeterlidir.
-- Bu indeks yalnızca arkadaş silinince yapılan temizlik içindir.
create index if not exists friend_message_reads_friend_idx
on public.friend_message_reads (friend_id);

alter table public.friend_message_reads enable row level security;

revoke all on table public.friend_message_reads from anon;
revoke all on table public.friend_message_reads from authenticated;
grant select on table public.friend_message_reads to authenticated;

-- Kullanıcı YALNIZCA kendi okuma satırını görür; başka kimsenin okuma
-- durumunu öğrenemez (karşı tarafa "görüldü" bilgisi SIZMAZ).
drop policy if exists "friend_message_reads_select_own" on public.friend_message_reads;
create policy "friend_message_reads_select_own"
on public.friend_message_reads for select
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Okundu işaretleme
-- ---------------------------------------------------------------------------

/*
 * Konuşmayı okundu işaretler.
 *
 * `auth.uid()` ZORUNLUDUR ve satır YALNIZCA onun adına yazılır: istemci
 * `user_id` gönderemez, başka kullanıcı adına yazamaz. Zaman damgası
 * SUNUCUDAN gelir; istemci saati kullanılmaz.
 *
 * IDEMPOTENT: tekrar çağrılırsa yeni satır oluşmaz, yalnızca `last_read_at`
 * ileri alınır. Zaman GERİ ALINMAZ (`greatest`), böylece geç tamamlanan bir
 * çağrı daha yeni bir okumayı geriye çekemez.
 */
create or replace function public.mark_friend_messages_read(friend_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  now_utc timestamptz := timezone('utc', now());
  applied timestamptz;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if mark_friend_messages_read.friend_id is null
    or mark_friend_messages_read.friend_id = actor then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  /**
   * Arkadaş olmayan veya engelli bir çift için satır YAZILMAZ: okuma durumu
   * yalnızca gerçekten görülebilen bir konuşma için anlamlıdır.
   */
  if not public.are_friends(actor, mark_friend_messages_read.friend_id) then
    raise exception 'not_friends' using errcode = '42501';
  end if;

  if public.has_block_between(actor, mark_friend_messages_read.friend_id) then
    raise exception 'relationship_unavailable' using errcode = '42501';
  end if;

  insert into public.friend_message_reads (user_id, friend_id, last_read_at, updated_at)
  values (actor, mark_friend_messages_read.friend_id, now_utc, now_utc)
  -- Sütun listesi DEĞİL, constraint ADI: `friend_id` parametresiyle
  -- belirsizlik oluşamaz (bkz. tablo tanımındaki not).
  on conflict on constraint friend_message_reads_pkey do update
  set
    -- Zaman yalnızca İLERİ gider.
    last_read_at = greatest(public.friend_message_reads.last_read_at, excluded.last_read_at),
    updated_at = excluded.updated_at
  returning last_read_at into applied;

  return applied;
end;
$$;

revoke all on function public.mark_friend_messages_read(uuid) from public;
revoke all on function public.mark_friend_messages_read(uuid) from anon;
grant execute on function public.mark_friend_messages_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Okunmamış sorgusu
-- ---------------------------------------------------------------------------

/*
 * Okunmamış mesajı olan arkadaşlar — YALNIZCA kimlik listesi.
 *
 * Sayı DÖNDÜRMEZ: ürün yalnızca boolean bir nokta gösterir. Kullanıcının
 * KENDİ gönderdiği mesajlar okunmamış üretmez; süresi dolmuş mesajlar ve
 * artık arkadaş olunmayan kişiler listeye giremez.
 */
create or replace function public.list_friend_unread()
returns table (friend_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as actor
  )
  select distinct m.sender_id
  from public.friend_messages as m
  cross join me
  left join public.friend_message_reads as r
    on r.user_id = me.actor and r.friend_id = m.sender_id
  where me.actor is not null
    -- YALNIZCA karşı taraftan gelen mesajlar.
    and m.recipient_id = me.actor
    and m.sender_id <> me.actor
    -- Süresi dolmuş mesaj okunmamış SAYILMAZ.
    and m.expires_at > timezone('utc', now())
    -- Hâlâ kabul edilmiş arkadaşlık ve engel yok.
    and public.are_friends(me.actor, m.sender_id)
    and not public.has_block_between(me.actor, m.sender_id)
    -- Okuma anından YENİ olmalı.
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  limit 200;
$$;

revoke all on function public.list_friend_unread() from public;
revoke all on function public.list_friend_unread() from anon;
grant execute on function public.list_friend_unread() to authenticated;

-- ---------------------------------------------------------------------------
-- Konuşma listesi — `has_unread` eklenerek yeniden tanımlanır.
--
-- Dönüş tipi DEĞİŞTİĞİ için önce düşürülmelidir; mevcut alanların adı, sırası
-- ve anlamı AYNEN korunur, sonuna tek bir boolean eklenir.
-- ---------------------------------------------------------------------------

drop function if exists public.list_friend_conversations();

create or replace function public.list_friend_conversations()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  last_message_content text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  has_unread boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as actor
  ),
  accepted_friends as (
    select
      p.id as friend_id,
      p.display_name as friend_display_name,
      p.username as friend_username,
      p.avatar_url as friend_avatar_url
    from public.friendships as f
    cross join me
    join public.profiles as p
      on p.id = case
                  when f.requester_id = me.actor then f.receiver_id
                  else f.requester_id
                end
    where me.actor is not null
      and f.status = 'accepted'
      and me.actor in (f.requester_id, f.receiver_id)
  )
  select
    fr.friend_id,
    fr.friend_display_name,
    fr.friend_username,
    fr.friend_avatar_url,
    last_message.content,
    last_message.created_at,
    last_message.sender_id,
    coalesce(unread.has_unread, false)
  from accepted_friends as fr
  cross join me
  left join lateral (
    select m.content, m.created_at, m.sender_id
    from public.friend_messages as m
    where m.expires_at > timezone('utc', now())
      and (
        (m.sender_id = me.actor and m.recipient_id = fr.friend_id)
        or (m.sender_id = fr.friend_id and m.recipient_id = me.actor)
      )
    order by m.created_at desc, m.id desc
    limit 1
  ) as last_message on true
  /*
   * OKUNMAMIŞ — yalnızca boolean.
   *
   * Kullanıcının kendi gönderdiği mesajlar hariç tutulur; süresi dolmuş
   * mesajlar sayılmaz; okuma satırı yoksa gelen her mesaj okunmamıştır.
   */
  left join lateral (
    select true as has_unread
    from public.friend_messages as m
    left join public.friend_message_reads as r
      on r.user_id = me.actor and r.friend_id = fr.friend_id
    where m.sender_id = fr.friend_id
      and m.recipient_id = me.actor
      and m.expires_at > timezone('utc', now())
      and (r.last_read_at is null or m.created_at > r.last_read_at)
    limit 1
  ) as unread on true
  order by
    last_message.created_at desc nulls last,
    fr.friend_display_name asc,
    fr.friend_id asc
  limit 100;
$$;

revoke all on function public.list_friend_conversations() from public;
revoke all on function public.list_friend_conversations() from anon;
grant execute on function public.list_friend_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- Engelleme temizliği — mevcut RPC'ye GÜVENLE eklenir.
--
-- `block_user` zaten çiftin arkadaşlığını ve mesajlarını siliyor; okuma
-- satırı da o çifte aittir ve engelden sonra hiçbir anlamı kalmaz. Silinmesi
-- güvenlidir: `has_unread` zaten `are_friends` koşuluna bağlı olduğu için
-- satır kalsa da okunmamış üretmezdi, ama artık işe yaramayan satır da
-- bırakılmaz. Fonksiyonun geri kalanı BİREBİR korunur.
-- ---------------------------------------------------------------------------

create or replace function public.block_user(target_user_id uuid)
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

  if target_user_id is null or target_user_id = actor then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles as p where p.id = target_user_id) then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;

  -- Çifte özel kilit: eşzamanlı block/request/accept çağrıları sıraya alınır.
  perform public.lock_user_pair(actor, target_user_id);

  insert into public.user_blocks (blocker_id, blocked_id)
  values (actor, target_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Yalnızca BU İKİ kullanıcı arasındaki ilişki silinir.
  delete from public.friendships as f
  where (f.requester_id = actor and f.receiver_id = target_user_id)
     or (f.requester_id = target_user_id and f.receiver_id = actor);

  -- Yalnızca BU İKİ kullanıcı arasındaki mesajlar silinir; 24 saatlik cron
  -- beklenmez. Şikâyet kayıtları `on delete set null` sayesinde korunur.
  delete from public.friend_messages as m
  where (m.sender_id = actor and m.recipient_id = target_user_id)
     or (m.sender_id = target_user_id and m.recipient_id = actor);

  -- YENİ: çifte ait okuma satırları da temizlenir (iki yön).
  delete from public.friend_message_reads as r
  where (r.user_id = actor and r.friend_id = target_user_id)
     or (r.user_id = target_user_id and r.friend_id = actor);
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.block_user(uuid) from anon;
grant execute on function public.block_user(uuid) to authenticated;

commit;
