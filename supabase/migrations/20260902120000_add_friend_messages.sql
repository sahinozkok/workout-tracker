-- Arkadaşlar arası metin mesajlaşması — Faz 1 (yalnızca veri katmanı).
--
-- Güvenlik modeli:
--   * `friend_messages` üzerinde RLS açıktır.
--   * `anon` HİÇBİR yetki almaz. `authenticated` yalnızca SELECT alır ve o da
--     RLS ile sınırlıdır: istemci doğrudan INSERT/UPDATE/DELETE YAPAMAZ.
--   * Bütün yazma işlemleri dar amaçlı, doğrulanmış SECURITY DEFINER RPC'den
--     geçer; `sender_id` yalnızca `auth.uid()` üzerinden belirlenir.
--   * Okuma yalnızca konuşmanın iki tarafına ve YALNIZCA hâlâ kabul edilmiş
--     arkadaşken açıktır; mevcut `public.are_friends` yardımcısı yeniden
--     kullanılır, yeni bir arkadaşlık kontrolü YAZILMAZ.
--   * Hiçbir fonksiyon e-posta, auth metadata, token, özel profil alanı,
--     workout, rank, ödül veya disiplin verisi döndürmez.
--   * Mevcut tabloların, politikaların ve `list_friends` davranışının hiçbiri
--     DEĞİŞTİRİLMEZ.
--
-- 24 SAATLİK ÖMÜR:
--   * Her mesaj `created_at + 24 saat` sonunda ERİŞİLEMEZ olur. Bu sınır
--     fiziksel silmeye DEĞİL, RLS ve RPC filtrelerine bağlıdır; kullanıcı
--     açısından mesaj tam 24 saatte kaybolur.
--   * Fiziksel temizlik saatlik bir cron işidir; bu yüzden satır en fazla ~1
--     saat geç silinebilir, ama o sürede de hiçbir yoldan okunamaz.
--   * Süre kontrolleri YALNIZCA sunucu zamanıyla yapılır; istemci saati
--     hiçbir yerde güvenilmez.
--
-- YENİDEN ÇALIŞTIRILABİLİRLİK: bu migration baştan sona idempotenttir —
-- `if not exists` ile tablo/indeks, `drop ... if exists` + `create` ile
-- politika ve trigger, `create or replace` ile fonksiyonlar, üyelik kontrollü
-- publication ve ada göre yeniden kurulan tek cron işi. İkinci kez
-- çalıştırıldığında hata vermez ve kopya nesne oluşturmaz.

begin;

-- ---------------------------------------------------------------------------
-- Tablo
-- ---------------------------------------------------------------------------

create table if not exists public.friend_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  client_message_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  -- Ömür SUNUCU zamanından türer; istemci bu alanı gönderemez (INSERT yetkisi
  -- yoktur) ve RPC de değer YAZMAZ — varsayılan kullanılır.
  expires_at timestamptz not null default (timezone('utc', now()) + interval '24 hours'),
  -- Kullanıcı kendisine mesaj gönderemez.
  constraint friend_messages_no_self_check check (sender_id <> recipient_id),
  -- Boş/yalnızca boşluk mesaj ve 2000 karakter üstü reddedilir.
  constraint friend_messages_content_length_check
    check (char_length(btrim(content)) between 1 and 2000),
  -- Ömür HER ZAMAN tam 24 saattir. Sahte bir `expires_at` yazılamaz: RPC
  -- değer vermese de, verse de bu kısıt onu reddeder.
  constraint friend_messages_expiry_check
    check (expires_at = created_at + interval '24 hours')
);

-- IDEMPOTENCY: aynı göndericinin aynı `client_message_id` değeri ikinci satır
-- oluşturamaz. Retry ve eşzamanlı retry bu indekse dayanır.
create unique index if not exists friend_messages_sender_client_idx
on public.friend_messages (sender_id, client_message_id);

-- Konuşma sayfalaması: kullanıcı ÇİFTİ + cursor sırası (created_at, id).
create index if not exists friend_messages_pair_created_idx
on public.friend_messages (
  least(sender_id, recipient_id),
  greatest(sender_id, recipient_id),
  created_at desc,
  id desc
);

-- Dakikalık spam sayımı bu indeksten okunur.
create index if not exists friend_messages_sender_created_idx
on public.friend_messages (sender_id, created_at desc);

-- Saatlik temizlik bu indeksten tarar.
create index if not exists friend_messages_expires_idx
on public.friend_messages (expires_at);

alter table public.friend_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Tablo yetkileri — Supabase'in varsayılan geniş grant'lerine güvenilmez.
-- `anon` hiçbir şey yapamaz; `authenticated` YALNIZCA SELECT alır.
-- `service_role` grant'lerine dokunulmaz.
-- ---------------------------------------------------------------------------

