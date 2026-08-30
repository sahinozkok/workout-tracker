import {
  DistanceProgramExercise,
  DurationProgramExercise,
  ProgramExercise,
  StrengthProgramExercise,
  WorkoutTrackingMode,
  WorkoutVisual,
} from '@/types/workout';

/**
 * Güvenilmeyen `program_exercises` satırı. Alanlar canlı şemayla birebir:
 * `target_sets` ve `target_reps` Faz 1'den beri NULLABLE, kardiyo hedefleri ise
 * yalnızca kendi türlerinde doludur.
 */
export type ProgramExerciseRow = {
  id: string;
  program_day_id: string;
  exercise_id: string | null;
  custom_exercise_name: string | null;
  visual: unknown;
  tracking_mode: string;
  target_sets: number | null;
  target_reps: string | null;
  target_duration_seconds: number | null;
  target_distance_meters: number | null;
  rest_seconds: number;
  position: number;
};

/**
 * Satır tür sözleşmesini ihlal ediyor.
 *
 * Veritabanı bu kombinasyonları koşullu CHECK ile zaten reddeder; buraya
 * düşmek şemanın veya bir üst katmanın bozulduğu anlamına gelir. Bu yüzden
 * SESSİZCE varsayılana çevirmek YANLIŞTIR: sahte bir `targetSets` üretmek
 * disiplin ve ödül hesabını sessizce kaydırırdı. Yüksek sesle başarısız olmak
 * tek doğru davranıştır.
 */
export class ProgramExerciseContractError extends Error {
  readonly exerciseId: string;
  readonly trackingMode: string;

  constructor(exerciseId: string, trackingMode: string, reason: string) {
    super(`program_exercise sözleşme ihlali (${trackingMode}): ${reason}`);
    this.name = 'ProgramExerciseContractError';
    this.exerciseId = exerciseId;
    this.trackingMode = trackingMode;
  }
}

const TRACKING_MODES: readonly WorkoutTrackingMode[] = ['sets_reps', 'duration', 'distance'];

function isTrackingMode(value: string): value is WorkoutTrackingMode {
  return (TRACKING_MODES as readonly string[]).includes(value);
}

/** Sonlu pozitif tam sayı mı? `NaN`, `Infinity` ve 0 reddedilir. */
function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0;
}

/**
 * Satırı mode-aware istemci tipine çevirir. SAF fonksiyondur.
 *
 * Her tür için hem GEREKLİ alanların dolu hem de İLGİSİZ alanların boş olduğu
 * doğrulanır; ikisinden biri bozuksa `ProgramExerciseContractError` fırlatılır.
 * Hiçbir yolda `as number`, non-null assertion veya sessiz `?? 1` kullanılmaz.
 */
export function parseProgramExerciseRow(
  row: ProgramExerciseRow,
  parseVisual: (value: unknown) => WorkoutVisual | undefined,
): ProgramExercise {
  const mode = row.tracking_mode;
  if (!isTrackingMode(mode)) {
    throw new ProgramExerciseContractError(row.id, mode, 'bilinmeyen tracking_mode');
  }

  const base = {
    id: row.id,
    exerciseId: row.exercise_id ?? undefined,
    customExerciseName: row.custom_exercise_name ?? undefined,
    visual: parseVisual(row.visual),
    restSeconds: row.rest_seconds,
  };

  if (mode === 'sets_reps') {
    if (!isPositiveInteger(row.target_sets)) {
      throw new ProgramExerciseContractError(row.id, mode, 'target_sets pozitif tam sayı değil');
    }
    if (row.target_reps === null || row.target_reps.trim().length === 0) {
      throw new ProgramExerciseContractError(row.id, mode, 'target_reps boş');
    }
    if (row.target_duration_seconds !== null || row.target_distance_meters !== null) {
      throw new ProgramExerciseContractError(row.id, mode, 'kardiyo hedefi dolu');
    }
    const exercise: StrengthProgramExercise = {
      ...base,
      trackingMode: 'sets_reps',
      targetSets: row.target_sets,
      targetReps: row.target_reps,
    };
    return exercise;
  }

  if (mode === 'duration') {
    if (!isPositiveInteger(row.target_duration_seconds)) {
      throw new ProgramExerciseContractError(row.id, mode, 'target_duration_seconds geçersiz');
    }
    if (row.target_sets !== null || row.target_reps !== null || row.target_distance_meters !== null) {
      throw new ProgramExerciseContractError(row.id, mode, 'ilgisiz hedef alanı dolu');
    }
    const exercise: DurationProgramExercise = {
      ...base,
      trackingMode: 'duration',
      targetDurationSeconds: row.target_duration_seconds,
    };
    return exercise;
  }

  if (!isPositiveInteger(row.target_distance_meters)) {
    throw new ProgramExerciseContractError(row.id, mode, 'target_distance_meters geçersiz');
  }
  if (row.target_sets !== null || row.target_reps !== null || row.target_duration_seconds !== null) {
    throw new ProgramExerciseContractError(row.id, mode, 'ilgisiz hedef alanı dolu');
  }
  const exercise: DistanceProgramExercise = {
    ...base,
    trackingMode: 'distance',
    targetDistanceMeters: row.target_distance_meters,
  };
  return exercise;
}

/**
 * Yeni egzersiz INSERT yükü.
 *
 * Bu fazda arayüz YALNIZCA strength üretir; bu yüzden yük türü AÇIKÇA yazar ve
 * kardiyo hedeflerini açıkça `null` bırakır. Böylece varsayılana güvenmek
 * yerine sözleşme yazılı hâle gelir ve ileride kardiyo formu eklendiğinde
 * burası tek değişim noktası olur.
 */
export function buildStrengthExerciseInsertPayload(input: {
  programDayId: string;
  exerciseId?: string;
  customExerciseName?: string;
  visual: unknown;
  targetSets: number;
  targetReps: string;
  restSeconds: number;
  position: number;
}) {
  return {
    program_day_id: input.programDayId,
    exercise_id: input.exerciseId ?? null,
    custom_exercise_name: input.customExerciseName ?? null,
    visual: input.visual,
    tracking_mode: 'sets_reps' as const,
    target_sets: input.targetSets,
    target_reps: input.targetReps,
    target_duration_seconds: null,
    target_distance_meters: null,
    rest_seconds: input.restSeconds,
    position: input.position,
  };
}
