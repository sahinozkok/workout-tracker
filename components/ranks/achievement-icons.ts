import { Ionicons } from '@expo/vector-icons';

import { SeasonAchievementKey } from '@/constants/rank-experience';

/**
 * Sezon başarılarının ikon eşlemesi — TEK kaynak.
 *
 * Hem rank ekranındaki rozet kartları hem açılma kutlaması buradan okur;
 * eşleme iki yerde KOPYALANMAZ. Yeni görsel/asset eklenmez: yalnızca mevcut
 * Ionicons setinden sade simgeler kullanılır.
 */
export const ACHIEVEMENT_ICONS: Record<SeasonAchievementKey, keyof typeof Ionicons.glyphMap> = {
  first_workout: 'footsteps-outline',
  workout_5: 'barbell-outline',
  workout_15: 'trophy-outline',
  streak_3: 'flame-outline',
  streak_7: 'flame',
  perfect_week: 'checkmark-done-outline',
};
