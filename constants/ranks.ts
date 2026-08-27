/**
 * SEZONLUK RANK SİSTEMİ — İSTEMCİ TARAFINDAKİ TEK KAYNAK
 *
 * Bu dosya `constants/level-curve.ts` ile AYNI kalıbı izler: eşikler burada ve
 * migration'da iki kez yazılır, ama ikisi de aynı fixture listesine karşı
 * doğrulanır (`scripts/verify-ranks.mjs` + migration içindeki `assert`
 * blokları). **Sunucu otoritedir**; buradaki saf fonksiyonlar yalnızca
 * (a) sunucu değeri gelmeden güvenli bir yerel karşılık üretmek ve (b) sınır
 * testleri için vardır.
 *
 * ÜRÜN AYRIMI — Rank, `lifetime_xp` / `rose_balance` / level eğrisinden
 * TAMAMEN ayrıdır. Rank yalnızca sezon içindeki doğrulanmış antrenman
 * disiplinini ölçer; XP veya gül üretmez, tüketmez ve seviyeyi etkilemez.
 *
 * BAĞIMSIZLIK KURALI — bu modülün hiçbir `import`u YOKTUR. Harness (`.mjs`)
 * dosyayı tek başına derleyip çalıştırabilsin diye bilinçli böyledir; buraya
 * tema, çeviri veya React bağımlılığı eklenmemelidir.
 */

/** Rank kimlikleri; düşükten yükseğe sıralıdır. */
export const RANK_IDS = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'rosea',
] as const;

export type RankId = (typeof RANK_IDS)[number];

export type RankTier = {
  id: RankId;
  /** Bu ranka girmek için gereken en düşük RP (dahil). */
  minRp: number;
  /** Sezon sonu soft reset tabanı. */
  resetBase: number;
  /** Soft reset sonucunun aşamayacağı üst sınır. */
  resetMax: number;
  /** Semantik tier rengi. Color preset sistemi bunu DEĞİŞTİREMEZ. */
  color: string;
};

/**
 * Rank tablosu — SQL'deki `public.rank_tier_floor` / `public.rank_reset_base`
 * fonksiyonlarıyla birebir aynı sayılar.
 *
 * Renkler bilinçli olarak semantiktir ve kullanıcının seçtiği color preset'ten
 * bağımsızdır: rank rengi bir kimlik göstergesidir, kişisel tema değil.
 */
export const RANK_TIERS: readonly RankTier[] = [
  { id: 'bronze', minRp: 0, resetBase: 0, resetMax: 199, color: '#CD7F32' },
  { id: 'silver', minRp: 200, resetBase: 100, resetMax: 199, color: '#A9A9B0' },
  { id: 'gold', minRp: 450, resetBase: 300, resetMax: 449, color: '#D9A441' },
  { id: 'platinum', minRp: 750, resetBase: 600, resetMax: 749, color: '#70C1B3' },
  { id: 'diamond', minRp: 1050, resetBase: 900, resetMax: 1049, color: '#4DA3FF' },
  { id: 'master', minRp: 1350, resetBase: 1150, resetMax: 1349, color: '#8B5CF6' },
  { id: 'rosea', minRp: 1650, resetBase: 1450, resetMax: 1649, color: '#E85D9E' },
];

/** Sezon uzunluğu — tam 8 hafta. */
export const SEASON_LENGTH_DAYS = 56;

/** Sezon sonunda taşan RP'nin bir sonraki sezona aktarılan oranı. */
export const SOFT_RESET_CARRY_RATIO = 0.2;

/**
 * RP ödül miktarları — SQL'deki `public.rank_rp_amount` ile aynı.
 *
 * `scheduledPartial` + `scheduledCompleteTopUp` = `scheduledCompleteTotal`
 * eşitliği KASITLIDIR: kısmi tamamlanan bir gün sonradan tamamlanınca toplam
 * 25'i aşmaz, yalnızca fark eklenir.
 */
export const RANK_RP = {
  /** Planlı gün kısmen tamamlandı. */
  scheduledPartial: 10,
  /** Kısmi gün TAM tamamlanınca eklenen fark. */
  scheduledCompleteTopUp: 15,
  /** Planlı gün tam tamamlandığında ulaşılan TOPLAM. */
  scheduledCompleteTotal: 25,
  /** Plan dışı, doğrulanmış tamamlanmış antrenman. */
  unscheduledWorkout: 15,
  /** Kapanmış haftadaki bütün planlı günler tam tamamlandı. */
  weeklyPerfect: 25,
} as const;

/** Streak kilometre taşları — kullanıcı başına ÖMÜR BOYU bir kez. */
export const RANK_STREAK_MILESTONES: readonly { days: number; rp: number }[] = [
  { days: 7, rp: 25 },
  { days: 30, rp: 75 },
  { days: 100, rp: 200 },
];

/** RP hiçbir koşulda negatif olamaz. */
export function clampRp(rp: number): number {
  if (!Number.isFinite(rp)) return 0;
  return Math.max(0, Math.floor(rp));
}

/** Verilen RP'nin rankı. Negatif ve geçersiz değerler Bronze'a düşer. */
export function resolveRank(rp: number): RankTier {
  const safeRp = clampRp(rp);
  let resolved = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (safeRp >= tier.minRp) resolved = tier;
  }
  return resolved;
}

/** Bir sonraki rank; en yüksek rankta `undefined`. */
export function nextRank(rp: number): RankTier | undefined {
  const current = resolveRank(rp);
  const index = RANK_TIERS.findIndex((tier) => tier.id === current.id);
  return RANK_TIERS[index + 1];
}

/** Bir sonraki ranka kalan RP. En yüksek rankta 0. */
export function rpToNextRank(rp: number): number {
  const upcoming = nextRank(rp);
  if (!upcoming) return 0;
  return Math.max(0, upcoming.minRp - clampRp(rp));
}

