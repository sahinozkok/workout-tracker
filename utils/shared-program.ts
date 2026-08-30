import { getProgramExerciseName } from '@/data/exercises';
import {
  SharedActiveProgram,
  SharedProgramDay,
  SharedProgramExercise,
} from '@/types/friends';
import { ProgramExercise, Weekday, WorkoutProgram } from '@/types/workout';

/**
 * PAYLAŞILAN AKTİF PROGRAM — saf dönüşüm çekirdeği.
 *
 * İki KAYNAK, TEK gösterim modeli:
 *   - Arkadaş profili: `get_friend_active_program` RPC satırları.
 *   - Kendi profil: `useWorkout()` içindeki aktif `WorkoutProgram`.
 *
 * İkisi de AYNI `SharedActiveProgram` DTO'sunu üretir; böylece ortak bileşen
 * iki yüzeyde de birebir aynı sunumu çizer. Fonksiyonlar saftır (React/Supabase
 * yok) ve harness'ta gerçek olarak çalıştırılır.
 */

/** `get_friend_active_program` satırı — canlı RPC dönüş tipiyle birebir. */
export type FriendActiveProgramRow = {
  program_name: string;
  day_name: string;
  scheduled_weekday: number;
  is_off_day: boolean;
  day_position: number;
  exercise_id: string | null;
  custom_exercise_name: string | null;
  tracking_mode: string | null;
  target_sets: number | null;
  target_reps: string | null;
  target_duration_seconds: number | null;
  target_distance_meters: number | null;
  exercise_position: number | null;
};

/**
 * Satır tür sözleşmesini ihlal ediyor.
 *
 * Geçersiz `tracking_mode` veya hedef kombinasyonu SESSİZCE strength varsayımına
 * çevrilmez: sahte bir `targetSets` üretmek yanıltıcı bir program gösterirdi.
 * Kontrollü olarak reddedilir; çağıran (arkadaş profili) hatayı yakalar ve
 * yalnızca program bölümünü gizler, ekranı düşürmez.
 */
export class SharedProgramContractError extends Error {
  constructor(reason: string) {
    super(`shared_program sözleşme ihlali: ${reason}`);
    this.name = 'SharedProgramContractError';
  }
}

function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0;
}

/** Tek satırı mode-aware güvenli egzersize çevirir; ihlalde YÜKSEK SESLE düşer. */
function toSharedExercise(
  row: FriendActiveProgramRow,
  resolveName: (exerciseId?: string, customExerciseName?: string) => string,
): SharedProgramExercise {
  const name = resolveName(row.exercise_id ?? undefined, row.custom_exercise_name ?? undefined);

  if (row.tracking_mode === 'sets_reps') {
    if (!isPositiveInteger(row.target_sets)) {
      throw new SharedProgramContractError('target_sets pozitif tam sayı değil');
    }
    if (row.target_reps === null || row.target_reps.trim().length === 0) {
      throw new SharedProgramContractError('target_reps boş');
    }
    return { trackingMode: 'sets_reps', name, targetSets: row.target_sets, targetReps: row.target_reps };
  }

  if (row.tracking_mode === 'duration') {
    if (!isPositiveInteger(row.target_duration_seconds)) {
      throw new SharedProgramContractError('target_duration_seconds geçersiz');
    }
    return { trackingMode: 'duration', name, targetDurationSeconds: row.target_duration_seconds };
  }

  if (row.tracking_mode === 'distance') {
    if (!isPositiveInteger(row.target_distance_meters)) {
      throw new SharedProgramContractError('target_distance_meters geçersiz');
    }
    return { trackingMode: 'distance', name, targetDistanceMeters: row.target_distance_meters };
  }

  throw new SharedProgramContractError(`bilinmeyen tracking_mode: ${row.tracking_mode}`);
}

type DayAccumulator = {
  name: string;
  scheduledWeekday: Weekday;
  isOffDay: boolean;
  dayPosition: number;
  exercises: { position: number; exercise: SharedProgramExercise }[];
};

