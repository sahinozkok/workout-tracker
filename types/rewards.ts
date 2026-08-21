/** Sunucunun döndürdüğü ilerleme özeti. Seviye SUNUCUDA hesaplanır. */
export type UserProgress = {
  lifetimeXp: number;
  roseBalance: number;
  level: number;
  /** Mevcut seviyede kazanılmış XP. */
  xpIntoLevel: number;
  /** Sonraki seviyeye gereken XP. 999'da 0 (MAX). */
  xpForNextLevel: number;
};

/**
 * Bir ödül çağrısının sonucu.
 *
 * `awardedXp` yalnızca **bu çağrıda gerçekten yazılan** ödüldür; olay daha önce
 * ödüllendirilmişse 0 döner ve hiçbir toplam değişmez. Popup yalnızca 0'dan
 * büyük değerde gösterilir.
 */
export type RewardResult = UserProgress & {
  awardedXp: number;
  awardedRoses: number;
};

/**
 * Günlük claim'in sonucu.
 *
 * `reconciliationPending` sunucudan gelir ve **hâlâ uzlaştırılmamış gün veya
 * hafta olduğunu** bildirir (batch sınırına takılmış geçmiş). İstemci o günü
 * yalnızca bu alan `false` iken tamamlanmış sayar; `true` ise sonraki
 * background→foreground geçişi kaldığı yerden devam eder. Polling kurulmaz.
 */
export type DailyClaimResult = RewardResult & {
  reconciliationPending: boolean;
};
