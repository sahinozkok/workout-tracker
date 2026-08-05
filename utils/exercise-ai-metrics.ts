import { ExerciseProgressMetrics } from '@/types/ai';
import { ExerciseAnalytics } from '@/utils/workout-analytics';

export function buildExerciseProgressMetrics(analytics: ExerciseAnalytics): ExerciseProgressMetrics {
  const weightedPoints = analytics.points.filter((point) => point.maxWeightKg !== undefined);

  return {
    bestRepetitions: analytics.bestRepetitionSet?.repetitions,
    bestSetVolumeKg:
      analytics.bestVolumeSet?.weightKg !== undefined && analytics.bestVolumeSet.repetitions !== undefined
        ? analytics.bestVolumeSet.weightKg * analytics.bestVolumeSet.repetitions
        : undefined,
    bestWeightKg: analytics.bestWeightSet?.weightKg,
    exerciseName: analytics.exerciseName,
    firstMaxWeightKg: weightedPoints[0]?.maxWeightKg,
    latestMaxWeightKg: weightedPoints[weightedPoints.length - 1]?.maxWeightKg,
    totalSets: analytics.totalSets,
    totalVolumeKg: analytics.totalVolumeKg,
    workoutDays: analytics.points.length,
  };
}
