import { achievementSortIndex, AchievementKey } from '@/constants/achievement-order';

/**
 * SAF kutlama uzlaştırması (React'ten bağımsız → test edilebilir).
 *
 * SÖZLEŞME — bir başarım YALNIZCA overlay GERÇEKTEN gösterilip kapandığında
 * (kullanıcı dokunur ya da otomatik kapanır) `acknowledged`'e eklenir. Bu
 * fonksiyon `acknowledged`'i BÜYÜTMEZ (baseline hariç): yalnız kuyruğa GİRECEK
 * yeni açılışları döndürür. Böylece uygulama overlay gösterilmeden kapanırsa
 * başarım onaylanmamış kalır ve bir sonraki açılışta yeniden bulunur.
 *
 *   * `acknowledged === undefined` (ilk başarılı yükleme = BASELINE): mevcut
 *     açıklar sessizce onaylanır (`baseline` döner), HİÇBİRİ kutlanmaz →
 *     backfill/geçiş yağmuru olmaz.
 *   * Aksi hâlde: `acknowledged`'de OLMAYAN ve halihazırda KUYRUKTA olmayan açık
 *     başarımlar, KATALOG SIRASINDA `toEnqueue` olur. `acknowledged` burada
 *     değişmez (onaylama `ack` anında yapılır).
 *
 * Hata/yarım yükleme durumunda çağıran bu fonksiyonu ÇAĞIRMAZ (baseline/queue
 * yalnız başarılı yükleme sonrası).
 */
export function reconcileCelebrations(
  unlockedKeys: AchievementKey[],
  acknowledged: Set<AchievementKey> | undefined,
  queued: Set<AchievementKey>,
): { toEnqueue: AchievementKey[]; baseline: Set<AchievementKey> | undefined } {
  if (!acknowledged) {
    return { baseline: new Set(unlockedKeys), toEnqueue: [] };
  }
  const toEnqueue = unlockedKeys
    .filter((k) => !acknowledged.has(k) && !queued.has(k))
    .sort((a, b) => achievementSortIndex(a) - achievementSortIndex(b));
  return { baseline: undefined, toEnqueue };
}
