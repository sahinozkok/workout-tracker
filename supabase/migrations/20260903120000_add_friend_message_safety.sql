-- Arkadaş mesajlaşması GÜVENLİK altyapısı: engelleme, şikâyet ve sunucu
-- taraflı içerik filtresi.
--
-- KAPSAM: yalnızca veritabanı. Bu migration hiçbir uygulama dosyasına,
-- servise, tipe veya çeviriye dokunmaz; engelleme/şikâyet ARAYÜZÜ sonraki
-- fazdadır.
--
-- Güvenlik modeli:
--   * Yeni tablolarda RLS açıktır. `anon` HİÇBİR yetki almaz.
--   * İstemci yeni tabloların hiçbirine doğrudan INSERT/UPDATE/DELETE YAPAMAZ;
--     bütün yazmalar dar amaçlı, doğrulanmış SECURITY DEFINER RPC'lerden geçer.
--   * Engelleme YÖNÜ hiçbir yoldan sızmaz: dışarıya açık kontrollerin tamamı
--     "iki yönden herhangi biri" sorusunu yanıtlar ve hata kodu yön
--     içermeyen `relationship_unavailable`dir.
--   * Hiçbir fonksiyon e-posta, auth metadata, token veya özel profil alanı
--     döndürmez.
--
-- UYGULANMIŞ MIGRATION'LAR DEĞİŞTİRİLMEZ: güncellenmesi gereken mevcut
-- RPC'ler burada `create or replace function` ile, İMZALARI ve DÖNÜŞ TİPLERİ
-- birebir korunarak yeniden tanımlanır.
--
-- YENİDEN ÇALIŞTIRILABİLİRLİK: baştan sona idempotenttir — `if not exists`
-- ile tablo/indeks, `drop ... if exists` + `create` ile politika,
-- `create or replace` ile fonksiyonlar, `on conflict do nothing` ile tohum
-- veri ve ada göre yeniden kurulan tek cron işi.

begin;

-- ---------------------------------------------------------------------------
-- Ortak yardımcı: KULLANICI ÇİFTİNE ÖZEL deterministik advisory lock.
--
-- Anahtar UUID SIRASINDAN türer (`least`/`greatest`), bu yüzden A→B ve B→A
-- çağrıları AYNI kilidi AYNI sırada alır: yön farkı ve deadlock oluşmaz.
-- Kilit transaction sonunda kendiliğinden bırakılır.
-- ---------------------------------------------------------------------------

create or replace function public.lock_user_pair(user_a uuid, user_b uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if user_a is null or user_b is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      least(user_a, user_b)::text || ':' || greatest(user_a, user_b)::text,
      9031
    )
  );
end;
$$;

revoke all on function public.lock_user_pair(uuid, uuid) from public;
revoke all on function public.lock_user_pair(uuid, uuid) from anon;
revoke all on function public.lock_user_pair(uuid, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 1 · Kullanıcı engelleme
-- ---------------------------------------------------------------------------

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (blocker_id, blocked_id),
  -- Kullanıcı kendisini engelleyemez.
  constraint user_blocks_no_self_check check (blocker_id <> blocked_id)
);

-- Birincil anahtar `blocker_id` yönünü zaten karşılar; ters yön sorgusu
-- (`beni kim engelledi`) yalnızca DAHİLİ yardımcı tarafından kullanılır.
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- `anon` hiçbir şey yapamaz. `authenticated` YALNIZCA SELECT alır ve RLS onu
-- kendi verdiği engellere sınırlar; yazmalar RPC'den geçer.
revoke all on table public.user_blocks from anon;
revoke all on table public.user_blocks from authenticated;
grant select on table public.user_blocks to authenticated;

-- Kullanıcı YALNIZCA kendi verdiği engelleri görür. Kendisini kimin
-- engellediğini bu yoldan ÖĞRENEMEZ.
drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own"
on public.user_blocks for select
to authenticated
using (blocker_id = (select auth.uid()));

/*
 * DAHİLİ engel kontrolü — YÖN SIZDIRMAZ.
 *
 * İki kullanıcı arasında HERHANGİ yönde engel var mı? Yanıt tek bir boolean'dır;
 * hangi tarafın engellediği asla dışarı verilmez.
 *
 * Bu fonksiyon `authenticated` tarafından DOĞRUDAN ÇAĞRILAMAZ: yalnızca
 * aşağıdaki SECURITY DEFINER RPC'ler kendi sahipleri adına kullanır. Aksi
 * hâlde bir kullanıcı iki yabancı hesabı sorgulayıp sosyal grafiği okuyabilirdi.
 */
