-- Arkadaşlık sistemi ve arkadaşlarla paylaşılan disiplin özeti.
--
-- Güvenlik modeli:
--   * Yeni tablolarda RLS açıktır.
--   * İstemciye hiçbir yeni tabloda doğrudan INSERT/UPDATE/DELETE verilmez;
--     bütün yazma işlemleri doğrulanmış, dar amaçlı SECURITY DEFINER RPC'ler
--     üzerinden yapılır.
--   * Mevcut workout tablolarının (programs, program_days, program_exercises,
--     workout_sessions, workout_sets, manual_discipline_statuses) politikaları
--     HİÇ değiştirilmez; arkadaşlar ham antrenman verisine erişemez.
--   * Hiçbir fonksiyon auth.users, e-posta, provider metadata veya token
--     döndürmez.

begin;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Kullanıcı kendisine istek gönderemez.
  constraint friendships_no_self_check check (requester_id <> receiver_id)
);

-- Aynı iki kullanıcı arasında ters yönde bile ikinci ilişki oluşamaz.
create unique index friendships_unique_pair_idx
on public.friendships (
  least(requester_id, receiver_id),
  greatest(requester_id, receiver_id)
);

create index friendships_requester_idx on public.friendships (requester_id);
create index friendships_receiver_idx on public.friendships (receiver_id);

create trigger friendships_set_updated_at
before update on public.friendships
for each row execute function public.set_updated_at();

-- Arkadaşlarla paylaşılan tek veri: tarih + durum. Program adı, egzersiz,
-- ağırlık, tekrar, süre veya not burada YOKTUR.
create table public.shared_discipline_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  discipline_date date not null,
  status text not null check (status in ('completed', 'partial', 'skipped')),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, discipline_date)
);

create index shared_discipline_days_user_idx on public.shared_discipline_days (user_id);

alter table public.friendships enable row level security;
alter table public.shared_discipline_days enable row level security;

-- ---------------------------------------------------------------------------
-- Tablo yetkileri: Supabase'in varsayılan geniş grant'lerine güvenilmez.
-- `anon` hiçbir şey yapamaz; `authenticated` yalnızca SELECT alır ve bu da
-- RLS ile sınırlıdır. Bütün yazmalar SECURITY DEFINER RPC'lerden geçer.
-- `service_role` grant'lerine dokunulmaz.
-- ---------------------------------------------------------------------------

revoke all on table public.friendships from anon;
revoke all on table public.friendships from authenticated;
grant select on table public.friendships to authenticated;

revoke all on table public.shared_discipline_days from anon;
revoke all on table public.shared_discipline_days from authenticated;
grant select on table public.shared_discipline_days to authenticated;

-- ---------------------------------------------------------------------------
-- Yardımcı: iki kullanıcı kabul edilmiş arkadaş mı?
-- SECURITY DEFINER: politikalar içinde friendships'e bakarken RLS özyinelemesi
-- oluşmasın diye.
--
-- GÜVENLİK: yalnızca oturum açmış kullanıcı parametrelerden biriyse sonuç
-- döner. Aksi hâlde `false`. Böylece authenticated bir kullanıcı, taraf
-- olmadığı iki hesabın arkadaş olup olmadığını öğrenip sosyal grafiği
-- sızdıramaz.
-- ---------------------------------------------------------------------------

create or replace function public.are_friends(user_a uuid, user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships as f
    where (select auth.uid()) is not null
      and (select auth.uid()) in (user_a, user_b)
      and f.status = 'accepted'
      and (
        (f.requester_id = user_a and f.receiver_id = user_b)
        or (f.requester_id = user_b and f.receiver_id = user_a)
      )
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS politikaları — yalnızca SELECT. Yazma işlemleri RPC'lerden yapılır.
-- ---------------------------------------------------------------------------

-- Satırı yalnızca ilişkinin iki tarafı görebilir.
create policy "friendships_select_involved"
on public.friendships for select
to authenticated
using ((select auth.uid()) in (requester_id, receiver_id));

-- Kullanıcı kendi özetini veya kabul edilmiş arkadaşının özetini okuyabilir.
-- Arkadaşlık kaldırıldığında bu koşul artık sağlanmaz; eski günler silinmese
-- bile eski arkadaş onları okuyamaz.
create policy "shared_discipline_days_select_self_or_friend"
on public.shared_discipline_days for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.are_friends((select auth.uid()), user_id)
);

