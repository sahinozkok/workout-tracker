/**
 * ARKADAŞ GÜLÜ OKUMASI — SÖZLEŞME YÜKSELTMESİ (EKLEMELİ, GERİYE UYUMLU)
 *
 * NEDEN AYRI MIGRATION: `20260910120000_add_level_rose_selection.sql`
 * `get_friend_level_rose`'u SKALER `returns text` olarak tanımlar ve bu haliyle
 * yerel/uygulanmış veritabanlarına ZATEN uygulanmış olabilir. Uygulanmış bir
 * migration dosyasını düzenlemek çalışan DB'yi GÜNCELLEMEZ ve temiz kurulumla
 * ayrışmaya yol açar. Bu yüzden değişiklik BENZERSİZ, EKLEMELİ bu yeni
 * migration'a taşınır.
 *
 * SORUN: Skaler `returns text` yanıtında `null` İKİ AYRI durumu temsil ediyordu
 * ve bunlar AYIRT EDİLEMİYORDU:
 *   * arkadaş DEĞİL / engellenmiş (satır yok → PostgREST `null`),
 *   * arkadaş VE otomatik mod (satır var, `selected_level_rose = null`).
 * Bu belirsizlik "erişim reddi"nin sessizce "otomatik tercih" gibi sunulmasına
 * yol açabiliyordu.
 *
 * ÇÖZÜM: `returns table(selected_level_rose text)`.
 *   * Erişim VAR (arkadaş): TAM BİR satır döner (`selected_level_rose` null
 *     olabilir = arkadaşın gerçek OTOMATİK tercihi).
 *   * Erişim YOK: HİÇ satır dönmez → istemci `denied` (nötr placeholder) sayar.
 *
 * DEĞİŞMEYENLER — Gizlilik yüzeyi GENİŞLEMEZ: aynı `are_friends` kapısı, aynı
 * `security definer`, aynı grant/revoke. Yalnız seçili gül kimliği paylaşılır;
 * XP/RP/roses/özel veri HİÇ gelmez. Veri sıfırlanmaz; yalnız fonksiyon imzası
 * yükseltilir.
 *
 * YOLLAR:
 *   * TEMİZ KURULUM: mig 20260910 skaleri oluşturur, bu migration onu tabloya
 *     yükseltir → nihai durum `returns table`.
 *   * ESKİ SÖZLEŞMEDEN YÜKSELTME: DB'de zaten skaler varsa `drop ... if exists`
 *     onu düşürür ve tabloyu oluşturur → nihai durum `returns table`.
 * Her iki yol da aynı sonuca ulaşır (izole test her ikisini de doğrular).
 */

begin;

-- Dönüş tipi değiştiği için `create or replace` YETMEZ; önce eski imza düşürülür.
-- `if exists` sayesinde skalerin hiç uygulanmadığı temiz DB'de de güvenlidir.
drop function if exists public.get_friend_level_rose(uuid);

create function public.get_friend_level_rose(target_user_id uuid)
returns table (selected_level_rose text)
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
