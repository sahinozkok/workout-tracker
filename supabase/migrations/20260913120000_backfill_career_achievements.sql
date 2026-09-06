/**
 * KARİYER BAŞARIMLARI — GEÇMİŞ VERİ BACKFILL'İ (EKLEMELİ, İDEMPOTENT)
 *
 * Amaç: yeni kalıcı sisteme geçerken kullanıcıların geçmişini KAYBETMEMEK.
 *
 * 1) ESKİ SEZON ROZETLERİ → KALICI ANAHTARLAR
 *    Kullanıcının HERHANGİ bir sezonda kazandığı eski rozet, yeni kalıcı
 *    defterde açılmış sayılır. En erken `unlocked_at` korunur (ilk kazanım anı).
 *    Eşleme:
 *      first_workout → first_step
 *      workout_5     → warmup_done
 *      workout_15    → rhythm_found
 *      streak_3      → three_day_spark
 *      streak_7      → weekly_flame
 *      perfect_week  → perfect_week
 *
 * 2) TÜRETİLEBİLİR İLERLEME BACKFILL'İ
 *    workout/set/cardio/hacim/level/rank/arkadaşlık/program/PR/mesaj/renk/rose
 *    gibi KAYNAKTAN yeniden hesaplanabilen başarımlar için AYRI backfill'e gerek
 *    YOKTUR: `sync_my_achievements` kariyer-geneli (sezon bağımsız) türetimi ilk
 *    çağrıda yapar ve tüm geçmişi yakalar (peak streak, toplam workout/set/hacim,
 *    max peak_rp vb. hepsi tüm zaman penceresinde hesaplanır). Bu migration o
 *    değerleri KOPYALAMAZ; yalnız sezon rozetlerini taşır (bunlar sezon-net
 *    kanıta dayandığı için türetimle birebir yeniden üretilemeyebilir).
 *
 * 3) KUTLAMA YAĞMURU YOK — bu migration yalnız DEFTERE yazar; kutlama tetikleme
 *    tamamen istemci baseline mantığındadır (kullanıcı+kalıcı-sistem sürümü).
 *    Backfill edilmiş açılmalar "geçmiş" sayılır ve kutlanmaz; yalnız geçişten
 *    SONRA yeni açılanlar kutlanır.
 *
 * GÜVENLİK — hiçbir ödül/ekonomi yazılmaz. Yalnız `career_achievements`'e ekler;
 * mevcut sezon tabloları/RPC'leri KORUNUR (silinmez). `on conflict do nothing`
 * ile tekrar çalıştırılabilir/idempotenttir. Kullanıcı verisi SİLİNMEZ.
 *
 * Not: `season_rank_achievements` tablosu yoksa (çok eski/temiz kurulum) bu blok
 * güvenle atlanır.
 */

begin;

do $$
begin
  if to_regclass('public.season_rank_achievements') is null then
    raise notice 'season_rank_achievements yok; sezon rozeti backfill atlandi';
    return;
  end if;

  insert into public.career_achievements (user_id, achievement_key, unlocked_at)
  select sra.user_id, m.new_key, min(sra.unlocked_at)
  from public.season_rank_achievements as sra
  join (values
    ('first_workout','first_step'),
    ('workout_5','warmup_done'),
    ('workout_15','rhythm_found'),
    ('streak_3','three_day_spark'),
    ('streak_7','weekly_flame'),
    ('perfect_week','perfect_week')
  ) as m(old_key, new_key) on m.old_key = sra.achievement_key
  group by sra.user_id, m.new_key
  on conflict on constraint career_achievements_pkey do nothing;
end $$;

commit;
