/**
 * PROFİL ROZET VİTRİNİ — KULLANICI SEÇİMİ
 *
 * KAPSAM
 * ------
 * Kullanıcı, güncel sezonda GERÇEKTEN kazandığı rozetlerden en fazla üçünü
 * profil vitrininde göstermek üzere seçebilir. Seçim tamamen KOZMETİKTİR:
 * bu dosya RP, XP, level, gül veya rank tablolarına HİÇBİR ŞEY yazmaz, başarı
 * koşullarını değiştirmez ve kutlama/baseline mantığına dokunmaz.
 *
 * Uygulanmış migration dosyaları DEĞİŞTİRİLMEZ. Burada yalnızca yeni bir tablo
 * ve yeni RPC'ler eklenir; `get_friend_season_achievement_showcase` ise imzası
 * KORUNARAK genişletilir (yeni bir dal eklenir, mevcut fallback aynen kalır).
 *
 * GÜVENLİK SINIRI
 * ---------------
 *   * Aktif kullanıcı YALNIZCA `auth.uid()` ile belirlenir. İstemci `user_id`
 *     veya `season_index` GÖNDEREMEZ; sezon sunucunun `current_date`
 *     değerinden mevcut `public.rank_season_index_for` ile türetilir (ikinci
 *     bir sezon hesabı YAZILMAZ).
 *   * Seçim tablosunda istemci için insert/update/delete policy'si YOKTUR ve
 *     tabloya HİÇBİR grant verilmez: okuma da yazma da yalnızca dar kapsamlı
 *     `security definer` RPC'lerden geçer.
 *   * Bütün fonksiyonlar `security definer` + `set search_path = ''`; her
 *     nesne şema-nitelikli yazılır.
 *   * `public` ve `anon` execute yetkileri kaldırılır; yalnızca
 *     `authenticated` gerekli RPC'leri çalıştırabilir.
 *   * Arkadaş erişimi yalnızca `public.are_friends` korumalı mevcut RPC
 *     üzerinden ve yalnızca gösterim alanlarıyla olur.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Seçim tablosu — kullanıcı + sezon başına en fazla üç slot
-- ---------------------------------------------------------------------------

create table if not exists public.season_achievement_showcase_selections (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_index integer not null references public.rank_seasons(season_index),
  /** Profildeki gösterim sırası. Yalnızca 1, 2 veya 3. */
  slot_position smallint not null check (slot_position between 1 and 3),
  achievement_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  /**
   * Birincil anahtar slot başına TEK satır garantiler ve aynı zamanda
   * "en fazla üç slot" kuralını `slot_position` CHECK'iyle birlikte taşır.
   */
  primary key (user_id, season_index, slot_position)
);

/** Aynı rozet aynı kullanıcı ve sezonda İKİ KEZ seçilemez. */
create unique index if not exists season_achievement_showcase_unique_key_idx
on public.season_achievement_showcase_selections (user_id, season_index, achievement_key);

alter table public.season_achievement_showcase_selections enable row level security;

/**
 * Tabloya HİÇBİR grant verilmez: istemci ne okuyabilir ne yazabilir.
 * Bütün erişim aşağıdaki `security definer` RPC'lerden geçer.
 */
revoke all on table public.season_achievement_showcase_selections from anon;
revoke all on table public.season_achievement_showcase_selections from authenticated;

/**
 * Politika savunma amaçlıdır: ileride yanlışlıkla bir `grant select` eklenirse
 * bile kullanıcı YALNIZCA kendi satırlarını görebilir. Yazma policy'si
 * BİLİNÇLİ olarak yoktur.
 */
drop policy if exists "season_achievement_showcase_select_own"
  on public.season_achievement_showcase_selections;
create policy "season_achievement_showcase_select_own"
on public.season_achievement_showcase_selections for select
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.season_achievement_showcase_selections is
  'Cosmetic per-season profile badge showcase selection. Grants no RP, XP or currency.';

-- ---------------------------------------------------------------------------
-- 2) Okuma — kullanıcının kendi güncel sezon seçimi
-- ---------------------------------------------------------------------------

/**
 * Aktif kullanıcının GÜNCEL sezondaki özel seçimi.
 *
 * DÖNÜŞ SÖZLEŞMESİ — her BAŞARILI çağrı sunucunun belirlediği
 * `season_index` değerini TAŞIR:
 *
 *   * Özel seçim VARSA: slot başına bir satır, `is_custom = true`,
 *     `slot_position` ve `achievement_key` dolu.
 *   * Özel seçim YOKSA: TEK satır, `is_custom = false`, `slot_position` ve
 *     `achievement_key` NULL.
 *
 * "Sıfır satır" bilinçli olarak YALNIZCA oturum yokken üretilir. Aksi hâlde
 * istemci "otomatik mod" ile "henüz yüklenmedi" durumunu AYIRT EDEMEZDİ ve
 * sezon değişiminde eski seçimi yeni sezona uygulayabilirdi.
 *
 * Seçilen bir rozetin başarı satırı bir sebeple yoksa (beklenmez) o slot
 * sessizce düşer — uydurma rozet gösterilmez.
 */