revoke all on table public.friend_messages from anon;
revoke all on table public.friend_messages from authenticated;
grant select on table public.friend_messages to authenticated;

-- ---------------------------------------------------------------------------
-- APPEND-ONLY: bu fazda düzenleme YOKTUR.
--
-- İstemcinin zaten UPDATE yetkisi yok; bu trigger tanımlayıcı (definer) bir
-- yoldan bile içerik değiştirilmesini yapısal olarak engeller. DELETE
-- engellenmez: hesap silmenin cascade'i ve saatlik temizlik buna bağlıdır.
-- ---------------------------------------------------------------------------

create or replace function public.friend_messages_block_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'friend_messages_append_only' using errcode = '42501';
end;
$$;

drop trigger if exists friend_messages_no_update on public.friend_messages;
create trigger friend_messages_no_update
before update on public.friend_messages
for each row execute function public.friend_messages_block_update();

-- ---------------------------------------------------------------------------
-- RLS — yalnızca SELECT. Yazma işlemleri RPC'den yapılır.
--
-- Üç koşul birlikte sağlanmalıdır:
--   1. Okuyan, mesajın göndericisi veya alıcısıdır.
--   2. Mesajın süresi DOLMAMIŞTIR (sunucu zamanı).
--   3. Gönderici ile alıcı HÂLÂ kabul edilmiş arkadaştır.
--
-- (3) sayesinde arkadaşlık kaldırıldığında geçmiş fiziksel olarak silinmese
-- de iki taraf da okuyamaz; yeniden arkadaş olurlarsa (henüz süresi dolmamış)
-- geçmiş yeniden görünür. Üçüncü bir kullanıcı hiçbir satırı göremez, bu
-- yüzden başka iki kişinin mesajlaştığını da öğrenemez.
-- ---------------------------------------------------------------------------

drop policy if exists "friend_messages_select_involved_friends" on public.friend_messages;
create policy "friend_messages_select_involved_friends"
on public.friend_messages for select
to authenticated
using (
  (select auth.uid()) in (sender_id, recipient_id)
  and expires_at > timezone('utc', now())
  and public.are_friends(sender_id, recipient_id)
);

-- ---------------------------------------------------------------------------
-- Gönderme RPC'si
--
-- `returns setof public.friend_messages`: bu tablonun BÜTÜN sütunları
-- bilinçli olarak güvenli gösterim alanlarıdır (id, taraflar, içerik, istemci
-- kimliği, oluşturulma ve sona erme zamanı). Tabloya ileride özel bir sütun
-- eklenecek olursa bu dönüş tipi açık bir sütun listesine çevrilmelidir.
-- ---------------------------------------------------------------------------

