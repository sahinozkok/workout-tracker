import { DisciplineStatus, WorkoutProgram } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';

export function getSetProgressKey(dateKey: string, programExerciseId: string) {
  return `${dateKey}:${programExerciseId}`;
}

export function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isScheduledDate(
  dateKey: string,
  activeProgram: WorkoutProgram | undefined,
  activeProgramStartedAt: string | undefined,
) {
  if (!activeProgram || !activeProgramStartedAt || dateKey < activeProgramStartedAt) return false;
  const weekday = dateFromKey(dateKey).getDay();
  return activeProgram.days.some((day) => day.scheduledWeekday === weekday);
}

export function getScheduledDisciplineStatus(
  dateKey: string,
  activeProgram: WorkoutProgram | undefined,
  activeProgramStartedAt: string | undefined,
  completedSetCounts: Record<string, number>,
  todayKey: string,
): DisciplineStatus | undefined {
  if (!activeProgram || !activeProgramStartedAt || dateKey < activeProgramStartedAt) return undefined;
  // Gelecek günlere otomatik durum üretilmez.
  if (dateKey > todayKey) return undefined;

  // Bugün henüz gün bitmediği için 0 ilerleme "atlandı" sayılmaz; nötr kalır.
  const isToday = dateKey === todayKey;
  const weekday = dateFromKey(dateKey).getDay();
  const scheduledDays = activeProgram.days.filter((day) => day.scheduledWeekday === weekday);

  if (scheduledDays.length === 0) return undefined;

  const workoutDays = scheduledDays.filter((day) => !day.isOffDay);
  if (workoutDays.length === 0) return 'completed';

  const exercises = workoutDays.flatMap((day) => day.exercises);
  const totalTargetSets = exercises.reduce((total, exercise) => total + exercise.targetSets, 0);
  if (totalTargetSets === 0) return isToday ? undefined : 'skipped';

  const totalCompletedSets = exercises.reduce(
    (total, exercise) =>
      total +
      Math.min(completedSetCounts[getSetProgressKey(dateKey, exercise.id)] ?? 0, exercise.targetSets),
    0,
  );

  if (totalCompletedSets === totalTargetSets) return 'completed';
  if (totalCompletedSets > 0) return 'partial';
  return isToday ? undefined : 'skipped';
}

export function buildDisciplineStatuses(
  manualStatuses: Record<string, DisciplineStatus>,
  activeProgram: WorkoutProgram | undefined,
  activeProgramStartedAt: string | undefined,
  completedSetCounts: Record<string, number>,
) {
  const statuses = { ...manualStatuses };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);

  for (let dayOffset = 0; dayOffset <= 400; dayOffset += 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - dayOffset);
    const dateKey = toDateKey(date);
    const scheduledStatus = getScheduledDisciplineStatus(
      dateKey,
      activeProgram,
      activeProgramStartedAt,
      completedSetCounts,
      todayKey,
    );
    if (scheduledStatus) statuses[dateKey] = scheduledStatus;
  }

  return statuses;
}
