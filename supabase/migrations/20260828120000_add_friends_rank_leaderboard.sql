/**
 * ARKADAŞLAR ARASI SEZON SIRALAMASI
 *
 * KAPSAM
 * ------
 * Bu migration YALNIZCA yeni bir okuma RPC'si ekler. Hiçbir tablo, tip,
 * politika, grant veya mevcut fonksiyon DEĞİŞTİRİLMEZ; `get_friend_rank`
 * olduğu gibi kalır. RP kuralları, rank eşikleri, sezon uzunluğu, soft reset,
 * streak mantığı ve `rank_events` üretimi bu dosyada hiç geçmez.
 *
 * GÜVENLİK SINIRI
 * ---------------
 *   * RPC'nin KULLANICI KİMLİĞİ PARAMETRESİ YOKTUR. Aktif kullanıcı yalnızca
 *     `auth.uid()` ile belirlenir; istemci başka birinin listesini isteyemez.
 *   * `auth.uid()` null ise katılımcı kümesi boş kalır ve HİÇ satır dönmez.
 *   * Kapsam = aktif kullanıcı ∪ `friendships.status = 'accepted'` karşı taraf.
 *     `pending` ilişkiler (gelen de gönderilen de), silinmiş ilişkiler ve
 *     arkadaş olmayan kullanıcılar kümeye GİREMEZ. Global liste YOKTUR.
 *   * Aktif kullanıcı ilişkinin tarafı olmak zorundadır
 *     (`auth.uid() in (requester_id, receiver_id)`), bu yüzden başka iki
 *     kişinin arkadaşlığı bu yoldan sızmaz.
 *   * `security definer` + `set search_path = ''`; her nesne şema-nitelikli.
 *   * `public` ve `anon` execute yetkisi kaldırılır; yalnızca `authenticated`.
 *   * Sezon SUNUCU tarihinden gelir (`current_date`). İstemci sezon numarası,
 *     RP veya rank GÖNDEREMEZ.
 *
 * DÖNMEYEN ALANLAR — e-posta, gül bakiyesi, level/XP, bio, hedef, ham
 * `rank_events`, event metadata, workout ayrıntısı, disiplin günleri ve
 * `friendships` satırının özel alanları (id, created_at, requester/receiver)
 * BU RPC'DEN HİÇ ÇIKMAZ.
 */

-- ---------------------------------------------------------------------------
-- Arkadaş sezon sıralaması — tek okuma noktası
-- ---------------------------------------------------------------------------

/**
 * SIRALAMA KURALLARI
 *
 * `rank_position` — `dense_rank()`. Eşit RP AYNI sıra numarasını alır ve
 * numaralar arada boşluk bırakmaz (1, 1, 2 …). Sıralanmamış katılımcılar bu
 * hesaba HİÇ GİRMEZ; onların sırası `null` döner.
 *
 * Görüntü sırası deterministiktir ve şu üç adımdan oluşur:
 *   1. sıralanmışlar önce, sıralanmamışlar en altta,
 *   2. RP azalan,
 *   3. görünen ad (yoksa kullanıcı adı) artan — büyük/küçük harf duyarsız,
 *   4. son eşitlik bozucu olarak DEĞİŞMEYEN katılımcı kimliği.
 * Eşit RP'li iki kişinin görüntü sırası bu kurallarla sabitlense de
 * `rank_position` değerleri AYNI kalır.
 *
 * RANK SATIRI OLMAYAN KATILIMCI
 * Güncel sezonda `user_season_ranks` satırı yoksa `is_ranked = false` döner ve
 * `current_rp`, `current_rank`, `rank_position` alanlarının ÜÇÜ DE `null`dır.
 * Eski sezonun rankı okunmaz, uydurma bir değer üretilmez.
 *
 * YANIT SINIRI
 * Yanıt HİÇBİR durumda 100 satırı AŞMAZ ve aktif kullanıcının kendi satırı
 * HER ZAMAN içindedir. Kullanıcı doğal ilk 100 içindeyse gerçek ilk 100 satır
 * döner; dışındaysa kullanıcı + ilk 99 katılımcı döner (yine 100 satır).
 * Kendi satırını listeye sokmak için gerçek `rank_position` veya
 * `display_position` değeri DEĞİŞTİRİLMEZ; yalnızca ayrı bir seçim penceresi
 * kullanılır. `participant_count` sınırdan ÖNCEKİ gerçek toplam katılımcı
 * sayısıdır, böylece istemci "herkes gösteriliyor" izlenimi vermek zorunda
 * kalmaz.
 */