create or replace function public.has_block_between(user_a uuid, user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_blocks as b
    where (b.blocker_id = user_a and b.blocked_id = user_b)
       or (b.blocker_id = user_b and b.blocked_id = user_a)
  );
$$;

revoke all on function public.has_block_between(uuid, uuid) from public;
revoke all on function public.has_block_between(uuid, uuid) from anon;
revoke all on function public.has_block_between(uuid, uuid) from authenticated;

/*
 * Engelleme.
 *
 * IDEMPOTENT: aynı hedef tekrar engellenirse yeni satır oluşmaz ve hata
 * dönmez. Engel oluştuğunda iki kullanıcı arasındaki arkadaşlık (pending veya
 * accepted) ve mesaj geçmişi ANINDA silinir — başka kullanıcıların kayıtlarına
 * DOKUNULMAZ.
 */
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
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.block_user(uuid) from anon;
grant execute on function public.block_user(uuid) to authenticated;

/*
 * Engeli kaldırma.
 *
 * YALNIZCA kendi verdiği engeli kaldırır ve eski arkadaşlığı GERİ GETİRMEZ:
 * taraflar isterlerse yeniden istek gönderir. Idempotenttir.
 */
create or replace function public.unblock_user(target_user_id uuid)
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

  perform public.lock_user_pair(actor, target_user_id);

  delete from public.user_blocks as b
  where b.blocker_id = actor
    and b.blocked_id = target_user_id;
end;
$$;

revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from anon;
grant execute on function public.unblock_user(uuid) to authenticated;

/*
 * Kullanıcının KENDİ engellediği hesaplar — güvenli profil özeti.
 *
 * Ters yön (beni kim engelledi) HİÇBİR koşulda dönmez.
 */
create or replace function public.list_blocked_users()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  created_at timestamptz
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
    p.avatar_url,
    b.created_at
  from public.user_blocks as b
  join public.profiles as p on p.id = b.blocked_id
  where (select auth.uid()) is not null
    and b.blocker_id = (select auth.uid())
  order by b.created_at desc
  limit 200;
$$;

revoke all on function public.list_blocked_users() from public;
revoke all on function public.list_blocked_users() from anon;
grant execute on function public.list_blocked_users() to authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Sunucu taraflı içerik filtresi
-- ---------------------------------------------------------------------------

/*
 * Metin normalizasyonu — büyük/küçük harf ve noktalama farklarını eşitler.
 *
 * Türkçe aksanlı harfler ASCII karşılığına indirilir, harf/rakam dışındaki her
 * şey tek boşluğa dönüşür. Böylece "Seni ÖLDÜRECEĞİM!!!" ile
 * "seni oldurecegim" aynı normalize metni üretir.
 */
create or replace function public.normalize_message_text(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(translate(coalesce(input, ''), 'ÇĞİıÖŞÜçğöşü', 'CGIiOSUcgosu')),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

revoke all on function public.normalize_message_text(text) from public;
revoke all on function public.normalize_message_text(text) from anon;
revoke all on function public.normalize_message_text(text) from authenticated;

/*
 * Engellenen ifadeler — YALNIZCA sistem/moderasyon tarafı yönetir.
 *
 * `anon` ve `authenticated` bu listeyi OKUYAMAZ ve DEĞİŞTİREMEZ; aksi hâlde
 * filtre tersine mühendislikle aşılabilirdi. Kontrol `send_friend_message`
 * içinde, INSERT'ten ÖNCE sunucuda yapılır ve istemcinin zaten doğrudan mesaj
 * INSERT yetkisi yoktur.
 */
create table if not exists public.message_blocked_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  constraint message_blocked_terms_term_length_check
    check (char_length(btrim(term)) between 2 and 120)
);

-- Aynı ifade normalize hâliyle iki kez eklenemez; tohum veri idempotenttir.
create unique index if not exists message_blocked_terms_normalized_idx
on public.message_blocked_terms (public.normalize_message_text(term));

create index if not exists message_blocked_terms_active_idx
on public.message_blocked_terms (is_active);

alter table public.message_blocked_terms enable row level security;

