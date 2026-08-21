/**
 * Seviye eğrisi — istemci tarafındaki kaynağı.
 *
 * Aynı eşik tablosu SQL tarafında `public.level_step_cost` /
 * `public.level_progress` içinde yaşar ve **sunucu otoritedir**: ekranlarda
 * gösterilen seviye her zaman RPC'den gelen değerdir. Buradaki saf fonksiyon
 * yalnızca (a) sunucu değeri henüz gelmemişken güvenli bir yerel karşılık
 * üretmek ve (b) sınırların iki tarafta da aynı olduğunu doğrulayan testler
 * için vardır.
 *
 * İki tarafın ayrışmasını engelleyen üç katman:
 *   1. `LEVEL_CURVE_FIXTURES` aşağıda tek yerde tanımlıdır.
 *   2. Migration aynı sınırları `do $$ assert ... $$` bloğunda doğrular;
 *      SQL yanlışsa migration uygulanmaz.
 *   3. `scripts/verify-level-curve.mjs` derlenmiş TypeScript'i aynı sınırlara
 *      karşı çalıştırır.
 */

/** Seviye tavanı. Bu seviyeden sonra XP kazanılmaya devam eder, seviye artmaz. */
export const MAX_LEVEL = 999;

/** Verilen seviyeden BİR SONRAKİ seviyeye geçmenin XP maliyeti. */
export function levelStepCost(currentLevel: number): number {
  if (currentLevel < 1) return 0;
  if (currentLevel === 1) return 120; // 1 → 2
  if (currentLevel < 5) return 150; // 2 → 3, 3 → 4, 4 → 5
  if (currentLevel < 10) return 200; // 5 → 6 … 9 → 10
  if (currentLevel < 15) return 250; // 10 → 11 … 14 → 15
  if (currentLevel < 99) return 300; // 15 → 16 … 98 → 99
  if (currentLevel < MAX_LEVEL) return 400; // 99 → 100 … 998 → 999
  return 0; // tavan
}

export type LevelProgress = {
  level: number;
  /** Mevcut seviyede kazanılmış XP. 999'da 0. */
  xpIntoLevel: number;
  /** Sonraki seviyeye gereken XP. 999'da 0 (MAX). */
  xpForNextLevel: number;
};

/**
 * Yaşam boyu XP → seviye ve seviye içi ilerleme. Saf ve deterministiktir.
 *
 * Kümülatif eşikler: L2 = 120, L3 = 270, L5 = 570, L10 = 1570, L15 = 2820,
 * L99 = 28020, L999 = 388020.
 */
export function resolveLevelProgress(totalXp: number): LevelProgress {
  let remaining = Number.isFinite(totalXp) ? Math.max(Math.floor(totalXp), 0) : 0;
  let level = 1;

  while (level < MAX_LEVEL) {
    const stepCost = levelStepCost(level);
    if (remaining < stepCost) return { level, xpForNextLevel: stepCost, xpIntoLevel: remaining };
    remaining -= stepCost;
    level += 1;
  }

  return { level: MAX_LEVEL, xpForNextLevel: 0, xpIntoLevel: 0 };
}

/** İlerleme oranı 0–1. 999'da bar tamamen dolu gösterilir. */
export function levelFillRatio(progress: LevelProgress): number {
  if (progress.xpForNextLevel <= 0) return 1;
  return Math.min(1, Math.max(0, progress.xpIntoLevel / progress.xpForNextLevel));
}

/**
 * Sınır beklentileri — migration'daki `assert` bloğuyla birebir aynı çiftler.
 * `[lifetimeXp, beklenenSeviye]`.
 */
export const LEVEL_CURVE_FIXTURES: readonly (readonly [number, number])[] = [
  [-50, 1],
  [0, 1],
  [119, 1],
  [120, 2],
  [269, 2],
  [270, 3],
  [569, 4],
  [570, 5],
  [1569, 9],
  [1570, 10],
  [2819, 14],
  [2820, 15],
  [28019, 98],
  [28020, 99],
  [388019, 998],
  [388020, 999],
  [999999999, 999],
];