create or replace function public.get_friends_rank_leaderboard()
returns table (
  participant_id uuid,
  display_name text,
  username text,
  avatar_url text,
  season_index integer,
  current_rp integer,
  current_rank text,
  rank_position integer,
  is_self boolean,
  is_ranked boolean,
  participant_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select (select auth.uid()) as id
  ),
  season as (
    -- Sunucu günü otoritedir; istemci sezon seçemez.
    select public.rank_season_index_for(current_date) as season_index
  ),
  participants as (
    -- 1) Aktif kullanıcının kendisi.
    select a.id as participant_id
    from actor as a
    where a.id is not null
    union
    -- 2) YALNIZCA kabul edilmiş arkadaşlar.
    select case when f.requester_id = a.id then f.receiver_id else f.requester_id end
    from public.friendships as f
    cross join actor as a
    where a.id is not null
      and f.status = 'accepted'
      and a.id in (f.requester_id, f.receiver_id)
  ),
  scored as (
    select
      p.participant_id,
      pr.display_name,
      pr.username,
      pr.avatar_url,
      usr.current_rp,
      -- Güncel sezonda AÇIK bir rank satırı var mı?
      (usr.user_id is not null) as is_ranked,
      (p.participant_id = (select a.id from actor as a)) as is_self
    from participants as p
    join public.profiles as pr on pr.id = p.participant_id
    left join public.user_season_ranks as usr
      on usr.user_id = p.participant_id
      and usr.season_index = (select s.season_index from season as s)
      -- Kapanmış sezon satırı güncel sıralamaya GİREMEZ.
      and usr.finalized_at is null
  ),
  positions as (
    -- Sıra yalnızca gerçekten sıralanmış katılımcılar arasında hesaplanır.
    select
      s.participant_id,
      dense_rank() over (order by s.current_rp desc) as rank_position
    from scored as s
    where s.is_ranked
  ),
  ordered as (
    select
      s.participant_id,
      s.display_name,
      s.username,
      s.avatar_url,
      s.current_rp,
      s.is_ranked,
      s.is_self,
      pos.rank_position,
      count(*) over () as participant_count,
      row_number() over (
        order by
          s.is_ranked desc,
          s.current_rp desc nulls last,
          lower(coalesce(nullif(btrim(s.display_name), ''), s.username, '')) asc,
          s.participant_id asc
      ) as display_position
    from scored as s
    left join positions as pos on pos.participant_id = s.participant_id
  ),
  /**
   * SEÇİM PENCERESİ — yanıt HİÇBİR koşulda 100 satırı aşmaz.
   *
   * Aktif kullanıcı seçim sırasında ÖNCE gelir (`is_self desc`), geri kalanlar
   * gerçek görüntü sırasına göre dizilir. İlk 100 seçim alındığında:
   *
   *   * kullanıcı doğal ilk 100 içindeyse seçilen küme tam olarak gerçek ilk
   *     100 satırdır (kullanıcı zaten o kümededir),
   *   * kullanıcı ilk 100 dışındaysa küme = kullanıcı + ilk 99 katılımcı.
   *
   * `selection_position` YALNIZCA bu pencereyi kesmek içindir; kullanıcının
   * gerçek `rank_position` ve `display_position` değerlerine DOKUNMAZ ve
   * dışarı da çıkmaz. Nihai sıralama yine gerçek `display_position`'dır.
   */
  selected as (
    select
      o.*,
      row_number() over (order by o.is_self desc, o.display_position asc)
        as selection_position
    from ordered as o
  )
  select
    o.participant_id,
    o.display_name,
    o.username,
    o.avatar_url,
    (select s.season_index from season as s)::integer,
    -- Sıralanmamış katılımcı için RP/rank/sıra UYDURULMAZ.
    case when o.is_ranked then o.current_rp end,
    case when o.is_ranked then public.rank_for_rp(o.current_rp) end,
    case when o.is_ranked then o.rank_position::integer end,
    o.is_self,
    o.is_ranked,
    -- Sınırdan ÖNCEKİ gerçek toplam katılımcı sayısı.
    o.participant_count::integer
  from selected as o
  where o.selection_position <= 100
  order by o.display_position;
$$;

revoke all on function public.get_friends_rank_leaderboard() from public;
revoke all on function public.get_friends_rank_leaderboard() from anon;
grant execute on function public.get_friends_rank_leaderboard() to authenticated;
