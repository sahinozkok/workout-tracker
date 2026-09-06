/**
 * SEVİYE GÜLÜ SEÇİMİ — kalıcı, güvenli kullanıcı tercihi (EKLEMELİ)
 *
 * Kullanıcı seviye atladıkça açılan gül sembollerinden birini seçip profilinde
 * sergiler. Bu tercih SUNUCUDA saklanır (yeniden giriş / başka cihaz / ileride
 * arkadaş profili). Bu migration YALNIZCA EKLER:
 *   * `user_progress.selected_level_rose` kolonu (nullable = otomatik mod),
 *   * `level_rose_unlock_level(text)` saf yardımcı (istemci katalogunun aynası),
 *   * `set_my_level_rose` / `get_my_level_rose` RPC'leri,
 *   * `get_friend_level_rose` (arkadaş okuması, `are_friends` korumalı).
 *
 * DEĞİŞTİRİLMEYENLER — XP, RP, roses bakiyesi, seviye hesabı, mevcut RPC'ler,
 * tarihsel migrationlar ve arşiv verisi. Bir gül seçmek/değiştirmek XP/RP/roses
 * ÜRETMEZ/HARCAMAZ ve gerçek seviyeyi DEĞİŞTİRMEZ.
 *
 * GÜVENLİK
 *   * `user_progress`'te istemci için insert/update/delete policy'si YOKTUR:
 *     doğrudan tablo güncellemesi imkânsızdır, tek yazma yolu aşağıdaki
 *     `set_my_level_rose` RPC'sidir (security definer).
 *   * Seviye, İSTEMCİDEN gelmez: sunucu `lifetime_xp` → `level_progress` ile
 *     hesaplar. Kilitli veya bilinmeyen gül kimliği RPC'de REDDEDİLİR.
 *   * Kolon üzerinde katalog üyeliği CHECK'i vardır (savunma derinliği); kilit
 *     kuralı (seviye ≥ açılma) RPC'dedir.
 *   * Her RPC sahipliği `auth.uid()` ile doğrular; yalnız kendi satırı yazılır.
 *   * `anon`/`public` erişimi reddedilir; yalnız `authenticated` EXECUTE alır.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) Eklemeli kolon + katalog üyeliği CHECK'i
-- ---------------------------------------------------------------------------
alter table public.user_progress
  add column if not exists selected_level_rose text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_progress_selected_level_rose_known'
  ) then
    alter table public.user_progress
      add constraint user_progress_selected_level_rose_known
      check (
        selected_level_rose is null
        or selected_level_rose in (
          'rose_1','rose_2','rose_3','rose_4','rose_5','rose_6','rose_7','rose_8','rose_9','rose_10',
          'rose_11','rose_12','rose_13','rose_15','rose_20','rose_25','rose_30','rose_35','rose_40',
          'rose_50','rose_65','rose_80','rose_100','rose_150','rose_200'
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Açılma seviyesi yardımcısı — `constants/level-roses.ts` ile BİREBİR
-- ---------------------------------------------------------------------------
create or replace function public.level_rose_unlock_level(rose_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case rose_id
    when 'rose_1' then 1
    when 'rose_2' then 2
    when 'rose_3' then 3
    when 'rose_4' then 4
    when 'rose_5' then 5
    when 'rose_6' then 6
    when 'rose_7' then 7
    when 'rose_8' then 8
    when 'rose_9' then 9
    when 'rose_10' then 10
    when 'rose_11' then 11
    when 'rose_12' then 12
    when 'rose_13' then 13
    when 'rose_15' then 15
    when 'rose_20' then 20
    when 'rose_25' then 25
    when 'rose_30' then 30
    when 'rose_35' then 35
    when 'rose_40' then 40
    when 'rose_50' then 50
    when 'rose_65' then 65
    when 'rose_80' then 80
    when 'rose_100' then 100
    when 'rose_150' then 150
    when 'rose_200' then 200
    else null
  end;
$$;

revoke all on function public.level_rose_unlock_level(text) from public;
revoke all on function public.level_rose_unlock_level(text) from anon;
revoke all on function public.level_rose_unlock_level(text) from authenticated;

do $$
begin
  assert public.level_rose_unlock_level('rose_1') = 1, 'rose_1 açılma 1';
  assert public.level_rose_unlock_level('rose_13') = 13, 'rose_13 açılma 13';
  assert public.level_rose_unlock_level('rose_15') = 15, 'rose_15 açılma 15';
  assert public.level_rose_unlock_level('rose_200') = 200, 'rose_200 açılma 200';
  assert public.level_rose_unlock_level('rose_14') is null, 'rose_14 katalogda yok';
  assert public.level_rose_unlock_level('rose_999') is null, 'bilinmeyen kimlik null';
end $$;

-- ---------------------------------------------------------------------------
-- 3) OKUMA — kendi tercihim (ham; null = otomatik mod)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_level_rose()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sel text;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform public.ensure_user_progress(actor);
  select up.selected_level_rose into sel
  from public.user_progress as up
  where up.user_id = actor;
  return sel;
end;
$$;

revoke all on function public.get_my_level_rose() from public;
revoke all on function public.get_my_level_rose() from anon;
grant execute on function public.get_my_level_rose() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) YAZMA — tercihimi ayarla (doğrulanmış). null → otomatik moda dön.
-- ---------------------------------------------------------------------------
/**
 * Seviye SUNUCUDAN hesaplanır (`lifetime_xp` → `level_progress`); istemcinin
 * bildirdiği seviyeye GÜVENİLMEZ. Bilinmeyen kimlik → `unknown_level_rose`;
 * kilitli (seviye < açılma) → `level_rose_locked`. Yalnız kendi satırı yazılır.
 * Dönüş, kalıcılaşan ham değerdir (istemci onu doğrular).
 */