/**
 * Mevcut rank içindeki ilerleme oranı (0–1).
 * En yüksek rankta bar tamamen dolu gösterilir.
 */
export function rankFillRatio(rp: number): number {
  const safeRp = clampRp(rp);
  const current = resolveRank(safeRp);
  const upcoming = nextRank(safeRp);
  if (!upcoming) return 1;
  const span = upcoming.minRp - current.minRp;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (safeRp - current.minRp) / span));
}

/**
 * Sezon sonu soft reset.
 *
 * `newRp = min(destinationMaximum, resetBase + floor((finalRp - rankFloor) * 0.20))`
 *
 * Örnek: 1850 RP ile Rosea biten kullanıcı → taşma 200 → %20 = 40 →
 * 1450 + 40 = 1490 → yeni sezona **Master** olarak başlar.
 */
export function softResetRp(finalRp: number): number {
  const safeRp = clampRp(finalRp);
  const tier = resolveRank(safeRp);
  const overflow = safeRp - tier.minRp;
  const carried = Math.floor(overflow * SOFT_RESET_CARRY_RATIO);
  return Math.min(tier.resetMax, tier.resetBase + carried);
}

// ---------------------------------------------------------------------------
// Sezon takvimi — cron GEREKTİRMEZ, tarihten deterministik türetilir
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` → UTC gün başlangıcı. Saat dilimi kayması üretmez. */
function parseDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

/** UTC zaman damgası → `YYYY-MM-DD`. */
function toDateKeyUtc(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** İki tarih anahtarı arasındaki tam gün farkı. */
export function daysBetween(fromDateKey: string, toDateKey: string): number {
  return Math.round((parseDateKey(toDateKey) - parseDateKey(fromDateKey)) / MS_PER_DAY);
}

/** Verilen tarihi içeren ISO haftasının PAZARTESİ günü. */
export function mondayOf(dateKey: string): string {
  const timestamp = parseDateKey(dateKey);
  // `getUTCDay()`: 0 = Pazar. ISO'da Pazartesi 1, Pazar 7 olmalı.
  const isoWeekday = new Date(timestamp).getUTCDay() || 7;
  return toDateKeyUtc(timestamp - (isoWeekday - 1) * MS_PER_DAY);
}

export function addDays(dateKey: string, days: number): string {
  return toDateKeyUtc(parseDateKey(dateKey) + days * MS_PER_DAY);
}

/** `index` numaralı sezonun başlangıç (Pazartesi) tarihi. Sezonlar 1'den başlar. */
export function seasonStartFor(anchorMonday: string, seasonIndex: number): string {
  const safeIndex = Math.max(1, Math.floor(seasonIndex));
  return addDays(anchorMonday, (safeIndex - 1) * SEASON_LENGTH_DAYS);
}

/** `index` numaralı sezonun bitiş (Pazar) tarihi. */
export function seasonEndFor(anchorMonday: string, seasonIndex: number): string {
  return addDays(seasonStartFor(anchorMonday, seasonIndex), SEASON_LENGTH_DAYS - 1);
}

/**
 * Verilen tarihin hangi sezona düştüğü. Çapadan önceki tarihler için 1 döner
 * (retroaktif sezon üretilmez).
 */
export function seasonIndexFor(anchorMonday: string, dateKey: string): number {
  const offset = daysBetween(anchorMonday, dateKey);
  if (offset < 0) return 1;
  return Math.floor(offset / SEASON_LENGTH_DAYS) + 1;
}

/** Sezonun bitmesine kalan tam gün sayısı. Bitmişse 0. */
export function daysRemainingInSeason(seasonEndDateKey: string, todayDateKey: string): number {
  return Math.max(0, daysBetween(todayDateKey, seasonEndDateKey));
}

// ---------------------------------------------------------------------------
// Sınır fixture'ları — migration'daki `assert` bloklarıyla BİREBİR aynı
// ---------------------------------------------------------------------------

/** `[rp, beklenenRankId]`. */
export const RANK_THRESHOLD_FIXTURES: readonly (readonly [number, RankId])[] = [
  [-100, 'bronze'],
  [0, 'bronze'],
  [199, 'bronze'],
  [200, 'silver'],
  [449, 'silver'],
  [450, 'gold'],
  [749, 'gold'],
  [750, 'platinum'],
  [1049, 'platinum'],
  [1050, 'diamond'],
  [1349, 'diamond'],
  [1350, 'master'],
  [1649, 'master'],
  [1650, 'rosea'],
  [999999, 'rosea'],
];

/** `[finalRp, beklenenYeniSezonRp]`. */
export const RANK_SOFT_RESET_FIXTURES: readonly (readonly [number, number])[] = [
  // Bronze: taban 0, tavan 199.
  [0, 0],
  [199, 39],
  // Silver: taban 100, tavan 199. 449 → 100 + floor(249*0.2)=49 → 149.
  [200, 100],
  [449, 149],
  // Gold: taban 300, tavan 449. 749 → 300 + floor(299*0.2)=59 → 359.
  [450, 300],
  [749, 359],
  // Platinum: taban 600, tavan 749.
  [750, 600],
  [1049, 659],
  // Diamond: taban 900, tavan 1049.
  [1050, 900],
  [1349, 959],
  // Master: taban 1150, tavan 1349.
  [1350, 1150],
  [1649, 1209],
  // Rosea: taban 1450, tavan 1649. Görevdeki örnek: 1850 → 1490.
  [1650, 1450],
  [1850, 1490],
  // Tavan gerçekten bağlayıcı: 2650 → 1450 + floor(1000*0.2)=200 → 1650 > 1649.
  [2650, 1649],
  [99999, 1649],
];
