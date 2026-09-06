/**
 * KARİYER BAŞARIM VİTRİNİ — KULLANICI SEÇİMİ (SEZONDAN BAĞIMSIZ, EKLEMELİ)
 *
 * Kullanıcı, KALICI olarak açtığı başarımlardan en fazla ÜÇÜNÜ profil vitrininde
 * gösterir. Sezon YOKTUR: seçim sezon değişince sıfırlanmaz. Tamamen KOZMETİK —
 * RP/XP/roses/level/rank tablolarına HİÇBİR ŞEY yazılmaz.
 *
 * GÜVENLİK — aktif kullanıcı yalnız `auth.uid()`; istemci user_id gönderemez.
 * Seçim tablosuna hiçbir grant verilmez; okuma/yazma yalnız security-definer
 * RPC'lerden. Yalnız AÇILMIŞ (defterde olan) başarımlar seçilebilir. Arkadaş
 * erişimi `are_friends` kapılı ve yalnız gösterim alanlarını taşır. `public`/
 * `anon` execute kaldırılır. Mevcut sezon showcase sistemi KORUNUR (ayrıdır).
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Seçim tablosu — kullanıcı başına en fazla üç slot (sezon YOK)
-- ---------------------------------------------------------------------------
create table if not exists public.career_achievement_showcase_selections (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_position smallint not null check (slot_position between 1 and 3),
  achievement_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, slot_position)
);

create unique index if not exists career_showcase_unique_key_idx
  on public.career_achievement_showcase_selections (user_id, achievement_key);

alter table public.career_achievement_showcase_selections enable row level security;
revoke all on table public.career_achievement_showcase_selections from anon;
revoke all on table public.career_achievement_showcase_selections from authenticated;

drop policy if exists "career_showcase_select_own" on public.career_achievement_showcase_selections;
create policy "career_showcase_select_own"
  on public.career_achievement_showcase_selections for select
  to authenticated using ((select auth.uid()) = user_id);

comment on table public.career_achievement_showcase_selections is
  'Cosmetic season-independent profile achievement showcase selection. Grants no RP, XP or currency.';

-- ---------------------------------------------------------------------------
-- 2) Okuma — kendi seçimi (özel varsa slot sırası; yoksa tek satır otomatik)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_achievement_showcase()
returns table (is_custom boolean, slot_position smallint, achievement_key text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id where (select auth.uid()) is not null),
  selected as (
    -- Yalnız HÂLÂ açık olan seçimler (defterde bulunan) gösterilir.
    select s.slot_position, s.achievement_key
    from public.career_achievement_showcase_selections as s
    join public.career_achievements as a
      on a.user_id = s.user_id and a.achievement_key = s.achievement_key
    where s.user_id = (select id from me)
  )
  select (sel.achievement_key is not null) as is_custom, sel.slot_position, sel.achievement_key
  from me
  left join selected as sel on true
  order by sel.slot_position nulls first;
$$;

revoke all on function public.get_my_achievement_showcase() from public;
revoke all on function public.get_my_achievement_showcase() from anon;
grant execute on function public.get_my_achievement_showcase() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Yazma — atomik, doğrulamalı, idempotent (yalnız AÇILMIŞ başarım seçilebilir)
-- ---------------------------------------------------------------------------
create or replace function public.set_my_achievement_showcase(achievement_keys text[])
returns table (is_custom boolean, slot_position smallint, achievement_key text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  keys text[] := coalesce(achievement_keys, array[]::text[]);
  key_count integer;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  key_count := coalesce(array_length(keys,1), 0);
  if key_count > 3 then
    raise exception 'too_many_showcase_selections' using errcode = '22023';
  end if;
  if key_count <> (select count(distinct value) from unnest(keys) as value) then
    raise exception 'duplicate_showcase_selection' using errcode = '22023';
  end if;

  -- Eşzamanlı kaydetmeler sıraya alınır (anahtar 8025; diğer advisory'lerle çakışmaz).
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 8025));

  if key_count > 0 then
    -- Bilinmeyen anahtar (katalogda yok) reddedilir.
    if exists (
      select 1 from unnest(keys) as value
      where not exists (select 1 from public.achievement_catalog() as c where c.achievement_key = value)
    ) then
      raise exception 'unknown_showcase_achievement' using errcode = '22023';
    end if;
    -- Kilitli / başka kullanıcıya ait: yalnız aktörün AÇTIĞI başarım seçilebilir.
    if exists (
      select 1 from unnest(keys) as value
      where not exists (
        select 1 from public.career_achievements as a
        where a.user_id = actor and a.achievement_key = value
      )
    ) then
      raise exception 'locked_showcase_achievement' using errcode = '22023';
    end if;
  end if;

  delete from public.career_achievement_showcase_selections as s where s.user_id = actor;
  if key_count > 0 then
    insert into public.career_achievement_showcase_selections (user_id, slot_position, achievement_key)
    select actor, ordinality::smallint, value
    from unnest(keys) with ordinality as t(value, ordinality);
  end if;

  return query
  with selected as (
    select s.slot_position, s.achievement_key
    from public.career_achievement_showcase_selections as s where s.user_id = actor
  )
  select (sel.achievement_key is not null), sel.slot_position, sel.achievement_key
  from (select 1) as anchor
  left join selected as sel on true
  order by sel.slot_position nulls first;
end;
$$;

revoke all on function public.set_my_achievement_showcase(text[]) from public;
revoke all on function public.set_my_achievement_showcase(text[]) from anon;
grant execute on function public.set_my_achievement_showcase(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Arkadaş vitrini — are_friends kapılı; yalnız seçili+açık başarımlar
-- ---------------------------------------------------------------------------
/**
 * Arkadaşın seçtiği (özel) başarımlar slot sırasıyla; seçim yoksa en son açılan
 * üç başarıma düşülür. Yalnız gösterim alanları döner (key, unlocked_at);
 * ilerleme/hedef/özel veri HİÇ dönmez. `are_friends` dışında hiç satır dönmez.
 */
create or replace function public.get_friend_achievement_showcase(target_user_id uuid)
returns table (achievement_key text, unlocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select 1 where (select auth.uid()) is not null
      and public.are_friends((select auth.uid()), target_user_id)
  ),
  selected as (
    select s.slot_position::integer as slot_position, a.achievement_key, a.unlocked_at
    from public.career_achievement_showcase_selections as s
    join public.career_achievements as a
      on a.user_id = s.user_id and a.achievement_key = s.achievement_key
    where exists (select 1 from allowed) and s.user_id = target_user_id
  ),
  fallback as (
    select
      row_number() over (
        order by a.unlocked_at desc, coalesce(c.sort_order, 2147483647), a.achievement_key
      )::integer as slot_position,
      a.achievement_key, a.unlocked_at
    from public.career_achievements as a
    left join public.achievement_catalog() as c on c.achievement_key = a.achievement_key
    where exists (select 1 from allowed) and a.user_id = target_user_id
  )
  select combined.achievement_key, combined.unlocked_at
  from (
    select * from selected
    union all
    select * from fallback where not exists (select 1 from selected)
  ) as combined
  order by combined.slot_position
  limit 3;
$$;

revoke all on function public.get_friend_achievement_showcase(uuid) from public;
revoke all on function public.get_friend_achievement_showcase(uuid) from anon;
grant execute on function public.get_friend_achievement_showcase(uuid) to authenticated;

commit;