create or replace function public.set_my_level_rose(target_rose text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  user_level integer;
  unlock integer;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform public.ensure_user_progress(actor);

  if target_rose is not null then
    unlock := public.level_rose_unlock_level(target_rose);
    if unlock is null then
      raise exception 'unknown_level_rose' using errcode = '22023';
    end if;

    select lp.level into user_level
    from public.user_progress as up
    cross join lateral public.level_progress(up.lifetime_xp) as lp
    where up.user_id = actor;

    if coalesce(user_level, 1) < unlock then
      raise exception 'level_rose_locked' using errcode = '42501';
    end if;
  end if;

  update public.user_progress as up
  set selected_level_rose = target_rose,
      updated_at = timezone('utc', now())
  where up.user_id = actor;

  return target_rose;
end;
$$;

revoke all on function public.set_my_level_rose(text) from public;
revoke all on function public.set_my_level_rose(text) from anon;
grant execute on function public.set_my_level_rose(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) ARKADAŞ OKUMASI — `are_friends` korumalı (ileride arkadaş profili için)
-- ---------------------------------------------------------------------------
-- Yalnız seçili gül kimliği paylaşılır; XP/roses/özel veri paylaşılmaz. Arkadaş
-- değilse hiç satır dönmez.
--
-- NOT (sözleşme sürümü): Bu ilk sürüm SKALER `returns text` döndürür ve bu
-- migration YEREL/uygulanmış DB'lerde ZATEN bu haliyle kayıtlı olabilir; bu
-- yüzden BURASI DEĞİŞTİRİLMEZ (uygulanmış bir migration'ı düzenlemek DB'yi
-- güncellemez ve temiz kurulumla ayrışmaya yol açar). Skaler `null`'ın "erişim
-- yok" ile "otomatik tercih"i ayırt edememesi, EKLEMELİ bir sonraki migration
-- (`..._upgrade_friend_level_rose_to_table`) ile `returns table` sözleşmesine
-- yükseltilerek giderilir.
create or replace function public.get_friend_level_rose(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select up.selected_level_rose
  from public.user_progress as up
  where (select auth.uid()) is not null
    and up.user_id = target_user_id
    and public.are_friends((select auth.uid()), target_user_id);
$$;

revoke all on function public.get_friend_level_rose(uuid) from public;
revoke all on function public.get_friend_level_rose(uuid) from anon;
grant execute on function public.get_friend_level_rose(uuid) to authenticated;

commit;
