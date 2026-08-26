/**
 * PROFİL RENK ÖN AYARI
 *
 * Kullanıcı profilinin vurgu rengini Ayarlar'dan seçer. Renk ARKADAŞLARLA
 * PAYLAŞILIR: bir arkadaş profili açtığında profil, sahibinin seçtiği renkte
 * görünür — görüntüleyenin kendi tercihi kullanılmaz.
 *
 * Yalnızca STABLE PRESET ID saklanır, ham hex DEĞİL. Böylece:
 *   * istemci keyfi bir renk enjekte edemez (allowlist check constraint),
 *   * ön ayar paleti ileride güncellenirse eski satırlar bozulmaz.
 *
 * Migration ADDITIVE ve TEKRAR ÇALIŞTIRILABİLİR'dir. Uygulanmadan önce de
 * uygulama çalışır: istemci `color_preset` kolonunu opsiyonel kabul eder ve
 * eksikse mevcut varsayılan renge düşer.
 *
 * Diğer renk tercihleri (Workout Days, Active Workout, History, Rosea Chat,
 * Friends) BİLİNÇLİ olarak sunucuya yazılmaz: onlar paylaşılmaz, cihaz yerel
 * tercihleridir.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Kolon + allowlist
-- ---------------------------------------------------------------------------

alter table public.profiles
add column if not exists color_preset text not null default 'profileClay';

/**
 * Allowlist: `constants/color-presets.ts` içindeki ID kümesiyle birebir aynı.
 * `not valid` DEĞİL — kolon yeni ve varsayılanı listede olduğu için mevcut
 * bütün satırlar kuralı zaten sağlar.
 */
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_color_preset_allowlist'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_color_preset_allowlist
    check (color_preset in (
      'orange', 'orangeDeep', 'orangeDark', 'darkOrange', 'darkOrangeVivid', 'workoutOrange',
      'coral', 'salmon', 'tomato', 'red', 'crimson', 'brickRed',
      'deepPink', 'hotPink', 'pink', 'paleVioletRed',
      'mediumOrchid', 'darkOrchid', 'blueViolet', 'mediumPurple', 'purple', 'socialPurple',
      'systemBlue', 'dodgerBlue', 'royalBlue', 'cornflowerBlue', 'steelBlue', 'skyBlue',
      'darkTurquoise', 'turquoise', 'mediumTurquoise', 'teal',
      'springGreen', 'mediumSeaGreen', 'forestGreen', 'seaGreenLight', 'disciplineGreen',
      'gold', 'goldDeep', 'goldenRod',
      'brown', 'saddleBrown', 'rosyBrown', 'slateGray', 'profileClay'
    ));
  end if;
end;
$$;

/**
 * YAZMA YETKİSİ: `profiles` üzerindeki MEVCUT RLS politikaları aynen geçerlidir
 * (kullanıcı yalnızca `id = auth.uid()` olan satırını günceller). Yeni grant
 * veya politika EKLENMEZ; dolayısıyla kimse başkasının rengini değiştiremez.
 */

-- ---------------------------------------------------------------------------
-- 2) Arkadaş profili RPC'si — yalnızca preset ID eklenir
-- ---------------------------------------------------------------------------

/**
 * `get_friend_profile` GÜVENLİK KOŞULU VE DÖNDÜRDÜĞÜ SEVİYE ALANLARI AYNEN
 * KORUNUR; tek değişiklik dönüş kümesine `color_preset` eklenmesidir.
 *
 *   * `are_friends((select auth.uid()), target_user_id)` kontrolü yerinde.
 *   * `security definer` + `set search_path = ''` yerinde.
 *   * `rose_balance`, antrenman verisi veya başka kullanıcı ayarı DÖNMEZ.
 *
 * Dönüş imzası genişlediği için fonksiyon önce düşürülür.
 */
drop function if exists public.get_friend_profile(uuid);

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
    and public.are_friends((select auth.uid()), target_user_id);
$$;

revoke all on function public.get_friend_profile(uuid) from public;
revoke all on function public.get_friend_profile(uuid) from anon;
grant execute on function public.get_friend_profile(uuid) to authenticated;

commit;
