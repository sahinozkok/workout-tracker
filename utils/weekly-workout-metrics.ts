import { TrainingGoal } from '@/types/profile';
import {
  DisciplineStatus,
  WorkoutActivityRecord,
  WorkoutSession,
  WorkoutSetRecord,
} from '@/types/workout';
import { WeeklyDisciplineBreakdown, WeeklyMetricChange, WeeklyWorkoutMetrics } from '@/types/ai';
import { toDateKey } from '@/utils/discipline';
import { getWorkoutDurationSeconds } from '@/utils/workout-session';

type BuildWeeklyMetricsInput = {
  activeProgramName?: string;
  disciplineStatuses: Record<string, DisciplineStatus>;
  now?: Date;
  trainingGoal: TrainingGoal;
  workoutSessions: WorkoutSession[];
  /** Silinmiş oturumların kayıtlarını İÇERMEYEN görünür setler (context sınırı). */
  workoutSets: WorkoutSetRecord[];
  /** Silinmiş oturumların kayıtlarını İÇERMEYEN görünür aktiviteler. */
  workoutActivityRecords: WorkoutActivityRecord[];
};

/** Hafta PAZARTESİ başlar; cihazın yerel tarih düzeni kullanılır. */
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

/**
 * İki değer arasında GÜVENLİ değişim özeti.
 *
 * `previousValue === 0` iken yüzde `undefined` bırakılır: hiçbir koşulda
 * `NaN`/`Infinity` üretilmez. Görüntüleme katmanı bu durumu ayrı metne bağlar.
 */
export function buildMetricChange(currentValue: number, previousValue: number): WeeklyMetricChange {
  const delta = currentValue - previousValue;
  return {
    currentValue,
    previousValue,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    percent: previousValue > 0 ? Math.round((delta / previousValue) * 100) : undefined,
  };
}

/**
 * Bir tarih aralığındaki DOĞRULANMIŞ toplamlar.
 *
 * YALNIZCA `completed` oturumların kanıtı sayılır: paused/running (tamamlanmamış)
 * oturumlar ve — context onları zaten koleksiyondan çıkardığı için listede
 * bulunmayan — silinmiş oturumlar hiçbir istatistiğe girmez. Set/aktivite
 * kayıtları oturum kimliğinden `completedSessionIds` üzerinden doğrulanır;
 * böylece aynı oturum ikiye bölünmeden, karma bir günde hem set hem kardiyo
 * doğru sayılır.
 */
function summarizeRange(
  startKey: string,
  endKey: string,
  completedSessions: WorkoutSession[],
  workoutSets: WorkoutSetRecord[],
  workoutActivityRecords: WorkoutActivityRecord[],
) {
  const sessions = completedSessions.filter((session) => isDateInRange(session.dateKey, startKey, endKey));
  const rangeSessionIds = new Set(sessions.map((session) => session.id));
  // Süre formülü TEK kaynaktan gelir; kopyalanmaz. Tamamlanmış oturumda
  // `getWorkoutDurationSeconds` `now`dan bağımsız olarak birikmiş süreyi döndürür.
  const totalWorkoutDurationSeconds = sessions.reduce(
    (total, session) => total + getWorkoutDurationSeconds(session),
    0,
  );

  // Haftanın tek güvenilir sınırı oturumun `dateKey` değeridir. Context kayıt
  // tarihini bugün oturumdan türetiyor olsa da çekirdek, uyumsuz/eskimiş bir
  // kayıt `dateKey` alanına güvenerek onu başka haftaya taşımaz.
  const sets = workoutSets.filter((set) => rangeSessionIds.has(set.sessionId));
  const activities = workoutActivityRecords.filter((record) => rangeSessionIds.has(record.sessionId));

  const totalActivityDurationSeconds = activities.reduce(
    (total, record) => total + record.durationSeconds,
    0,
  );
  // Mesafe YALNIZCA gerçekten mesafe kaydı olan aktivitelerden toplanır ve
  // toplam kanonik METRE cinsindendir; farklı görüntüleme birimleri (km/mil)
  // burada birbirine eklenmez.
  const distanceRecords = activities.filter(
    (record) => typeof record.distanceMeters === 'number' && record.distanceMeters > 0,
  );
  const totalActivityDistanceMeters = distanceRecords.reduce(
    (total, record) => total + (record.distanceMeters ?? 0),
    0,
  );

  return {
    completedWorkouts: sessions.length,
    totalWorkoutDurationSeconds,
    completedSets: sets.length,
    completedActivities: activities.length,
    totalActivityDurationSeconds,
    totalActivityDistanceMeters,
    activityDistanceCount: distanceRecords.length,
  };
}

export function buildWeeklyWorkoutMetrics({
  activeProgramName,
  disciplineStatuses,
  now = new Date(),
  trainingGoal,
  workoutSessions,
  workoutSets,
  workoutActivityRecords,
}: BuildWeeklyMetricsInput): WeeklyWorkoutMetrics {
  const currentWeekStart = startOfWeek(now);
  const currentWeekEnd = addDays(currentWeekStart, 6);
  const currentStartKey = toDateKey(currentWeekStart);
  const currentEndKey = toDateKey(currentWeekEnd);
  const previousStartKey = toDateKey(addDays(currentWeekStart, -7));
  const previousEndKey = toDateKey(addDays(currentWeekStart, -1));

  const completedSessions = workoutSessions.filter((session) => session.status === 'completed');

  const current = summarizeRange(
    currentStartKey,
    currentEndKey,
    completedSessions,
    workoutSets,
    workoutActivityRecords,
  );
  const previous = summarizeRange(
    previousStartKey,
    previousEndKey,
    completedSessions,
    workoutSets,
    workoutActivityRecords,
  );

  return {
    activeProgramName,
    averageWorkoutDurationSeconds:
      current.completedWorkouts > 0
        ? Math.round(current.totalWorkoutDurationSeconds / current.completedWorkouts)
        : 0,
    completedSets: current.completedSets,
    completedWorkouts: current.completedWorkouts,
    discipline: getDisciplineBreakdown(disciplineStatuses, currentStartKey, currentEndKey),
    periodEnd: currentEndKey,
    periodStart: currentStartKey,
    previousWeekCompletedSets: previous.completedSets,
    previousWeekCompletedWorkouts: previous.completedWorkouts,
    totalWorkoutDurationSeconds: current.totalWorkoutDurationSeconds,
    trainingGoal,
    completedActivities: current.completedActivities,
    totalActivityDurationSeconds: current.totalActivityDurationSeconds,
    totalActivityDistanceMeters: current.totalActivityDistanceMeters,
    activityDistanceCount: current.activityDistanceCount,
    previousWeekTotalWorkoutDurationSeconds: previous.totalWorkoutDurationSeconds,
    workoutChange: buildMetricChange(current.completedWorkouts, previous.completedWorkouts),
    setChange: buildMetricChange(current.completedSets, previous.completedSets),
    durationChange: buildMetricChange(
      current.totalWorkoutDurationSeconds,
      previous.totalWorkoutDurationSeconds,
    ),
  };
}
