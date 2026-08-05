import { WorkoutSetRecord } from '@/types/workout';

export type ExerciseProgressPoint = {
  completedSets: number;
  dateKey: string;
  maxRepetitions?: number;
  maxWeightKg?: number;
  totalVolumeKg: number;
};

export type ExerciseAnalytics = {
  bestRepetitionSet?: WorkoutSetRecord;
  bestVolumeSet?: WorkoutSetRecord;
  bestWeightSet?: WorkoutSetRecord;
  exerciseKey: string;
  exerciseName: string;
  latestSet?: WorkoutSetRecord;
  points: ExerciseProgressPoint[];
  totalSets: number;
  totalVolumeKg: number;
};

function normalizeExerciseName(exerciseName: string) {
  return exerciseName.trim().toLocaleLowerCase('tr-TR');
}

function getSetVolume(workoutSet: WorkoutSetRecord) {
  return (workoutSet.weightKg ?? 0) * (workoutSet.repetitions ?? 0);
}

function getBestSet(
  sets: WorkoutSetRecord[],
  getValue: (workoutSet: WorkoutSetRecord) => number | undefined,
) {
  return sets.reduce<WorkoutSetRecord | undefined>((bestSet, workoutSet) => {
    const value = getValue(workoutSet);
    if (value === undefined) return bestSet;
    if (!bestSet) return workoutSet;

    const bestValue = getValue(bestSet);
    if (bestValue === undefined || value > bestValue) return workoutSet;
    if (value === bestValue && workoutSet.completedAt > bestSet.completedAt) return workoutSet;
    return bestSet;
  }, undefined);
}

export function buildExerciseAnalytics(workoutSets: WorkoutSetRecord[]) {
  const exerciseGroups = new Map<string, WorkoutSetRecord[]>();

  workoutSets.forEach((workoutSet) => {
    const exerciseKey = normalizeExerciseName(workoutSet.exerciseName);
    const currentSets = exerciseGroups.get(exerciseKey) ?? [];
    currentSets.push(workoutSet);
    exerciseGroups.set(exerciseKey, currentSets);
  });

  return Array.from(exerciseGroups.entries())
    .map<ExerciseAnalytics>(([exerciseKey, groupedSets]) => {
      const sets = [...groupedSets].sort((first, second) => first.completedAt.localeCompare(second.completedAt));
      const dateGroups = new Map<string, WorkoutSetRecord[]>();

      sets.forEach((workoutSet) => {
        const dateSets = dateGroups.get(workoutSet.dateKey) ?? [];
        dateSets.push(workoutSet);
        dateGroups.set(workoutSet.dateKey, dateSets);
      });

      const points = Array.from(dateGroups.entries())
        .map<ExerciseProgressPoint>(([dateKey, dateSets]) => {
          const weights = dateSets.flatMap((workoutSet) =>
            workoutSet.weightKg === undefined ? [] : [workoutSet.weightKg],
          );
          const repetitions = dateSets.flatMap((workoutSet) =>
            workoutSet.repetitions === undefined ? [] : [workoutSet.repetitions],
          );

          return {
            completedSets: dateSets.length,
            dateKey,
            maxRepetitions: repetitions.length > 0 ? Math.max(...repetitions) : undefined,
            maxWeightKg: weights.length > 0 ? Math.max(...weights) : undefined,
            totalVolumeKg: dateSets.reduce((total, workoutSet) => total + getSetVolume(workoutSet), 0),
          };
        })
        .sort((first, second) => first.dateKey.localeCompare(second.dateKey));

      return {
        bestRepetitionSet: getBestSet(sets, (workoutSet) => workoutSet.repetitions),
        bestVolumeSet: getBestSet(sets, (workoutSet) => {
          const volume = getSetVolume(workoutSet);
          return volume > 0 ? volume : undefined;
        }),
        bestWeightSet: getBestSet(sets, (workoutSet) => workoutSet.weightKg),
        exerciseKey,
        exerciseName: sets[sets.length - 1]?.exerciseName ?? 'Egzersiz',
        latestSet: [...sets]
          .reverse()
          .find((workoutSet) => workoutSet.repetitions !== undefined || workoutSet.weightKg !== undefined),
        points,
        totalSets: sets.length,
        totalVolumeKg: sets.reduce((total, workoutSet) => total + getSetVolume(workoutSet), 0),
      };
    })
    .sort((first, second) => {
      const firstDate = first.points[first.points.length - 1]?.dateKey ?? '';
      const secondDate = second.points[second.points.length - 1]?.dateKey ?? '';
      return secondDate.localeCompare(firstDate) || first.exerciseName.localeCompare(second.exerciseName, 'tr-TR');
    });
}
