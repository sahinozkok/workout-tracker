/**
 * ESKİ SEZON VİTRİN SEÇİMİ → KALICI KARİYER VİTRİNİ (EKLEMELİ, İDEMPOTENT)
 *
 * Kullanıcının mevcut sezon vitrin seçimini gereksiz yere kaybetmemek için, ESKİ
 * `season_achievement_showcase_selections` içinden GÜVENLE eşlenebilenleri yeni
 * `career_achievement_showcase_selections`'a taşır.
 *
 * KURALLAR (kanıtlanamayan seçim eklenmez):
 *   * Yalnız anahtar EŞLEMESİ olan 6 sezon anahtarı taşınır (diğerlerinin
 *     kalıcı karşılığı yok → atlanır).
 *   * Yalnız yeni kalıcı DEFTERDE (career_achievements) AÇILMIŞ anahtarlar.
 *   * Kullanıcının EN GÜNCEL sezon seçimi kullanılır (en yüksek season_index),
 *     slot sırası korunur, en fazla 3.
 *   * Yalnız kullanıcının HENÜZ kariyer vitrin seçimi YOKSA yazılır (mevcut özel
 *     seçim EZİLMEZ). `on conflict do nothing` ile tekrar çalıştırılabilir.
 *
 * Eski sezon tabloları KORUNUR (silinmez). Ekonomi/ödül yazılmaz.
 */

begin;

do $$
begin
  if to_regclass('public.season_achievement_showcase_selections') is null
     or to_regclass('public.career_achievement_showcase_selections') is null
     or to_regclass('public.career_achievements') is null then
    raise notice 'gerekli tablolar yok; legacy showcase aktarimi atlandi';
    return;
  end if;

  with mapping(old_key, new_key) as (
    values ('first_workout','first_step'), ('workout_5','warmup_done'), ('workout_15','rhythm_found'),
           ('streak_3','three_day_spark'), ('streak_7','weekly_flame'), ('perfect_week','perfect_week')
  ),
  -- Kariyer vitrini HENÜZ boş olan kullanıcılar.
  candidates as (
    select distinct s.user_id
    from public.season_achievement_showcase_selections as s
    where not exists (
      select 1 from public.career_achievement_showcase_selections as c where c.user_id = s.user_id
    )
  ),
  -- Her adayın EN GÜNCEL sezonu.
  latest_season as (
    select s.user_id, max(s.season_index) as season_index
    from public.season_achievement_showcase_selections as s
    join candidates as cd on cd.user_id = s.user_id
    group by s.user_id
  ),
  -- O sezondaki seçimler; eşlenen + kariyerde açılmış olanlar; slot sırası korunur.
  mapped as (
    select
      s.user_id,
      m.new_key,
      row_number() over (partition by s.user_id order by s.slot_position) as new_slot
    from public.season_achievement_showcase_selections as s
    join latest_season as ls on ls.user_id = s.user_id and ls.season_index = s.season_index
    join mapping as m on m.old_key = s.achievement_key
    join public.career_achievements as a on a.user_id = s.user_id and a.achievement_key = m.new_key
  )
  insert into public.career_achievement_showcase_selections (user_id, slot_position, achievement_key)
  select user_id, new_slot::smallint, new_key
  from mapped
  where new_slot <= 3
  on conflict (user_id, slot_position) do nothing;
end $$;

commit;