/**
 * RPC satırlarını program → gün → egzersiz hiyerarşisine çevirir.
 *
 * `LEFT JOIN` sayesinde off-day / egzersizsiz gün, egzersiz alanları null olan
 * TEK satır olarak gelir; o satırda `tracking_mode` null olduğu için egzersiz
 * eklenmez ama gün KORUNUR. Günler `scheduled_weekday` ile gruplanır (programda
 * benzersiz) ve satır sırasına güvenilmez: hem günler hem egzersizler pozisyona
 * göre deterministik sıralanır. Hiç satır yoksa `undefined` döner (bölüm gizli).
 */
export function mapFriendActiveProgramRows(
  rows: readonly FriendActiveProgramRow[],
  resolveName: (exerciseId?: string, customExerciseName?: string) => string = getProgramExerciseName,
): SharedActiveProgram | undefined {
  if (rows.length === 0) return undefined;

  const byWeekday = new Map<number, DayAccumulator>();

  for (const row of rows) {
    let day = byWeekday.get(row.scheduled_weekday);
    if (!day) {
      day = {
        name: row.day_name,
        scheduledWeekday: row.scheduled_weekday as Weekday,
        isOffDay: row.is_off_day,
        dayPosition: row.day_position,
        exercises: [],
      };
      byWeekday.set(row.scheduled_weekday, day);
    }

    // `tracking_mode` null → LEFT JOIN ile eşleşmeyen egzersizsiz/off-day satırı.
    if (row.tracking_mode !== null) {
      day.exercises.push({
        position: row.exercise_position ?? 0,
        exercise: toSharedExercise(row, resolveName),
      });
    }
  }

  const days: SharedProgramDay[] = [...byWeekday.values()]
    .sort((first, second) =>
      first.dayPosition !== second.dayPosition
        ? first.dayPosition - second.dayPosition
        : first.scheduledWeekday - second.scheduledWeekday,
    )
    .map((day) => ({
      name: day.name,
      scheduledWeekday: day.scheduledWeekday,
      isOffDay: day.isOffDay,
      exercises: day.exercises
        .sort((first, second) => first.position - second.position)
        .map((entry) => entry.exercise),
    }));

  return { name: rows[0].program_name, days };
}

/** Kendi aktif `WorkoutProgram`'ını (zaten doğrulanmış) güvenli DTO'ya çevirir. */
function toSharedExerciseFromProgram(exercise: ProgramExercise): SharedProgramExercise {
  const name = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);

  if (exercise.trackingMode === 'sets_reps') {
    return { trackingMode: 'sets_reps', name, targetSets: exercise.targetSets, targetReps: exercise.targetReps };
  }
  if (exercise.trackingMode === 'duration') {
    return { trackingMode: 'duration', name, targetDurationSeconds: exercise.targetDurationSeconds };
  }
  return { trackingMode: 'distance', name, targetDistanceMeters: exercise.targetDistanceMeters };
}

/**
 * Kendi profil için: aktif `WorkoutProgram`'ı arkadaşların GÖRECEĞİ sunumla
 * AYNI DTO'ya çevirir. Yeni Supabase sorgusu açılmaz; gün/egzersiz sırası
 * `WorkoutContext`in yükleme sırası (pozisyon) korunur.
 */
export function buildSharedProgramFromWorkoutProgram(program: WorkoutProgram): SharedActiveProgram {
  return {
    name: program.name,
    days: program.days.map((day) => ({
      name: day.name,
      scheduledWeekday: day.scheduledWeekday,
      isOffDay: day.isOffDay ?? false,
      exercises: day.exercises.map(toSharedExerciseFromProgram),
    })),
  };
}

/** Bölüm başlığındaki "X antrenman günü · Y egzersiz" için sayımlar. */
export function summarizeSharedProgram(program: SharedActiveProgram) {
  return {
    dayCount: program.days.filter((day) => !day.isOffDay).length,
    exerciseCount: program.days.reduce((total, day) => total + day.exercises.length, 0),
  };
}
