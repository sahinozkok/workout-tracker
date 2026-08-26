import { withAlpha } from '@/constants/color-presets';
import { ProgramIconName, WorkoutVisual } from '@/types/workout';

export const DEFAULT_PROGRAM_VISUAL: WorkoutVisual = { type: 'icon', icon: 'barbell-outline' };
export const DEFAULT_EXERCISE_VISUAL: WorkoutVisual = { type: 'icon', icon: 'fitness-outline' };

export function getProgramVisual(visual: WorkoutVisual | undefined, legacyIcon?: ProgramIconName): WorkoutVisual {
  if (visual) return visual;
  return { type: 'icon', icon: legacyIcon ?? 'barbell-outline' };
}

export function getDayVisual(visual: WorkoutVisual | undefined, index: number): WorkoutVisual {
  return visual ?? { type: 'text', text: String(index + 1) };
}

export function getExerciseVisual(visual: WorkoutVisual | undefined): WorkoutVisual {
  return visual ?? DEFAULT_EXERCISE_VISUAL;
}

/**
 * Hazır (vector) program ikonunun ZEMİNİ.
 *
 * Eskiden `colors.primarySoft` ile sabit maviydi; artık Workout Days
 * presetinden düşük opaklıkla türetilir, böylece ön plan ve arka plan preset
 * değiştiğinde BİRLİKTE güncellenir ve reset sonrası varsayılana döner.
 *
 * Yalnızca `type: 'icon'` için uygulanır: emoji/sayı (`text`) ve eski `image`
 * kayıtları bugünkü zeminlerinde kalır — onlara yapay accent zemini verilmez.
 * Boyut, radius ve yerleşim sarmalayıcı stilde kalır; yalnızca renk değişir.
 */
export function getProgramIconBackground(visual: WorkoutVisual, accent: string, isDark: boolean) {
  if (visual.type !== 'icon') return undefined;
  return { backgroundColor: withAlpha(accent, isDark ? 0.18 : 0.12) };
}