create or replace function public.get_my_season_showcase_selection()
returns table (
  season_index integer,
  is_custom boolean,
  slot_position smallint,
  achievement_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    -- Sunucu günü otoritedir; istemci sezon seçemez. Oturum yoksa hiç satır
    -- üretilmez ve fonksiyon boş döner.
    select public.rank_season_index_for(current_date) as season_index
    where (select auth.uid()) is not null
  ),
  selected as (
    select s.slot_position, s.achievement_key
    from public.season_achievement_showcase_selections as s
    join public.season_rank_achievements as a
      on a.user_id = s.user_id
      and a.season_index = s.season_index
      and a.achievement_key = s.achievement_key
    where s.user_id = (select auth.uid())
      and s.season_index = (select t.season_index from target as t)
  )
  /**
   * `left join ... on true`: `selected` boşsa TEK satır (otomatik mod), doluysa
   * slot başına bir satır üretir. Her iki durumda da sezon kimliği taşınır.
   */
  select
    t.season_index,
    (sel.achievement_key is not null) as is_custom,
    sel.slot_position,
    sel.achievement_key
  from target as t
  left join selected as sel on true
  order by sel.slot_position nulls first;
$$;

revoke all on function public.get_my_season_showcase_selection() from public;
revoke all on function public.get_my_season_showcase_selection() from anon;
grant execute on function public.get_my_season_showcase_selection() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Yazma — atomik, doğrulamalı, idempotent
-- ---------------------------------------------------------------------------

/**
 * Aktif kullanıcının GÜNCEL sezon seçimini tamamen değiştirir.
 *
 * BOŞ DİZİ (veya `null`) → özel seçim SİLİNİR ve kullanıcı otomatik moda
 * döner. Geçmiş sezonların satırları KORUNUR: yalnızca güncel sezon silinir.
 *
 * SUNUCU DOĞRULAMALARI — hepsi burada, istemciye güvenilmez:
 *   * 0–3 eleman.
 *   * Anahtarlar benzersiz.
 *   * Her anahtar başarı KATALOĞUNDA bulunmalı (bilinmeyen rozet reddedilir).
 *   * Her anahtar aktif kullanıcının GÜNCEL sezonda gerçekten AÇTIĞI
 *     `season_rank_achievements` satırında bulunmalı — kilitli rozet, başka
 *     kullanıcının rozeti ve başka sezonun rozeti reddedilir.
 *
 * ATOMİKLİK — tek transaction içinde `delete` + `insert`. Kullanıcı başına
 * `pg_advisory_xact_lock` (anahtar 8024 — ödül 8021 ve rank 8023 ile
 * ÇAKIŞMAZ) alınır, böylece eşzamanlı iki kaydetme kısmi/karışık slot
 * bırakamaz. Doğrulama başarısız olursa `raise` transaction'ı geri alır ve
 * ÖNCEKİ geçerli seçim olduğu gibi kalır.
 *
 * IDEMPOTENCY — aynı dizi tekrar gönderilirse sonuç birebir aynıdır.
 *
 * Yanıt, kaydedilen seçimin son hâlidir ve SEZON KİMLİĞİNİ taşır: istemcinin
 * ikinci bir okuma sorgusu yapmasına gerek kalmaz ve cevabın hangi sezona ait
 * olduğu belirsiz kalmaz.
 */
create or replace function public.set_my_season_showcase_selection(achievement_keys text[])
returns table (
  season_index integer,
  is_custom boolean,
  slot_position smallint,
  achievement_key text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_season integer;
  keys text[] := coalesce(achievement_keys, array[]::text[]);
  key_count integer;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  key_count := array_length(keys, 1);
  if key_count is null then
    key_count := 0;
  end if;

  -- En fazla üç rozet seçilebilir.
  if key_count > 3 then
    raise exception 'too_many_showcase_selections' using errcode = '22023';
  end if;

  -- Aynı rozet iki kez seçilemez.
  if key_count <> (select count(distinct value) from unnest(keys) as value) then
    raise exception 'duplicate_showcase_selection' using errcode = '22023';
  end if;

  target_season := public.rank_season_index_for(current_date);
  -- Yabancı anahtar için sezon satırının var olduğundan emin olunur.
  perform public.ensure_rank_season(target_season);

  -- Eşzamanlı iki kaydetme sıraya alınır: kısmi slot kalmaz.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8024));

  if key_count > 0 then
    -- Bilinmeyen anahtar (katalogda yok) reddedilir.
    if exists (
      select 1
      from unnest(keys) as value
      where not exists (
        select 1 from public.season_achievement_catalog() as c
        where c.achievement_key = value
      )
    ) then
      raise exception 'unknown_showcase_achievement' using errcode = '22023';
    end if;

    /**
     * Kilitli / başka kullanıcıya / başka sezona ait rozet reddedilir.
     * Sorgu AKTİF KULLANICININ GÜNCEL SEZON satırlarına kilitlidir.
     */
    if exists (
      select 1
      from unnest(keys) as value
      where not exists (
        select 1 from public.season_rank_achievements as a
        where a.user_id = actor
          and a.season_index = target_season
          and a.achievement_key = value
      )
    ) then
      raise exception 'locked_showcase_achievement' using errcode = '22023';
    end if;
  end if;

  -- Güncel sezonun seçimi tamamen değiştirilir; GEÇMİŞ SEZONLAR KORUNUR.
  delete from public.season_achievement_showcase_selections as s
  where s.user_id = actor and s.season_index = target_season;

  if key_count > 0 then
    insert into public.season_achievement_showcase_selections (
      user_id, season_index, slot_position, achievement_key
    )
    select actor, target_season, ordinality::smallint, value
    from unnest(keys) with ordinality as t(value, ordinality);
  end if;

  /**
   * Yanıt okuma RPC'siyle AYNI sözleşmeyi taşır: sezon kimliği her zaman
   * döner, otomatik modda tek satır + `is_custom = false` gelir. Böylece
   * istemci kaydettikten sonra da "hangi sezon için" sorusunu yanıtlayabilir.
   */
  return query
  with selected as (
    select s.slot_position, s.achievement_key
    from public.season_achievement_showcase_selections as s
    where s.user_id = actor and s.season_index = target_season
  )
  select
    target_season,
    (sel.achievement_key is not null) as is_custom,
    sel.slot_position,
    sel.achievement_key
  from (select 1) as anchor
  left join selected as sel on true
  order by sel.slot_position nulls first;
