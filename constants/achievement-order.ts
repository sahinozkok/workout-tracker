/**
 * Kariyer başarım ANAHTARLARI ve SABİT SIRASI — bağımsız (React/asset importu
 * YOK) tek kaynak. `constants/achievements.ts` (görsel/katalog) ve saf yardımcılar
 * (kutlama uzlaştırması) buradan türer; böylece saf mantık asset importuna
 * bağlanmadan derlenip test edilebilir. Sıra `achievement_catalog()` ile birebir.
 */
export type AchievementKey =
  | 'first_step' | 'warmup_done' | 'rhythm_found' | 'three_day_spark' | 'weekly_flame'
  | 'perfect_week' | 'own_path' | 'pulse_rising' | 'wise_counsel' | 'social_step'
  | 'new_perspective' | 'first_message' | 'rose_bud' | 'first_rank_up' | 'cardio_discipline'
  | 'strong_circle' | 'ten_ton_club' | 'program_loyalty' | 'pr_hunter' | 'half_century'
  | 'full_bloom' | 'on_the_podium' | 'rosea_rank' | 'cardio_traveler' | 'against_time'
  | 'quarter_million' | 'thirty_day_discipline' | 'iron_will_100' | 'thousand_sets' | 'coach_to_the_top';

export const ACHIEVEMENT_ORDER: readonly AchievementKey[] = [
  'first_step', 'warmup_done', 'rhythm_found', 'three_day_spark', 'weekly_flame',
  'perfect_week', 'own_path', 'pulse_rising', 'wise_counsel', 'social_step',
  'new_perspective', 'first_message', 'rose_bud', 'first_rank_up', 'cardio_discipline',
  'strong_circle', 'ten_ton_club', 'program_loyalty', 'pr_hunter', 'half_century',
  'full_bloom', 'on_the_podium', 'rosea_rank', 'cardio_traveler', 'against_time',
  'quarter_million', 'thirty_day_discipline', 'iron_will_100', 'thousand_sets', 'coach_to_the_top',
];

const ORDER_INDEX = new Map(ACHIEVEMENT_ORDER.map((k, i) => [k, i]));
export function achievementSortIndex(key: AchievementKey): number {
  return ORDER_INDEX.get(key) ?? Number.MAX_SAFE_INTEGER;
}