-- Hiçbir istemci rolüne yetki VERİLMEZ ve politika EKLENMEZ: RLS açıkken
-- politikasız tablo istemciye tamamen kapalıdır. `service_role` RLS'i baypas
-- ettiği için moderasyon tarafı listeyi yönetmeye devam eder.
revoke all on table public.message_blocked_terms from anon;
revoke all on table public.message_blocked_terms from authenticated;

/*
 * BAŞLANGIÇ LİSTESİ — bilinçli olarak KÜÇÜK ve MUHAFAZAKÂR.
 *
 * Yalnızca açıkça ağır tehdit/taciz niteliğindeki ÇOK KELİMELİ ifadeler
 * seçilmiştir. Tek kelimelik geniş terimler KULLANILMAZ: masum konuşmaları
 * engelleme riski ve yanlış pozitif oranı düşük tutulur. Eşleşme kelime
 * sınırındadır, bu yüzden bir ifadenin masum bir kelimenin İÇİNDE geçmesi
 * eşleşme üretmez.
 */
insert into public.message_blocked_terms (term)
values
  ('seni öldüreceğim'),
  ('seni gebertecegim'),
  ('geberteceğim seni'),
  ('kendini öldür'),
  ('gidip kendini öldür'),
  ('ölmeni istiyorum'),
  ('sana tecavüz edeceğim'),
  ('i will kill you'),
  ('kill yourself'),
  ('go kill yourself'),
  ('i hope you die'),
  ('i will rape you')
on conflict do nothing;

/*
 * İçerik reddedilmeli mi?
 *
 * Eşleşme NORMALİZE metin üzerinde KELİME/İFADE SINIRINDA aranır: aranan
 * ifade, boşluklarla çevrelenmiş biçimde metnin içinde geçmelidir. Bu yüzden
 * kısa bir parçanın masum bir kelimenin içinde bulunması eşleşme ÜRETMEZ.
 *
 * Dahilidir: istemci doğrudan çağıramaz.
 */
create or replace function public.message_contains_blocked_term(input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.message_blocked_terms as t
    where t.is_active
      and position(
            ' ' || public.normalize_message_text(t.term) || ' '
            in ' ' || public.normalize_message_text(input) || ' '
          ) > 0
  );
$$;

revoke all on function public.message_contains_blocked_term(text) from public;
revoke all on function public.message_contains_blocked_term(text) from anon;
revoke all on function public.message_contains_blocked_term(text) from authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Şikâyet kayıtları
-- ---------------------------------------------------------------------------

create table if not exists public.user_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  /*
   * Mesaj 24 saatlik temizlikte silinse bile RAPOR KAYBOLMAZ: bağ kopar,
   * satır ve aşağıdaki snapshot alanları kalır.
   */
  message_id uuid references public.friend_messages(id) on delete set null,
  category text not null,
  details text,
  /* Moderasyon kanıtı — mesaj silinse de korunur. */
  message_content_snapshot text,
  message_created_at timestamptz,
  status text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_content_reports_no_self_check check (reporter_id <> reported_user_id),
  constraint user_content_reports_category_check
    check (category in ('harassment', 'hate', 'sexual', 'violence', 'spam', 'other')),
  constraint user_content_reports_status_check
    check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  constraint user_content_reports_details_length_check
    check (details is null or char_length(btrim(details)) between 1 and 1000)
);

-- Aynı kullanıcı AYNI mesajı iki kez raporlayamaz.
create unique index if not exists user_content_reports_reporter_message_idx
on public.user_content_reports (reporter_id, message_id)
where message_id is not null;

-- Günlük sınır sayımı ve moderasyon listeleri bu indekslerden okur.
create index if not exists user_content_reports_reporter_created_idx
on public.user_content_reports (reporter_id, created_at desc);

create index if not exists user_content_reports_reported_idx
on public.user_content_reports (reported_user_id);

create index if not exists user_content_reports_status_created_idx
on public.user_content_reports (status, created_at);

alter table public.user_content_reports enable row level security;

-- İstemciye HİÇBİR yetki verilmez ve politika eklenmez: rapor içeriklerini
-- normal kullanıcılar okuyamaz, yazamaz, güncelleyemez, silemez.
-- `service_role` RLS'i baypas ettiği için moderasyon tarafı korunur.
revoke all on table public.user_content_reports from anon;
revoke all on table public.user_content_reports from authenticated;

