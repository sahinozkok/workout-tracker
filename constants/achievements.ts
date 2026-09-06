import { AchievementKey } from '@/constants/achievement-order';

export type { AchievementKey } from '@/constants/achievement-order';

/**
 * KARİYER BAŞARIMLARI — İSTEMCİ TEK KAYNAK KATALOĞU (sezondan bağımsız, kalıcı).
 *
 * Bu katalog SUNUCU `achievement_catalog()` ile BİREBİR aynıdır (anahtar,
 * kategori, hedef, sıra). Parite `scripts/verify-career-achievements.mjs` ile
 * kilitlenir. İlerleme ve kilit durumu SUNUCUDAN gelir; istemci yalnız gösterir
 * ve BİÇİMLENDİRİR (km/dakika/kg). İstemci sayaç ÜRETMEZ.
 *
 * `easy/medium/hard` yalnız SUNUM kategorisidir; ekonomik ödül yoktur.
 */

export type AchievementCategory = 'easy' | 'medium' | 'hard';
export type AchievementProgressKind = 'boolean' | 'count';

/** Sunucu ilerlemesinin GÖSTERİM birimi (ham birim sunucuda güvende kalır). */
export type AchievementUnit = 'plain' | 'distance_km' | 'duration_min' | 'volume_kg';

export type AchievementCatalogEntry = {
  key: AchievementKey;
  category: AchievementCategory;
  target: number;
  sort: number;
  kind: AchievementProgressKind;
  /** Ekranda ilerleme/hedef nasıl biçimlenir. Sunucu ham birimi (m/sn/kg) tutar. */
  unit: AchievementUnit;
};

/**
 * SUNUCU KATALOĞUNUN AYNASI — sıra, kategori ve hedefler `achievement_catalog()`
 * ile birebir. Ham hedef birimleri sunucudakiyle AYNIDIR: mesafe metre, süre
 * saniye, hacim kg (biçimlendirme yalnız GÖSTERİMDE yapılır).
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementCatalogEntry[] = [
  { key: 'first_step', category: 'easy', target: 1, sort: 1, kind: 'boolean', unit: 'plain' },
  { key: 'warmup_done', category: 'easy', target: 5, sort: 2, kind: 'count', unit: 'plain' },
  { key: 'rhythm_found', category: 'easy', target: 15, sort: 3, kind: 'count', unit: 'plain' },
  { key: 'three_day_spark', category: 'easy', target: 3, sort: 4, kind: 'count', unit: 'plain' },
  { key: 'weekly_flame', category: 'easy', target: 7, sort: 5, kind: 'count', unit: 'plain' },
  { key: 'perfect_week', category: 'easy', target: 1, sort: 6, kind: 'boolean', unit: 'plain' },
  { key: 'own_path', category: 'easy', target: 1, sort: 7, kind: 'boolean', unit: 'plain' },
  { key: 'pulse_rising', category: 'easy', target: 1, sort: 8, kind: 'boolean', unit: 'plain' },
  { key: 'wise_counsel', category: 'easy', target: 1, sort: 9, kind: 'boolean', unit: 'plain' },
  { key: 'social_step', category: 'easy', target: 1, sort: 10, kind: 'boolean', unit: 'plain' },
  { key: 'new_perspective', category: 'medium', target: 1, sort: 11, kind: 'boolean', unit: 'plain' },
  { key: 'first_message', category: 'medium', target: 1, sort: 12, kind: 'boolean', unit: 'plain' },
  { key: 'rose_bud', category: 'medium', target: 1, sort: 13, kind: 'boolean', unit: 'plain' },
  { key: 'first_rank_up', category: 'medium', target: 1, sort: 14, kind: 'boolean', unit: 'plain' },
  { key: 'cardio_discipline', category: 'medium', target: 10, sort: 15, kind: 'count', unit: 'plain' },
  { key: 'strong_circle', category: 'medium', target: 5, sort: 16, kind: 'count', unit: 'plain' },
  { key: 'ten_ton_club', category: 'medium', target: 10000, sort: 17, kind: 'count', unit: 'volume_kg' },
  { key: 'program_loyalty', category: 'medium', target: 14, sort: 18, kind: 'count', unit: 'plain' },
  { key: 'pr_hunter', category: 'medium', target: 3, sort: 19, kind: 'count', unit: 'plain' },
  { key: 'half_century', category: 'medium', target: 50, sort: 20, kind: 'count', unit: 'plain' },
  { key: 'full_bloom', category: 'hard', target: 200, sort: 21, kind: 'count', unit: 'plain' },
  { key: 'on_the_podium', category: 'hard', target: 1, sort: 22, kind: 'boolean', unit: 'plain' },
  { key: 'rosea_rank', category: 'hard', target: 1, sort: 23, kind: 'boolean', unit: 'plain' },
  { key: 'cardio_traveler', category: 'hard', target: 100000, sort: 24, kind: 'count', unit: 'distance_km' },
  { key: 'against_time', category: 'hard', target: 30000, sort: 25, kind: 'count', unit: 'duration_min' },
  { key: 'quarter_million', category: 'hard', target: 250000, sort: 26, kind: 'count', unit: 'volume_kg' },
  { key: 'thirty_day_discipline', category: 'hard', target: 30, sort: 27, kind: 'count', unit: 'plain' },
  { key: 'iron_will_100', category: 'hard', target: 100, sort: 28, kind: 'count', unit: 'plain' },
  { key: 'thousand_sets', category: 'hard', target: 1000, sort: 29, kind: 'count', unit: 'plain' },
  { key: 'coach_to_the_top', category: 'hard', target: 30, sort: 30, kind: 'count', unit: 'plain' },
];

const CATALOG_BY_KEY: Record<AchievementKey, AchievementCatalogEntry> = Object.fromEntries(
  ACHIEVEMENT_CATALOG.map((e) => [e.key, e]),
) as Record<AchievementKey, AchievementCatalogEntry>;

export function achievementEntry(key: AchievementKey): AchievementCatalogEntry {
  return CATALOG_BY_KEY[key];
}

const KEY_SET = new Set<string>(ACHIEVEMENT_CATALOG.map((e) => e.key));
export function isAchievementKey(value: unknown): value is AchievementKey {
  return typeof value === 'string' && KEY_SET.has(value);
}

export const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = ['easy', 'medium', 'hard'];

/** Kategoriye göre sabit sırada gruplar (ekran bölümleri için). */
export function achievementsByCategory(category: AchievementCategory): AchievementCatalogEntry[] {
  return ACHIEVEMENT_CATALOG.filter((e) => e.category === category).sort((a, b) => a.sort - b.sort);
}