-- ---------------------------------------------------------------------------
-- Profil önizlemesi — arama ve listeler için güvenli, dar alan kümesi.
-- E-posta, provider metadata veya auth tablosu bilgisi ASLA dönmez.
-- ---------------------------------------------------------------------------

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
    -- Kendini sonuçlardan çıkar.
    and p.id <> (select auth.uid())
    and p.username is not null
    -- En az 2, en fazla 64 karakter; sorgu normalize edilir.
    and char_length(btrim(coalesce(search_query, ''))) between 2 and 64
    -- LITERAL alt dize araması. `ilike` kullanılmaz: kullanıcının yazdığı
    -- `%`, `_` ve `\` karakterleri SQL pattern joker karakteri hâline gelip
    -- tüm profilleri listeleyemesin diye. `strpos` kalıp yorumlamaz, bu yüzden
    -- kaçış (escape) da gerekmez.
    and (
      strpos(lower(p.username), lower(btrim(search_query))) > 0
      or strpos(lower(p.display_name), lower(btrim(search_query))) > 0
    )
  order by
    -- Tam kullanıcı adı eşleşmesi önce gelir; karşılaştırma büyük/küçük
    -- harfe duyarsızdır.
    (lower(p.username) = lower(btrim(search_query))) desc,
    p.username asc
  limit 20;
$$;

revoke all on function public.search_profiles(text) from public;
grant execute on function public.search_profiles(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Arkadaşlık işlemleri
-- ---------------------------------------------------------------------------

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

  -- Her iki yöndeki mevcut ilişki kontrol edilir; aynı isteğin tekrar
  -- gönderilmesi çift kayıt üretmez.
  select * into existing
  from public.friendships as f
  where (f.requester_id = actor and f.receiver_id = target_user_id)
     or (f.requester_id = target_user_id and f.receiver_id = actor)
  limit 1;

  if found then
    return existing.id;
  end if;

  -- Eşzamanlı iki çağrı unique index'e takılırsa hata kullanıcıya dönmez;
  -- mevcut ilişki tekrar bulunup kimliği döndürülür (idempotent).
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

-- İsteği yalnızca ALICI kabul veya reddedebilir.
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

  -- Satır işlem boyunca kilitlenir: iki cihazdan gelen eşzamanlı yanıt
  -- birbirini ezmez.
  select * into row_found
  from public.friendships as f
  where f.id = friendship_id
  limit 1
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Gönderen kendi isteğini kabul edemez.
  if row_found.receiver_id <> actor then
    raise exception 'not_receiver' using errcode = '42501';
  end if;

  if row_found.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = '22023';
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

-- Bekleyen isteği yalnızca GÖNDEREN iptal edebilir.
create or replace function public.cancel_friend_request(friendship_id uuid)
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

  select * into row_found
  from public.friendships as f
  where f.id = friendship_id
  limit 1
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  if row_found.requester_id <> actor then
    raise exception 'not_requester' using errcode = '42501';
  end if;

  if row_found.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = '22023';
  end if;

  delete from public.friendships where id = friendship_id;
end;
$$;

revoke all on function public.cancel_friend_request(uuid) from public;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

-- Kabul edilmiş arkadaşlığı iki taraftan biri kaldırabilir.
create or replace function public.remove_friend(friendship_id uuid)
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

  select * into row_found
  from public.friendships as f
  where f.id = friendship_id
  limit 1
  for update;

  if not found then
    raise exception 'friendship_not_found' using errcode = 'P0002';
  end if;

  if actor not in (row_found.requester_id, row_found.receiver_id) then
    raise exception 'not_involved' using errcode = '42501';
  end if;

  -- Yalnızca kabul edilmiş arkadaşlık kaldırılabilir. Bekleyen istekler
  -- yalnızca respond (alıcı) veya cancel (gönderen) ile kalkar.
  if row_found.status <> 'accepted' then
    raise exception 'not_accepted' using errcode = '22023';
  end if;

  delete from public.friendships where id = friendship_id;
end;
$$;

revoke all on function public.remove_friend(uuid) from public;
grant execute on function public.remove_friend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Listeler
-- ---------------------------------------------------------------------------

create or replace function public.list_friends()
returns table (
  friendship_id uuid,
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id as friendship_id,
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    f.updated_at as since
  from public.friendships as f
  join public.profiles as p
    on p.id = case when f.requester_id = (select auth.uid()) then f.receiver_id else f.requester_id end
  where (select auth.uid()) is not null
    and f.status = 'accepted'
    and (select auth.uid()) in (f.requester_id, f.receiver_id)
  order by p.display_name asc;
$$;

revoke all on function public.list_friends() from public;
grant execute on function public.list_friends() to authenticated;

-- Gelen ve gönderilmiş bekleyen istekler tek çağrıda döner.
create or replace function public.list_friend_requests()
returns table (
  friendship_id uuid,
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  direction text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id as friendship_id,
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    case when f.requester_id = (select auth.uid()) then 'outgoing' else 'incoming' end as direction,
    f.created_at
  from public.friendships as f
  join public.profiles as p
    on p.id = case when f.requester_id = (select auth.uid()) then f.receiver_id else f.requester_id end
  where (select auth.uid()) is not null
    and f.status = 'pending'
    and (select auth.uid()) in (f.requester_id, f.receiver_id)
  order by f.created_at desc;
$$;

revoke all on function public.list_friend_requests() from public;
grant execute on function public.list_friend_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Arkadaş profili — yalnızca paylaşılması amaçlanan alanlar.
-- Bekleyen istek sahibi tam profili GÖREMEZ.
-- ---------------------------------------------------------------------------

create or replace function public.get_friend_profile(target_user_id uuid)
returns table (
  id uuid,
  display_name text,
  username text,
  bio text,
  avatar_url text,
  banner_url text,
  training_goal text
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
    p.training_goal
  from public.profiles as p
  where (select auth.uid()) is not null
    and p.id = target_user_id
    and public.are_friends((select auth.uid()), target_user_id);
$$;

revoke all on function public.get_friend_profile(uuid) from public;
grant execute on function public.get_friend_profile(uuid) to authenticated;

-- Arkadaşın disiplin günleri — yalnızca tarih ve durum.
create or replace function public.get_friend_discipline_days(
  target_user_id uuid,
  from_date date,
  to_date date
)
returns table (
  discipline_date date,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Etkili pencere iki adımda hesaplanır; ürün sınırı her çağrıda EN FAZLA
  -- bugün dahil 366 gündür.
  with upper_bound as (
    -- Sunucunun `current_date` değeri UTC'dir; sahibinin ve görüntüleyenin
    -- yerel günü bundan en fazla bir gün sapabilir (bu sınır
    -- `sync_shared_discipline_days` tarafından zorlanır). Bu yüzden tavan
    -- `current_date + 1`: İstanbul'da gece 00.00–03.00 arasında yazılan geçerli
    -- yerel "bugün" kaydı kesilmez. Daha ileri bir tarih ASLA dönmez.
    select least(coalesce(to_date, current_date + 1), current_date + 1) as effective_to
  ),
  bounds as (
    select
      u.effective_to,
      greatest(
        -- İstenen başlangıç (verilmemişse tam pencere).
        coalesce(from_date, u.effective_to - 365),
        -- Bitişe göre en fazla 366 tarih (bitiş dahil).
        u.effective_to - 365,
        -- Mutlak taban: bundan eski keyfî sorgular sonuç döndürmez.
        current_date - 366
      ) as effective_from
    from upper_bound as u
  )
  select d.discipline_date, d.status
  from public.shared_discipline_days as d
  cross join bounds as b
  where (select auth.uid()) is not null
    and d.user_id = target_user_id
    and public.are_friends((select auth.uid()), target_user_id)
    -- `from_date > effective_to` verilirse aralık doğal olarak boş kalır.
    and d.discipline_date >= b.effective_from
    and d.discipline_date <= b.effective_to
  order by d.discipline_date asc
  -- Aralık tanım gereği en fazla 366 farklı tarih içerir; limit hem yeterli
  -- hem de zorunlu bir güvenlik ağıdır.
  limit 366;
$$;

revoke all on function public.get_friend_discipline_days(uuid, date, date) from public;
grant execute on function public.get_friend_discipline_days(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Kendi disiplin özetini senkronize etme — sınırlı ve doğrulanmış.
-- ---------------------------------------------------------------------------

-- Eski, `client_today` parametresiz sürüm varsa kaldırılır; aksi hâlde iki
-- imzalı bir overload kalır ve istemci yanlışlıkla doğrulamasız sürümü
-- çağırabilirdi. Fonksiyon yoksa bu ifade işlemsizdir.
drop function if exists public.sync_shared_discipline_days(jsonb);

create or replace function public.sync_shared_discipline_days(
  days jsonb,
  client_today date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  -- Pencere DOĞRULANMIŞ istemci yerel günü üzerinden hesaplanır (aşağıda).
  window_start date;
  incoming_count integer;
  valid_count integer;
  distinct_count integer;
  affected integer := 0;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- İstemcinin yerel günü sunucunun UTC gününden en fazla BİR gün sapabilir;
  -- bu, dünyadaki bütün UTC ofsetlerini (-12 … +14) kapsar. Örneğin İstanbul'da
  -- gece 00.00–03.00 arasında cihaz `current_date + 1` günündedir ve bu geçerli
  -- bir yerel "bugün"dür. Daha büyük sapma kontrollü hata ile reddedilir; böylece
  -- istemci pencereyi keyfî biçimde ileri veya geri kaydıramaz.
  if client_today is null
    or client_today < current_date - 1
    or client_today > current_date + 1 then
    raise exception 'invalid_client_date' using errcode = '22023';
  end if;

  -- Bugün dahil 366 gün. `client_today - 366` 367 günlük pencere yapardı.
  window_start := client_today - 365;

  if days is null or jsonb_typeof(days) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  -- Tek senkronizasyonda en fazla tam olarak 366 kayıt.
  if jsonb_array_length(days) > 366 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;

  -- Doğrulama: tek bir geçersiz eleman bile payload'ın tamamını reddeder.
  -- Sessizce filtreleme yapılmaz.
  with parsed as (
    select
      case
        when jsonb_typeof(item -> 'date') = 'string'
          and (item ->> 'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then (item ->> 'date')::date
        else null
      end as discipline_date,
      item ->> 'status' as status
    from jsonb_array_elements(days) as item
  )
  select
    count(*),
    count(*) filter (
      where discipline_date is not null
        and status in ('completed', 'partial', 'skipped')
        -- Gelecek tarih paylaşılmaz. Sınır, doğrulanmış istemci yerel günüdür.
        and discipline_date <= client_today
        and discipline_date >= window_start
    ),
    count(distinct discipline_date)
  into incoming_count, valid_count, distinct_count
  from parsed;

  if valid_count <> incoming_count then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  -- Aynı tarih iki kez gönderilemez.
  if distinct_count <> incoming_count then
    raise exception 'duplicate_dates' using errcode = '22023';
  end if;

  -- Aynı kullanıcının eşzamanlı snapshot çağrıları buradan itibaren sıraya
  -- alınır: sil + upsert adımları araya girmez ve geç kalan bir çağrı yeni
  -- snapshot'ın üstüne parça parça yazamaz.
  --   * Kilit yalnızca bu kullanıcıya özeldir: sabit bir ad alanı anahtarı +
  --     `actor` anahtarı. Başka kullanıcıların senkronizasyonu beklemez.
  --   * `_xact_` sürümü transaction sonunda (commit veya rollback) otomatik
  --     bırakılır; sızdıracak açık bir unlock yoktur.
  --   * Yalnızca doğrulama geçtikten sonra alınır; geçersiz payload kilidi
  --     meşgul etmez.
  --   * RLS, grant veya politika modelini değiştirmez.
  -- Not: bu kilit istemci tarafındaki latest-wins kuyruğunun yerine geçmez;
  -- iki katman birlikte çalışır (kilit sıralar, kuyruk eskiyi hiç göndermez).
  perform pg_advisory_xact_lock(
    hashtext('public.sync_shared_discipline_days'),
    hashtext(actor::text)
  );

  -- Snapshot: pencere içinde olup yeni payload'da bulunmayan KENDİ satırları
  -- silinir. Yerelde silinen bir gün arkadaş görünümünden de kalkar.
  -- Silme ve upsert aynı fonksiyon çağrısında, tek transaction içindedir.
  delete from public.shared_discipline_days as d
  where d.user_id = actor
    and d.discipline_date >= window_start
    and d.discipline_date <= client_today
    and not exists (
      select 1
      from jsonb_array_elements(days) as item
      where (item ->> 'date')::date = d.discipline_date
    );

  -- Boş dizi geçerlidir: yalnızca yukarıdaki temizlik çalışır.
  insert into public.shared_discipline_days (user_id, discipline_date, status, updated_at)
  select actor, (item ->> 'date')::date, item ->> 'status', timezone('utc', now())
  from jsonb_array_elements(days) as item
  on conflict (user_id, discipline_date)
  do update set status = excluded.status, updated_at = excluded.updated_at
  where public.shared_discipline_days.status is distinct from excluded.status;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.sync_shared_discipline_days(jsonb, date) from public;
grant execute on function public.sync_shared_discipline_days(jsonb, date) to authenticated;

commit;
