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
