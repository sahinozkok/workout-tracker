import { DisciplineStatus, WorkoutProgram } from '@/types/workout';
import { ActivityTotals, resolveDayProgress } from '@/utils/workout-tracking';
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
  activityTotals: Record<string, ActivityTotals> = {},
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

  /**
   * TÜR-FARKINDA ÇEKİRDEK. Set formülü burada TEKRAR EDİLMEZ;
   * `utils/workout-tracking.ts` tek doğruluk kaynağıdır.
   *
   * `partial` kararı artık tamamlanan birim sayısına değil `hasProgress`
   * sinyaline bakar: hedefin altında biten bir kardiyo kaydı sıfır birim üretir
   * ama gerçek bir ilerlemedir. Yalnızca strength içeren programlarda ikisi
   * matematiksel olarak eşdeğerdir, dolayısıyla mevcut davranış değişmez.
   */
  const exercises = workoutDays.flatMap((day) => day.exercises);
  const progress = resolveDayProgress({
    dateKey,
    exercises,
    completedSetCounts,
    activityTotals,
    getSetProgressKey,
  });

  if (progress.targetUnits === 0) return isToday ? undefined : 'skipped';
  if (progress.doneUnits >= progress.targetUnits) return 'completed';
  if (progress.hasProgress) return 'partial';
  return isToday ? undefined : 'skipped';
}

/**
 * Disiplin durumlarının BİRLEŞTİRME SIRASI (düşükten yükseğe):
 *
 *   1. `historyStatuses` — sunucunun program değişimi/silinmesi sırasında
 *      dondurduğu geçmiş (`discipline_day_history`). Yalnızca başka hiçbir
 *      katmanın söz söylemediği günleri doldurur.
 *   2. `manualStatuses`  — kullanıcının elle işaretlediği günler.
 *   3. Aktif programın CANLI otomatik hesabı — yalnızca kendi geçerli tarih
 *      aralığında (`activeProgramStartedAt` ve sonrası) üretilir.
 *
 * Böylece yeni aktif program, kendi başlangıcından ÖNCEKİ dondurulmuş günleri
 * asla silmez veya yeniden hesaplamaz. 2. ve 3. katmanın birbirine göre
 * önceliği bilinçli olarak DEĞİŞTİRİLMEDİ (otomatik hesap manuel durumu
 * ezmeye devam eder).
 */
export function buildDisciplineStatuses(
  historyStatuses: Record<string, DisciplineStatus>,
  manualStatuses: Record<string, DisciplineStatus>,
  activeProgram: WorkoutProgram | undefined,
  activeProgramStartedAt: string | undefined,
  completedSetCounts: Record<string, number>,
  activityTotals: Record<string, ActivityTotals> = {},
) {
  const statuses = { ...historyStatuses, ...manualStatuses };
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
      activityTotals,
    );
    if (scheduledStatus) statuses[dateKey] = scheduledStatus;
  }

  return statuses;
}

/**
 * Verilen haftanın gününün **bu haftaki** gerçek tarihini döndürür.
 * Hafta pazartesi başlar. Disiplin durumu bu tarihe göre okunur; böylece
 * yalnızca gün adına bakıp geçmiş haftalar boyanmaz.
 */
export function getWeekdayDateInCurrentWeek(weekday: number, today: Date) {
  const startOfWeek = new Date(today);
  startOfWeek.setHours(0, 0, 0, 0);
  const mondayOffset = (startOfWeek.getDay() + 6) % 7;
  startOfWeek.setDate(startOfWeek.getDate() - mondayOffset);

  const offset = weekday === 0 ? 6 : weekday - 1;
  const result = new Date(startOfWeek);
  result.setDate(result.getDate() + offset);
  return result;
}
