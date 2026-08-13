import { DisciplineStatus, WorkoutProgram, WorkoutSession } from '@/types/workout';
import { calculateDisciplineStreak, toDateKey } from '@/utils/discipline';

/**
 * Maskotun Ana Sayfa'da anlatacağı bugünkü durum. Tamamen türetilmiş bir
 * değerdir: hiçbir state değiştirmez, ağ isteği veya Supabase sorgusu yapmaz.
 */
export type MascotDailyContext =
  | { kind: 'no-active-program' }
  | { kind: 'running' }
  | { kind: 'paused' }
  | { kind: 'rest' }
  | { kind: 'partial' }
  | { kind: 'completed' }
  | { kind: 'completed-streak'; streak: number }
  | { kind: 'scheduled-single'; dayName: string }
  | { kind: 'scheduled-multiple'; count: number }
  | { kind: 'no-schedule' };

/** Yalnızca `WorkoutContext`'in zaten bellekte tuttuğu değerler. */
export type MascotDailyInput = {
  activeProgramId?: string;
  disciplineStatuses: Record<string, DisciplineStatus>;
  isProgramsLoading: boolean;
  programs: WorkoutProgram[];
  programsError?: string;
  today: Date;
  workoutSessions: WorkoutSession[];
};

/** Seri mesajı bu eşikten itibaren kullanılır. */
const STREAK_MESSAGE_THRESHOLD = 2;

/**
 * Bugünkü bağlamı çözer. Saf fonksiyondur.
 *
 * Öncelik sırası:
 *   1. Aktif program yok
 *   2. Bugünkü `running` oturum
 *   3. Bugünkü `paused` oturum
 *   4. Bugünkü bütün planlı günler off day
 *   5. `partial`
 *   6. `completed` (seri 2+ ise seri mesajı)
 *   7. Planlanmış workout günü/günleri
 *   8. Bugün plan yok
 *
 * Programlar yükleniyorsa veya hata varsa `undefined` döner; çağıran taraf
 * bu durumda mevcut route mesaj havuzuna güvenle düşer.
 */
export function resolveMascotDailyContext(input: MascotDailyInput): MascotDailyContext | undefined {
  const {
    activeProgramId,
    disciplineStatuses,
    isProgramsLoading,
    programs,
    programsError,
    today,
    workoutSessions,
  } = input;

  if (isProgramsLoading || programsError) return undefined;

  const activeProgram = programs.find((program) => program.id === activeProgramId);
  if (!activeProgram) return { kind: 'no-active-program' };

  const todayKey = toDateKey(today);

  // Aktif oturum: aynı program ve bugünkü tarih. Önce `running`, sonra `paused`.
  const todaysSessions = workoutSessions.filter(
    (session) => session.programId === activeProgram.id && session.dateKey === todayKey,
  );
  if (todaysSessions.some((session) => session.status === 'running')) return { kind: 'running' };
  if (todaysSessions.some((session) => session.status === 'paused')) return { kind: 'paused' };

  // Aynı hafta gününde birden fazla gün planlanmış olabilir.
  const scheduledDays = activeProgram.days.filter((day) => day.scheduledWeekday === today.getDay());
  const workoutDays = scheduledDays.filter((day) => !day.isOffDay);

  // Yalnızca bugünkü bütün planlı günler off day ise dinlenme günüdür; bir
  // workout günü varsa off day de bulunsa gün dinlenme sayılmaz.
  if (scheduledDays.length > 0 && workoutDays.length === 0) return { kind: 'rest' };

  // Set sayıları yeniden hesaplanmaz; hazır disiplin durumu kullanılır.
  const status = disciplineStatuses[todayKey];
  if (status === 'partial') return { kind: 'partial' };
  if (status === 'completed') {
    const streak = calculateDisciplineStreak(disciplineStatuses);
    return streak >= STREAK_MESSAGE_THRESHOLD
      ? { kind: 'completed-streak', streak }
      : { kind: 'completed' };
  }

  if (workoutDays.length === 1) return { kind: 'scheduled-single', dayName: workoutDays[0].name };
  if (workoutDays.length > 1) return { kind: 'scheduled-multiple', count: workoutDays.length };

  return { kind: 'no-schedule' };
}

/**
 * Bağlam → çeviri anahtarı ve parametreleri. Metnin kendisi `locales/*.ts`
 * içinde durur; burada yalnızca anahtar üretilir.
 */
export function getMascotDailyMessage(context: MascotDailyContext): {
  key: string;
  params?: Record<string, string | number>;
} {
  switch (context.kind) {
    case 'no-active-program':
      return { key: 'mascot.dailyMessages.noActiveProgram' };
    case 'running':
      return { key: 'mascot.dailyMessages.running' };
    case 'paused':
      return { key: 'mascot.dailyMessages.paused' };
    case 'rest':
      return { key: 'mascot.dailyMessages.rest' };
    case 'partial':
      return { key: 'mascot.dailyMessages.partial' };
    case 'completed':
      return { key: 'mascot.dailyMessages.completed' };
    case 'completed-streak':
      return { key: 'mascot.dailyMessages.completedStreak', params: { count: context.streak } };
    case 'scheduled-single':
      return { key: 'mascot.dailyMessages.scheduledSingle', params: { day: context.dayName } };
    case 'scheduled-multiple':
      return { key: 'mascot.dailyMessages.scheduledMultiple', params: { count: context.count } };
    case 'no-schedule':
      return { key: 'mascot.dailyMessages.noSchedule' };
  }
}
