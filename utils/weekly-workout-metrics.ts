import { TrainingGoal } from '@/types/profile';
import { DisciplineStatus, WorkoutSession } from '@/types/workout';
import { WeeklyDisciplineBreakdown, WeeklyWorkoutMetrics } from '@/types/ai';
import { toDateKey } from '@/utils/discipline';

type BuildWeeklyMetricsInput = {
  activeProgramName?: string;
  completedSetCounts: Record<string, number>;
  disciplineStatuses: Record<string, DisciplineStatus>;
  now?: Date;
  trainingGoal: TrainingGoal;
  workoutSessions: WorkoutSession[];
};

function startOfWeek(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function isDateInRange(dateKey: string, startKey: string, endKey: string) {
  return dateKey >= startKey && dateKey <= endKey;
}

function countSetsInRange(completedSetCounts: Record<string, number>, startKey: string, endKey: string) {
  return Object.entries(completedSetCounts).reduce((total, [progressKey, count]) => {
    const dateKey = progressKey.slice(0, 10);
    return isDateInRange(dateKey, startKey, endKey) ? total + count : total;
  }, 0);
}

function getCompletedSessionsInRange(sessions: WorkoutSession[], startKey: string, endKey: string) {
  return sessions.filter(
    (session) => session.status === 'completed' && isDateInRange(session.dateKey, startKey, endKey),
  );
}

function getDisciplineBreakdown(
  statuses: Record<string, DisciplineStatus>,
  startKey: string,
  endKey: string,
): WeeklyDisciplineBreakdown {
  return Object.entries(statuses).reduce<WeeklyDisciplineBreakdown>(
    (breakdown, [dateKey, status]) => {
      if (isDateInRange(dateKey, startKey, endKey)) breakdown[status] += 1;
      return breakdown;
    },
    { completed: 0, partial: 0, skipped: 0 },
  );
}

export function buildWeeklyWorkoutMetrics({
  activeProgramName,
  completedSetCounts,
  disciplineStatuses,
  now = new Date(),
  trainingGoal,
  workoutSessions,
}: BuildWeeklyMetricsInput): WeeklyWorkoutMetrics {
  const currentWeekStart = startOfWeek(now);
  const currentWeekEnd = addDays(currentWeekStart, 6);
  const previousWeekStart = addDays(currentWeekStart, -7);
  const previousWeekEnd = addDays(currentWeekStart, -1);
  const currentStartKey = toDateKey(currentWeekStart);
  const currentEndKey = toDateKey(currentWeekEnd);
  const previousStartKey = toDateKey(previousWeekStart);
  const previousEndKey = toDateKey(previousWeekEnd);
  const currentSessions = getCompletedSessionsInRange(workoutSessions, currentStartKey, currentEndKey);
  const previousSessions = getCompletedSessionsInRange(workoutSessions, previousStartKey, previousEndKey);
  const totalWorkoutDurationSeconds = currentSessions.reduce(
    (total, session) => total + session.accumulatedDurationSeconds,
    0,
  );

  return {
    activeProgramName,
    averageWorkoutDurationSeconds:
      currentSessions.length > 0 ? Math.round(totalWorkoutDurationSeconds / currentSessions.length) : 0,
    completedSets: countSetsInRange(completedSetCounts, currentStartKey, currentEndKey),
    completedWorkouts: currentSessions.length,
    discipline: getDisciplineBreakdown(disciplineStatuses, currentStartKey, currentEndKey),
    periodEnd: currentEndKey,
    periodStart: currentStartKey,
    previousWeekCompletedSets: countSetsInRange(completedSetCounts, previousStartKey, previousEndKey),
    previousWeekCompletedWorkouts: previousSessions.length,
    totalWorkoutDurationSeconds,
    trainingGoal,
  };
}