create or replace function public.send_friend_message(
  target_user_id uuid,
  message_content text,
  client_message_id uuid
)
returns setof public.friend_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  trimmed text;
  existing public.friend_messages;
  inserted public.friend_messages;
  recent_count integer;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Kendine mesaj yasak; hedef zorunlu.
  if target_user_id is null or target_user_id = actor then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if send_friend_message.client_message_id is null then
    raise exception 'invalid_client_message_id' using errcode = '22023';
  end if;

  -- Hedef mevcut VE kabul edilmiş arkadaş olmalı. Bekleyen istek yetmez.
  if not public.are_friends(actor, target_user_id) then
    raise exception 'not_friends' using errcode = '42501';
  end if;

  trimmed := btrim(coalesce(message_content, ''));
  if char_length(trimmed) < 1 or char_length(trimmed) > 2000 then
    raise exception 'invalid_content' using errcode = '22023';
  end if;

  -- IDEMPOTENCY (hızlı yol): retry yeni satır üretmez, mevcut satırı döner.
  -- Mesajın ömrü YENİDEN BAŞLAMAZ; ilk satırın `expires_at` değeri korunur.
  select * into existing
  from public.friend_messages as m
  where m.sender_id = actor
    and m.client_message_id = send_friend_message.client_message_id
  limit 1;

  if found then
    -- GERÇEK retry mi? Aynı istemci anahtarı YALNIZCA aynı alıcıya ve aynı
    -- normalize edilmiş içeriğe aitse retry sayılır. Farklı alıcı veya farklı
    -- içerik SESSİZCE kabul edilmez: aksi hâlde istemci aynı anahtarla ikinci
    -- bir mesaj yazdığını sanır, sunucu ise ilkini geri döndürürdü.
    if existing.recipient_id is distinct from target_user_id
      or btrim(existing.content) is distinct from trimmed then
      raise exception 'client_message_id_conflict' using errcode = '22023';
    end if;
    return next existing;
    return;
  end if;

  -- Kullanıcıya ÖZEL transaction advisory lock: sayım ile ekleme arasına aynı
  -- kullanıcının ikinci çağrısı giremez, böylece dakikalık sınır eşzamanlı
  -- isteklerle aşılamaz. Başka kullanıcılar beklemez; kilit transaction
  -- sonunda (commit veya rollback) kendiliğinden bırakılır.
  perform pg_advisory_xact_lock(
    hashtext('public.send_friend_message'),
    hashtext(actor::text)
  );

  -- Kilit alındıktan SONRA idempotency tekrar kontrol edilir: eşzamanlı iki
  -- retry'dan biri bu arada satırı yazmış olabilir. İkinci çağrı yeni mesaj
  -- SAYILMAZ ve rate limit'i tüketmez.
  select * into existing
  from public.friend_messages as m
  where m.sender_id = actor
    and m.client_message_id = send_friend_message.client_message_id
  limit 1;

  if found then
    -- Hızlı yoldaki AYNI uyuşmazlık kontrolü burada da uygulanır.
    if existing.recipient_id is distinct from target_user_id
      or btrim(existing.content) is distinct from trimmed then
      raise exception 'client_message_id_conflict' using errcode = '22023';
    end if;
    return next existing;
    return;
  end if;

  -- SPAM KORUMASI: kullanıcı başına dakikada en fazla 60 YENİ mesaj. Normal
  -- sohbeti engellemez; yalnızca otomatik akışları durdurur.
  select count(*) into recent_count
  from public.friend_messages as m
  where m.sender_id = actor
    and m.created_at >= timezone('utc', now()) - interval '1 minute';

  if recent_count >= 60 then
    -- Kararlı kod + kararlı metin: istemci bu ikisine göre dallanabilir.
    raise exception 'message_rate_limited' using errcode = '54000';
  end if;

  -- `created_at` ve `expires_at` BİLİNÇLİ olarak verilmez: ikisi de sunucu
  -- varsayılanından gelir ve kısıt tam 24 saati zorunlu kılar.
  begin
    insert into public.friend_messages (sender_id, recipient_id, content, client_message_id)
    values (actor, target_user_id, trimmed, send_friend_message.client_message_id)
    returning * into inserted;
  exception
    -- Kilide rağmen (ör. farklı bağlantı sırası) çakışma olursa hata
    -- kullanıcıya dönmez; mevcut satır okunup döndürülür.
    when unique_violation then
      select * into inserted
      from public.friend_messages as m
      where m.sender_id = actor
        and m.client_message_id = send_friend_message.client_message_id
      limit 1;

      -- Satır bulunamadıysa çakışma BAŞKA bir kısıttan gelmiştir. Boş/null
      -- satır döndürmek hatayı gizlerdi: özgün hata yeniden fırlatılır.
      if not found then
        raise;
      end if;

      -- Telafi yolunda da AYNI uyuşmazlık kontrolü uygulanır; farklı içerik
      -- bu yoldan sessizce kabul edilemez.
      if inserted.recipient_id is distinct from target_user_id
        or btrim(inserted.content) is distinct from trimmed then
        raise exception 'client_message_id_conflict' using errcode = '22023';
      end if;
  end;

  return next inserted;
end;
$$;