/*
 * Günlük şikâyet sınırı — kullanıcı başına en fazla 10 YENİ rapor.
 *
 * Kullanıcıya özel transaction advisory lock, sayım ile ekleme arasına ikinci
 * çağrının girmesini engeller: eşzamanlı isteklerle sınır AŞILAMAZ.
 */
create or replace function public.assert_report_quota(actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.user_content_reports'), hashtext(actor::text));

  select count(*) into recent_count
  from public.user_content_reports as r
  where r.reporter_id = actor
    and r.created_at >= timezone('utc', now()) - interval '1 day';

  if recent_count >= 10 then
    raise exception 'report_rate_limited' using errcode = '54000';
  end if;
end;
$$;

revoke all on function public.assert_report_quota(uuid) from public;
revoke all on function public.assert_report_quota(uuid) from anon;
revoke all on function public.assert_report_quota(uuid) from authenticated;

/*
 * MESAJ şikâyeti.
 *
 * `reported_user_id` SUNUCUDA belirlenir: raporlayan mesajın göndereni ise
 * alıcı, alıcısı ise gönderendir. İstemci bu kimliği seçemez ve sahteleyemez.
 */
create or replace function public.report_friend_message(
  message_id uuid,
  category text,
  details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.friend_messages;
  reported uuid;
  trimmed_details text;
  report_id uuid;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if report_friend_message.message_id is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if category not in ('harassment', 'hate', 'sexual', 'violence', 'spam', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  trimmed_details := nullif(btrim(coalesce(details, '')), '');
  if trimmed_details is not null and char_length(trimmed_details) > 1000 then
    raise exception 'invalid_details' using errcode = '22023';
  end if;

  select * into target
  from public.friend_messages as m
  where m.id = report_friend_message.message_id
    and m.expires_at > timezone('utc', now())
  limit 1
  for share;

  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;

  /*
   * Yalnızca ALICI kendisine gönderilen içeriği raporlayabilir. Gönderenin
   * kendi yazdığı metni alıcıya ait bir kanıtmış gibi raporlamasına ve
   * üçüncü kişinin mesaj kimliğiyle rapor oluşturmasına izin verilmez.
   * Her iki yol aynı hata kodunu kullanır.
   */
  if target.recipient_id <> actor then
    raise exception 'message_not_reportable' using errcode = '42501';
  end if;

  reported := target.sender_id;

  -- Aynı mesajın tekrar raporu YENİ SATIR ÜRETMEZ ve kotayı tüketmez.
  select r.id into report_id
  from public.user_content_reports as r
  where r.reporter_id = actor
    and r.message_id = report_friend_message.message_id
  limit 1;

  if found then
    return report_id;
  end if;

  /*
   * Kota ile INSERT aynı kullanıcı kilidinin altındadır. Kilitten SONRA
   * idempotency tekrar kontrol edilir: 9 eski raporu olan kullanıcının aynı
   * mesaj için iki eşzamanlı çağrısından ikincisi, ilk çağrı 10.
   * satırı yazdıktan sonra rate-limit hatası almak yerine mevcut kimliği
   * döndürür.
   */
  perform pg_advisory_xact_lock(
    hashtext('public.user_content_reports'),
    hashtext(actor::text)
  );

  select r.id into report_id
  from public.user_content_reports as r
  where r.reporter_id = actor
    and r.message_id = report_friend_message.message_id
  limit 1;

  if found then
    return report_id;
  end if;

  perform public.assert_report_quota(actor);

  begin
    insert into public.user_content_reports (
      reporter_id,
      reported_user_id,
      message_id,
      category,
      details,
      -- SNAPSHOT: 24 saatlik temizlik moderasyon kanıtını yok etmez.
      message_content_snapshot,
      message_created_at
    )
    values (
      actor,
      reported,
      report_friend_message.message_id,
      category,
      trimmed_details,
      target.content,
      target.created_at
    )
    returning id into report_id;
  exception
    -- Eşzamanlı ikinci rapor unique indekse takılırsa mevcut kayıt döner.
    when unique_violation then
      select r.id into report_id
      from public.user_content_reports as r
      where r.reporter_id = actor
        and r.message_id = report_friend_message.message_id
      limit 1;

      if not found then
        raise;
      end if;
  end;

  return report_id;
end;
$$;

revoke all on function public.report_friend_message(uuid, text, text) from public;
revoke all on function public.report_friend_message(uuid, text, text) from anon;
grant execute on function public.report_friend_message(uuid, text, text) to authenticated;

/*
 * KULLANICI şikâyeti.
 *
 * Arkadaş olma şartı YOKTUR: kullanıcı, engellemeden önce veya arama üzerinden
 * gördüğü bir hesabı raporlayabilir. Raporlama ve engelleme BİRBİRİNDEN
 * BAĞIMSIZ işlemlerdir.
 */
create or replace function public.report_user(
  target_user_id uuid,
  category text,
  details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  trimmed_details text;
  report_id uuid;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = actor then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if category not in ('harassment', 'hate', 'sexual', 'violence', 'spam', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  trimmed_details := nullif(btrim(coalesce(details, '')), '');
  if trimmed_details is not null and char_length(trimmed_details) > 1000 then
    raise exception 'invalid_details' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles as p where p.id = target_user_id) then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;

  perform public.assert_report_quota(actor);

  insert into public.user_content_reports (reporter_id, reported_user_id, category, details)
  values (actor, target_user_id, category, trimmed_details)
  returning id into report_id;

  return report_id;
end;
$$;

revoke all on function public.report_user(uuid, text, text) from public;
revoke all on function public.report_user(uuid, text, text) from anon;
grant execute on function public.report_user(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Mevcut RPC'lerin engelleme korumasıyla yeniden tanımlanması
--
-- İMZALAR ve DÖNÜŞ TİPLERİ BİREBİR KORUNUR. Yalnızca engel kontrolü ve
-- (mesajda) içerik filtresi eklenir; mevcut idempotency, advisory lock,
-- 60/dakika sınırı, 24 saatlik expiry ve retry davranışı AYNEN kalır.
-- ---------------------------------------------------------------------------

-- Engelli taraf arama sonuçlarında GÖRÜNMEZ (iki yönden herhangi biri).
create or replace function public.search_profiles(search_query text)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  friendship_id uuid,
  friendship_status text,
  friendship_direction text
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
    p.avatar_url,
    f.id as friendship_id,
    f.status as friendship_status,
    case
      when f.id is null then null
      when f.requester_id = (select auth.uid()) then 'outgoing'
      else 'incoming'
    end as friendship_direction
  from public.profiles as p
  left join public.friendships as f
    on (f.requester_id = (select auth.uid()) and f.receiver_id = p.id)
    or (f.receiver_id = (select auth.uid()) and f.requester_id = p.id)
  where (select auth.uid()) is not null
    and p.id <> (select auth.uid())
    and p.username is not null
    and char_length(btrim(coalesce(search_query, ''))) between 2 and 64
    and (
      strpos(lower(p.username), lower(btrim(search_query))) > 0
      or strpos(lower(p.display_name), lower(btrim(search_query))) > 0
    )
    -- ENGEL: iki yönden herhangi biri sonucu gizler; yön sızmaz.
    and not public.has_block_between((select auth.uid()), p.id)
  order by
    (lower(p.username) = lower(btrim(search_query))) desc,
    p.username asc
  limit 20;
$$;

revoke all on function public.search_profiles(text) from public;
grant execute on function public.search_profiles(text) to authenticated;

-- Engelli taraflar birbirine arkadaşlık isteği GÖNDEREMEZ.
create or replace function public.send_friend_request(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  existing public.friendships;
  new_id uuid;
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

  -- Çifte özel kilit: eşzamanlı block/request yarışında sıralama sağlar.
  perform public.lock_user_pair(actor, target_user_id);

  -- ENGEL: yön AÇIKLANMAZ. Aynı kod iki yön için de döner.
  if public.has_block_between(actor, target_user_id) then
    raise exception 'relationship_unavailable' using errcode = '42501';
  end if;

  select * into existing
  from public.friendships as f
  where (f.requester_id = actor and f.receiver_id = target_user_id)
     or (f.requester_id = target_user_id and f.receiver_id = actor)
  limit 1;

  if found then
    return existing.id;
  end if;

  begin
    insert into public.friendships (requester_id, receiver_id, status)
    values (actor, target_user_id, 'pending')
    returning id into new_id;
  exception
    when unique_violation then
      select f.id into new_id
      from public.friendships as f
      where (f.requester_id = actor and f.receiver_id = target_user_id)
         or (f.requester_id = target_user_id and f.receiver_id = actor)
      limit 1;
  end;

  return new_id;
end;
$$;

revoke all on function public.send_friend_request(uuid) from public;
grant execute on function public.send_friend_request(uuid) to authenticated;

/*
 * İsteğe yanıt.
 *
 * Kabul ile engelleme arasında yarış olsa bile ENGELLİ ilişki `accepted` hâle
 * GELEMEZ: satır kilitlendikten ve çift kilidi alındıktan sonra engel yeniden
 * kontrol edilir.
 */
create or replace function public.respond_to_friend_request(
  friendship_id uuid,
  accept boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  row_found public.friendships;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  /*
   * İlk okuma yalnızca çift kimliğini ve temel yetkiyi bulur; satır henüz
   * kilitlenmez. Bütün ilgili işlemler aynı kilit sırasını izler:
   * kullanıcı-çifti advisory lock -> friendship satır kilidi.
   */
  select * into row_found
  from public.friendships as f
  where f.id = friendship_id
  limit 1;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  if row_found.receiver_id <> actor then
    raise exception 'not_receiver' using errcode = '42501';
  end if;

  perform public.lock_user_pair(row_found.requester_id, row_found.receiver_id);

  /*
   * Pair lock alındıktan SONRA satır yeniden okunur ve kilitlenir. İlk
   * okuma ile bu nokta arasında iptal/silme/yanıt olmuş olabilir.
   */
  select * into row_found
  from public.friendships as f
  where f.id = friendship_id
  limit 1
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  if row_found.receiver_id <> actor then
    raise exception 'not_receiver' using errcode = '42501';
  end if;

  if row_found.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = '22023';
  end if;

  if public.has_block_between(row_found.requester_id, row_found.receiver_id) then
    raise exception 'relationship_unavailable' using errcode = '42501';
  end if;

  if accept then
    update public.friendships
    set status = 'accepted'
    where id = friendship_id;
  else
    delete from public.friendships where id = friendship_id;
  end if;
end;
$$;

revoke all on function public.respond_to_friend_request(uuid, boolean) from public;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

/*
 * Arkadaş profili — GÜNCEL dönüş tipi (seviye + renk ön ayarı) BİREBİR korunur.
 *
 * Engelli taraf hiçbir satır göremez. `block_user` arkadaşlığı zaten sildiği
 * için `are_friends` de yanlış döner; bu ikinci katmandır.
 */
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
  xp_for_next integer,
  color_preset text
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
    coalesce(lp.xp_for_next, public.level_step_cost(1)),
    p.color_preset
  from public.profiles as p
  left join public.user_progress as up on up.user_id = p.id
  left join lateral public.level_progress(coalesce(up.lifetime_xp, 0)) as lp on true
  where (select auth.uid()) is not null
    and p.id = target_user_id
    and public.are_friends((select auth.uid()), target_user_id)
    and not public.has_block_between((select auth.uid()), target_user_id);
$$;

revoke all on function public.get_friend_profile(uuid) from public;
revoke all on function public.get_friend_profile(uuid) from anon;
grant execute on function public.get_friend_profile(uuid) to authenticated;

/*
 * Mesaj gönderme — engel kontrolü ve içerik filtresi EKLENİR.
 *
 * KORUNAN DAVRANIŞLAR (birebir): imza ve `setof public.friend_messages` dönüşü,
 * üç yollu idempotency ve içerik/alıcı uyuşmazlığı kontrolü, kullanıcıya özel
 * advisory lock, dakikada 60 yeni mesaj sınırı, 24 saatlik expiry (zaman
 * sütunları yine YAZILMAZ) ve `unique_violation` telafi yolu.
 *
 * SIRALAMA BİLİNÇLİDİR: içerik filtresi idempotency hızlı yolundan SONRA
 * çalışır. Böylece daha önce başarıyla kaydedilmiş bir mesajın GERÇEK retry'ı,
 * listeye sonradan eklenen bir ifade yüzünden farklı bir mesajmış gibi
 * reddedilmez.
 */
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

  trimmed := btrim(coalesce(message_content, ''));
  if char_length(trimmed) < 1 or char_length(trimmed) > 2000 then
    raise exception 'invalid_content' using errcode = '22023';
  end if;

  /*
   * Block/request/accept/send aynı kilit sırasını kullanır. Bu kilit
   * relationship kontrollerinden INSERT tamamlanana kadar transaction boyunca
   * tutulur; `block_user` mesajları sildikten sonra eski bir send çağrısı
   * yeniden satır yazamaz.
   */
  perform public.lock_user_pair(actor, target_user_id);

  -- Hedef mevcut VE kabul edilmiş arkadaş olmalı. Bekleyen istek yetmez.
  if not public.are_friends(actor, target_user_id) then
    raise exception 'not_friends' using errcode = '42501';
  end if;

  -- ENGEL: yön AÇIKLANMAZ; iki yön için de aynı kod döner.
  if public.has_block_between(actor, target_user_id) then
    raise exception 'relationship_unavailable' using errcode = '42501';
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
    -- normalize edilmiş içeriğe aitse retry sayılır.
    if existing.recipient_id is distinct from target_user_id
      or btrim(existing.content) is distinct from trimmed then
      raise exception 'client_message_id_conflict' using errcode = '22023';
    end if;
    return next existing;
    return;
  end if;

  -- İÇERİK FİLTRESİ — yalnızca GERÇEKTEN YENİ mesajlarda, INSERT'ten önce.
  if public.message_contains_blocked_term(trimmed) then
    raise exception 'message_rejected_content' using errcode = '22023';
  end if;

  -- Kullanıcıya ÖZEL transaction advisory lock: sayım ile ekleme arasına aynı
  -- kullanıcının ikinci çağrısı giremez, böylece dakikalık sınır eşzamanlı
  -- isteklerle aşılamaz.
  perform pg_advisory_xact_lock(
    hashtext('public.send_friend_message'),
    hashtext(actor::text)
  );

  -- Kilit alındıktan SONRA idempotency tekrar kontrol edilir.
  select * into existing
  from public.friend_messages as m
  where m.sender_id = actor
    and m.client_message_id = send_friend_message.client_message_id
  limit 1;

  if found then
    if existing.recipient_id is distinct from target_user_id
      or btrim(existing.content) is distinct from trimmed then
      raise exception 'client_message_id_conflict' using errcode = '22023';
    end if;
    return next existing;
    return;
  end if;

  -- SPAM KORUMASI: kullanıcı başına dakikada en fazla 60 YENİ mesaj.
  select count(*) into recent_count
  from public.friend_messages as m
  where m.sender_id = actor
    and m.created_at >= timezone('utc', now()) - interval '1 minute';

  if recent_count >= 60 then
    raise exception 'message_rate_limited' using errcode = '54000';
  end if;

  -- `created_at` ve `expires_at` BİLİNÇLİ olarak verilmez.
  begin
    insert into public.friend_messages (sender_id, recipient_id, content, client_message_id)
    values (actor, target_user_id, trimmed, send_friend_message.client_message_id)
    returning * into inserted;
  exception
    when unique_violation then
      select * into inserted
      from public.friend_messages as m
      where m.sender_id = actor
        and m.client_message_id = send_friend_message.client_message_id
      limit 1;

      if not found then
        raise;
      end if;

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
-- 5 · Saklama süresi — sonuçlandırılmış raporlar için günlük temizlik
--
-- `pending` raporlar KORUNUR. Mevcut `cleanup-expired-friend-messages` işine
-- DOKUNULMAZ; bu ayrı ve benzersiz adlı bir iştir. Migration ikinci kez
-- çalıştırıldığında ada göre kaldırılıp yeniden kurulduğu için çift görev
-- oluşmaz.
-- ---------------------------------------------------------------------------

do $$
declare
  cleanup_command constant text :=
    'delete from public.user_content_reports where status in (''reviewed'', ''dismissed'', ''actioned'') and created_at <= timezone(''utc'', now()) - interval ''90 days'';';
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
      execute 'create extension if not exists pg_cron';
    else
      raise notice 'pg_cron yok: cleanup-resolved-user-content-reports kurulmadı.';
      return;
    end if;
  end if;

  execute $cmd$
    select cron.unschedule(jobid)
    from cron.job
    where jobname = 'cleanup-resolved-user-content-reports'
  $cmd$;

  execute format(
    'select cron.schedule(%L, %L, %L)',
    'cleanup-resolved-user-content-reports',
    '30 3 * * *',
    cleanup_command
  );
end;
$$;

commit;
