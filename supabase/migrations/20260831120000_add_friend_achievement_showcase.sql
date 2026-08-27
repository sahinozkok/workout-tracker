/**
 * ARKADAŞ PROFİLİNDEKİ SEZON ROZETİ VİTRİNİ — salt okunur.
 *
 * KAPSAM
 * ------
 * Bu migration YALNIZCA yeni bir okuma RPC'si ekler. Hiçbir tablo, policy,
 * grant, tip veya mevcut fonksiyon DEĞİŞTİRİLMEZ. Özellikle
 * `public.season_rank_achievements` tablosunun RLS ve grant yapısına
 * DOKUNULMAZ: arkadaşlara doğrudan SELECT açılmaz, veri yalnızca bu
 * `security definer` fonksiyondan ve yalnızca kabul edilmiş arkadaşlık
 * doğrulandıktan sonra çıkar.
 *
 * Rozetler kozmetiktir: bu dosya RP, XP, level, gül veya rank tablolarına
 * HİÇBİR ŞEY yazmaz ve hiçbirini okumaz.
 *
 * GÜVENLİK SINIRI
 * ---------------
 *   * Aktif kullanıcı yalnızca `auth.uid()` ile belirlenir; oturum yoksa
 *     kontrollü yetki hatası verilir.
 *   * Arkadaşlık YALNIZCA `public.are_friends(auth.uid(), target_user_id)`
 *     ile doğrulanır. O fonksiyon `status = 'accepted'` şartını arar VE aktif
 *     kullanıcının ilişkinin tarafı olmasını zorunlu kılar; bekleyen,
 *     reddedilmiş veya taraf olunmayan ilişkiler veri göremez.
 *   * Sezon SUNUCUNUN `current_date` değerinden türetilir. İstemci sezon
 *     numarası GÖNDEREMEZ.
 *   * `security definer` + açık `set search_path = ''`; her nesne
 *     şema-nitelikli yazılır.
 *   * `public` ve `anon` execute yetkileri kaldırılır; yalnızca
 *     `authenticated` çalıştırabilir.
 *
 * DÖNMEYEN ALANLAR — e-posta, gül bakiyesi, level/XP, bio, hedef, workout
 * ayrıntısı, `rank_events`, RP geçmişi, ilerleme ve metadata bu yoldan HİÇ
 * çıkmaz. Yanıt yalnızca üç alan taşır.
 */

begin;

/**
 * Arkadaşın GÜNCEL sezondaki en yeni rozetleri.
 *
 * SIRALAMA — `unlocked_at desc`. Aynı zaman damgasında deterministik olsun
 * diye katalog sırası (`season_achievement_catalog().sort_order`) ikinci
 * anahtardır; bu olmadan eşit tarihli satırların sırası belirsiz kalırdı.
 * Katalogda bulunmayan bir anahtar (ileride eklenmiş bir rozet) en sona
 * düşer ve yanıtı bozmaz.
 *
 * SINIR — en fazla 3 satır. Sınırın otoritesi SUNUCUDUR; istemci güvenlik
 * için kırpma yapmaz.
 *
 * Yalnızca deftere GERÇEKTEN yazılmış satırlar döner: kilitli rozet, ilerleme
 * veya hedef bilgisi bu yanıtta yoktur.
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
  select
    a.season_index,
    a.achievement_key,
    a.unlocked_at
  from public.season_rank_achievements as a
  left join public.season_achievement_catalog() as c
    on c.achievement_key = a.achievement_key
  where (select auth.uid()) is not null
    and a.user_id = target_user_id
    -- Sunucu günü otoritedir; istemci sezon seçemez.
    and a.season_index = public.rank_season_index_for(current_date)
    -- Kabul edilmiş arkadaşlık DIŞINDA hiçbir satır dönmez.
    and public.are_friends((select auth.uid()), target_user_id)
  order by a.unlocked_at desc, coalesce(c.sort_order, 2147483647), a.achievement_key
  limit 3;
$$;

revoke all on function public.get_friend_season_achievement_showcase(uuid) from public;
revoke all on function public.get_friend_season_achievement_showcase(uuid) from anon;
grant execute on function public.get_friend_season_achievement_showcase(uuid) to authenticated;

comment on function public.get_friend_season_achievement_showcase(uuid) is
  'Returns up to three current-season cosmetic badges of an accepted friend. Read-only; no RP, XP or currency.';

commit;