revoke all on function public.send_friend_message(uuid, text, uuid) from public;
grant execute on function public.send_friend_message(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Mesaj geçmişi — cursor (keyset) sayfalama.
--
-- OFFSET KULLANILMAZ: yeni mesaj geldiğinde offset sayfaları kayar ve satır
-- atlanır/çoğaltılır. Sıra (created_at desc, id desc) ikilisidir; aynı
-- zaman damgasına sahip mesajlarda `id` kararlı ayraçtır.
--
-- CURSOR ATOMİKTİR: iki parça ya birlikte doludur ya da birlikte null'dır.
-- Yalnızca zaman damgası taşıyan bir cursor kabul edilseydi aynı ana yazılmış
-- mesajların kalanı SESSİZCE ATLANIRDI; bu yüzden o yol tamamen kaldırılmış ve
-- yerine kontrollü bir hata konmuştur. Fonksiyon bu hatayı fırlatabilmek için
-- `plpgsql`dir (SQL fonksiyonları `raise` edemez).
-- ---------------------------------------------------------------------------

create or replace function public.get_friend_messages(
  target_user_id uuid,
  before_created_at timestamptz default null,
  before_id uuid default null,
  page_size integer default 30
)
returns table (
  id uuid,
  sender_id uuid,
  recipient_id uuid,
  content text,
  client_message_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Yarım cursor kabul EDİLMEZ: ya ilk sayfa (ikisi de null) ya da tam keyset.
  if (before_created_at is null) <> (before_id is null) then
    raise exception 'invalid_cursor' using errcode = '22023';
  end if;

  return query
  select
    m.id,
    m.sender_id,
    m.recipient_id,
    m.content,
    m.client_message_id,
    m.created_at,
    m.expires_at
  from public.friend_messages as m
  where (select auth.uid()) is not null
    and target_user_id is not null
    and target_user_id <> (select auth.uid())
    -- Arkadaşlık kaldırıldıysa sonuç BOŞ döner; ayrı bir sızıntı yolu yoktur.
    and public.are_friends((select auth.uid()), target_user_id)
    -- Süresi dolmuş mesaj HİÇBİR koşulda dönmez (sunucu zamanı).
    and m.expires_at > timezone('utc', now())
    -- Yalnızca bu iki kullanıcının konuşması.
    and (
      (m.sender_id = (select auth.uid()) and m.recipient_id = target_user_id)
      or (m.sender_id = target_user_id and m.recipient_id = (select auth.uid()))
    )
    -- Keyset: (created_at, id) ikilisi sözlük sırasında cursor'dan küçük.
    -- Zaman damgası tek başına KULLANILMAZ.
    and (
      before_created_at is null
      or (m.created_at, m.id) < (before_created_at, before_id)
    )
  order by m.created_at desc, m.id desc
  -- Sayfa boyutu 1–50 arasına sıkıştırılır; istemci daha büyüğünü isteyemez.
  limit least(greatest(coalesce(page_size, 30), 1), 50);
end;
$$;

revoke all on function public.get_friend_messages(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.get_friend_messages(uuid, timestamptz, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Konuşma listesi — yalnızca kabul edilmiş arkadaşlar.
--
-- Bekleyen istekler ve arkadaş olmayanlar YOKTUR. E-posta, bio, banner,
-- hedef, workout/rank/ödül alanı dönmez. Mesajı olmayan arkadaş listede
-- kalır; son mesaj önizlemesi boş olur. Süresi dolmuş mesaj son mesaj olarak
-- GÖRÜNMEZ.
--
-- `list_friends()` davranışı değişmez; bu ayrı ve daha dar bir listedir.
-- ---------------------------------------------------------------------------

create or replace function public.list_friend_conversations()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  last_message_content text,
  last_message_at timestamptz,
  last_message_sender_id uuid
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
    last_message.sender_id
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
  -- Mesajı olanlar en yeni önce; mesajı olmayanlar deterministik sırada.
  order by
    last_message.created_at desc nulls last,
    fr.friend_display_name asc,
    fr.friend_id asc
  limit 100;
$$;

revoke all on function public.list_friend_conversations() from public;
grant execute on function public.list_friend_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime hazırlığı — Faz 2 için publication üyeliği.
--
-- İDEMPOTENT: üyelik önceden varsa `alter publication` HİÇ çalıştırılmaz, bu
-- yüzden "already member of publication" hatası oluşmaz. Bu fazda istemci
-- subscription kodu YAZILMAZ.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friend_messages'
  ) then
    alter publication supabase_realtime add table public.friend_messages;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fiziksel temizlik — saatlik cron.
--
-- Kullanıcı açısından mesaj tam 24 saatte kaybolur (RLS + RPC filtreleri);
-- bu iş yalnızca DİSKİ temizler ve satır en fazla ~1 saat geç silinebilir.
--
-- İDEMPOTENT: iş ADA göre önce kaldırılır, sonra yeniden kurulur. Migration
-- ikinci kez çalıştığında aynı adlı ikinci görev OLUŞMAZ.
--
-- Komut YALNIZCA `public.friend_messages` tablosundan siler. Başka tabloya
-- dokunmaz ve `VACUUM FULL` çalıştırmaz.
-- ---------------------------------------------------------------------------

do $$
declare
  cleanup_command constant text :=
    'delete from public.friend_messages where expires_at <= timezone(''utc'', now());';
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
      execute 'create extension if not exists pg_cron';
    else
      -- pg_cron olmayan ortamda migration DURMAZ: erişim sınırı zaten RLS ve
      -- RPC filtreleriyle sağlanır, yalnızca fiziksel temizlik ertelenir.
      raise notice 'pg_cron yok: cleanup-expired-friend-messages kurulmadı.';
      return;
    end if;
  end if;

  execute $cmd$
    select cron.unschedule(jobid)
    from cron.job
    where jobname = 'cleanup-expired-friend-messages'
  $cmd$;

  execute format(
    'select cron.schedule(%L, %L, %L)',
    'cleanup-expired-friend-messages',
    '0 * * * *',
    cleanup_command
  );
end;
$$;

commit;