end;
$$;

revoke all on function public.set_my_season_showcase_selection(text[]) from public;
revoke all on function public.set_my_season_showcase_selection(text[]) from anon;
grant execute on function public.set_my_season_showcase_selection(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Arkadaş vitrini — imza KORUNARAK genişletilir
-- ---------------------------------------------------------------------------

/**
 * Arkadaşın güncel sezon vitrini.
 *
 * DEĞİŞEN TEK ŞEY: arkadaşın geçerli bir ÖZEL SEÇİMİ varsa rozetler SLOT
 * SIRASIYLA döner. Seçim yoksa mevcut "en son kazanılan üç rozet" fallback'i
 * AYNEN çalışır. Dönüş imzası ve güvenlik sınırı değişmez:
 *   * `public.are_friends((select auth.uid()), target_user_id)` şartı korunur;
 *     arkadaş olmayan, bekleyen istek veya yabancı kullanıcı HİÇBİR satır
 *     göremez.
 *   * Sezon yine sunucunun `current_date` değerinden gelir.
 *   * En fazla üç satır döner.
 *   * Yanıt yalnızca gösterim alanlarını taşır: e-posta, gül, XP/level, RP
 *     geçmişi, workout verisi, ilerleme ve hedef HİÇ dönmez.
 *   * Seçim tablosuna arkadaşlar için doğrudan SELECT AÇILMAZ; veri yalnızca
 *     bu `security definer` fonksiyondan çıkar.
 *
 * Sıra `slot_position` ile taşınır ve istemci onu yeniden sıralamaz.
 */
create or replace function public.get_friend_season_achievement_showcase(target_user_id uuid)
returns table (
  season_index integer,
  achievement_key text,
  unlocked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select (select auth.uid()) as id
  ),
  allowed as (
    select 1
    from viewer as v
    where v.id is not null
      -- Kabul edilmiş arkadaşlık DIŞINDA hiçbir satır dönmez.
      and public.are_friends(v.id, target_user_id)
  ),
  current_season as (
    -- Sunucu günü otoritedir; istemci sezon seçemez.
    select public.rank_season_index_for(current_date) as season_index
  ),
  selected as (
    select
      s.slot_position::integer as slot_position,
      a.season_index,
      a.achievement_key,
      a.unlocked_at
    from public.season_achievement_showcase_selections as s
    join public.season_rank_achievements as a
      on a.user_id = s.user_id
      and a.season_index = s.season_index
      and a.achievement_key = s.achievement_key
    where exists (select 1 from allowed)
      and s.user_id = target_user_id
      and s.season_index = (select cs.season_index from current_season as cs)
  ),
  fallback as (
    select
      row_number() over (
        order by a.unlocked_at desc, coalesce(c.sort_order, 2147483647), a.achievement_key
      )::integer as slot_position,
      a.season_index,
      a.achievement_key,
      a.unlocked_at
    from public.season_rank_achievements as a
    left join public.season_achievement_catalog() as c
      on c.achievement_key = a.achievement_key
    where exists (select 1 from allowed)
      and a.user_id = target_user_id
      and a.season_index = (select cs.season_index from current_season as cs)
  )
  select combined.season_index, combined.achievement_key, combined.unlocked_at
  from (
    select * from selected
    union all
    -- Özel seçim VARSA fallback hiç kullanılmaz.
    select * from fallback where not exists (select 1 from selected)
  ) as combined
  order by combined.slot_position
  limit 3;
$$;

revoke all on function public.get_friend_season_achievement_showcase(uuid) from public;
revoke all on function public.get_friend_season_achievement_showcase(uuid) from anon;
grant execute on function public.get_friend_season_achievement_showcase(uuid) to authenticated;

commit;