/**
 * TEK GÖRSEL KAYNAK — 30 kalıcı kariyer başarımının organik sembol asset'leri.
 *
 * Değerler YEREL PNG modül kimlikleridir (`require(...)` → `number`); bütün
 * `require` çağrıları statik ve açıktır (Metro dinamik yol çözemez) ve doğrudan
 * React Native `Image` `source` prop'una verilir (bkz. `level-rose-emblem.tsx`
 * LEVEL_ROSE_SOURCES deseni). Assetler 1254×1254 RGBA, şeffaf ve düz `#D5755B`
 * çizilmiştir; paylaşılan `AchievementSymbol` bileşeni bunları `tintColor` ile
 * alfa-maske olarak boyar (açık = profil accent, kilitli = tema tersiyer).
 *
 * 30 anahtarın HEPSİ tam olarak bir kez kapsanır; eksik anahtar tip hatasıdır
 * (sessiz Ionicon geri düşüşü YOKTUR).
 */
export const ACHIEVEMENT_VISUALS: Record<AchievementKey, number> = {
  first_step: require('@/assets/achievements/career/first_step.png'),
  warmup_done: require('@/assets/achievements/career/warmup_done.png'),
  rhythm_found: require('@/assets/achievements/career/rhythm_found.png'),
  three_day_spark: require('@/assets/achievements/career/three_day_spark.png'),
  weekly_flame: require('@/assets/achievements/career/weekly_flame.png'),
  perfect_week: require('@/assets/achievements/career/perfect_week.png'),
  own_path: require('@/assets/achievements/career/own_path.png'),
  pulse_rising: require('@/assets/achievements/career/pulse_rising.png'),
  wise_counsel: require('@/assets/achievements/career/wise_counsel.png'),
  social_step: require('@/assets/achievements/career/social_step.png'),
  new_perspective: require('@/assets/achievements/career/new_perspective.png'),
  first_message: require('@/assets/achievements/career/first_message.png'),
  rose_bud: require('@/assets/achievements/career/rose_bud.png'),
  first_rank_up: require('@/assets/achievements/career/first_rank_up.png'),
  cardio_discipline: require('@/assets/achievements/career/cardio_discipline.png'),
  strong_circle: require('@/assets/achievements/career/strong_circle.png'),
  ten_ton_club: require('@/assets/achievements/career/ten_ton_club.png'),
  program_loyalty: require('@/assets/achievements/career/program_loyalty.png'),
  pr_hunter: require('@/assets/achievements/career/pr_hunter.png'),
  half_century: require('@/assets/achievements/career/half_century.png'),
  full_bloom: require('@/assets/achievements/career/full_bloom.png'),
  on_the_podium: require('@/assets/achievements/career/on_the_podium.png'),
  rosea_rank: require('@/assets/achievements/career/rosea_rank.png'),
  cardio_traveler: require('@/assets/achievements/career/cardio_traveler.png'),
  against_time: require('@/assets/achievements/career/against_time.png'),
  quarter_million: require('@/assets/achievements/career/quarter_million.png'),
  thirty_day_discipline: require('@/assets/achievements/career/thirty_day_discipline.png'),
  iron_will_100: require('@/assets/achievements/career/iron_will_100.png'),
  thousand_sets: require('@/assets/achievements/career/thousand_sets.png'),
  coach_to_the_top: require('@/assets/achievements/career/coach_to_the_top.png'),
};

/**
 * SUNUCU ham ilerlemesini GÖSTERİM için biçimler (ham birim sunucuda kalır):
 *   * distance_km  → metre → km (bir ondalık),
 *   * duration_min → saniye → dakika (tam),
 *   * volume_kg    → kg (binlik ayraçlı),
 *   * plain        → tam sayı.
 * Boolean başarımlar 0/1 döner (kind='boolean').
 */
export function formatAchievementValue(entry: AchievementCatalogEntry, rawValue: number): string {
  switch (entry.unit) {
    case 'distance_km':
      return `${(rawValue / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
    case 'duration_min':
      return `${Math.floor(rawValue / 60).toLocaleString()} dk`;
    case 'volume_kg':
      return `${Math.round(rawValue).toLocaleString()} kg`;
    default:
      return rawValue.toLocaleString();
  }
}

/**
 * 30 başarımın HEPSİNİN gerçek sunucu kaynağı vardır (podyum: kapanmış haftalık
 * lider tablosu; coach_to_the_top: workout'a bağlı AI analiz defteri). Sürekli
 * 0'a sabitlenmiş başarım YOKTUR. Bu liste boştur; bir başarım geçici olarak
 * kaynaksız kalırsa buraya eklenir ve UI onu nötr gösterir (uydurma durum yok).
 */
export const ACHIEVEMENTS_PENDING_SOURCE: readonly AchievementKey[] = [];
