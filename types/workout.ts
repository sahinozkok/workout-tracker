export type ExerciseDefinition = {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
};

/**
 * Egzersizin nasıl ÖLÇÜLDÜĞÜ. Veritabanındaki
 * `program_exercises.tracking_mode` ile birebir aynı küme.
 */
export type WorkoutTrackingMode = 'sets_reps' | 'duration' | 'distance';

/** Türden bağımsız, her egzersizde bulunan alanlar. */
type ProgramExerciseBase = {
  id: string;
  exerciseId?: string;
  customExerciseName?: string;
  visual?: WorkoutVisual;
  /**
   * Setler arası mola. `sets_reps` için kullanıcının seçtiği değer;
   * `duration`/`distance` için veritabanı sözleşmesi gereği HER ZAMAN 0
   * (o türlerde setler arası mola kavramı yoktur).
   */
  restSeconds: number;
};

/**
 * Üç tür AYRIK bir birleşimdir ve geçersiz kombinasyonlar TİP DÜZEYİNDE
 * temsil edilemez: her varyant kendi türüne ait olmayan hedef alanlarını
 * `?: never` ile kapatır. Böylece "süre hedefi taşıyan bir strength egzersizi"
 * gibi bir nesne derlenmez.
 *
 * Kardiyo BİLİNÇLİ OLARAK sahte bir set modeliyle (`targetSets = 1`) temsil
 * EDİLMEZ; hedef birimi türe göre `utils/workout-tracking.ts` içinde çözülür.
 */
export type StrengthProgramExercise = ProgramExerciseBase & {
  trackingMode: 'sets_reps';
  targetSets: number;
  targetReps: string;
  targetDurationSeconds?: never;
  targetDistanceMeters?: never;
};

export type DurationProgramExercise = ProgramExerciseBase & {
  trackingMode: 'duration';
  targetDurationSeconds: number;
  targetSets?: never;
  targetReps?: never;
  targetDistanceMeters?: never;
};

export type DistanceProgramExercise = ProgramExerciseBase & {
  trackingMode: 'distance';
  targetDistanceMeters: number;
  targetSets?: never;
  targetReps?: never;
  targetDurationSeconds?: never;
};

export type ProgramExercise =
  | StrengthProgramExercise
  | DurationProgramExercise
  | DistanceProgramExercise;

/** Birleşim üyelerini tek tek daraltan `Omit`. Düz `Omit` birleşimi çökertir. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Aktif antrenman ekranı ve set akışı YALNIZCA bu türle çalışır. */
export function isStrengthExercise(
  exercise: ProgramExercise,
): exercise is StrengthProgramExercise {
  return exercise.trackingMode === 'sets_reps';
}

export type ProgramIconName =
  | 'barbell-outline'
  | 'fitness-outline'
  | 'body-outline'
  | 'flash-outline'
  | 'flame-outline'
  | 'trophy-outline'
  | 'walk-outline'
  | 'bicycle-outline'
  | 'football-outline'
  | 'basketball-outline'
  | 'tennisball-outline'
  | 'golf-outline'
  | 'baseball-outline'
  | 'medal-outline'
  | 'heart-outline'
  | 'pulse-outline'
  | 'speedometer-outline'
  | 'timer-outline'
  | 'stopwatch-outline'
  | 'water-outline'
  | 'nutrition-outline'
  | 'moon-outline'
  | 'sunny-outline'
  | 'shield-checkmark-outline';

export type WorkoutVisual =
  | { type: 'icon'; icon: ProgramIconName }
  | { type: 'text'; text: string }
  | { type: 'image'; uri: string };

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WorkoutDay = {
  id: string;
  name: string;
  visual?: WorkoutVisual;
  scheduledWeekday?: Weekday;
  isOffDay?: boolean;
  exercises: ProgramExercise[];
};

export type WorkoutProgram = {
  id: string;
  name: string;
  visual?: WorkoutVisual;
  icon?: ProgramIconName;
  days: WorkoutDay[];
  createdAt: string;
};

export type WorkoutSessionStatus = 'running' | 'paused' | 'completed';

export type WorkoutSession = {
  id: string;
  programId: string;
  dayId: string;
  dateKey: string;
  status: WorkoutSessionStatus;
  startedAt: string;
  lastResumedAt?: string;
  accumulatedDurationSeconds: number;
  completedAt?: string;
};

/**
 * Ana setin hemen ardından, dinlenmeden yapılan düşük ağırlıklı devam parçası.
 *
 * Drop setler AYRI `workout_sets` satırı DEĞİLDİR: ana satırın `drop_sets`
 * JSONB alanında saklanır. Böylece plan/disiplin/ödül hesapları için bir ana
 * set + drop setleri tek "tamamlanan set" olarak kalır.
 */
export type WorkoutDropSetPerformance = {
  weightKg?: number;
  repetitions: number;
};

export type WorkoutSetPerformance = {
  weightKg?: number;
  repetitions: number;
  rpe?: number;
  /** Sıra korunur; boş dizi "drop set yapılmadı" demektir. */
  dropSets?: WorkoutDropSetPerformance[];
};

export type WorkoutSetRecord = {
  id: string;
  sessionId: string;
  programExerciseId?: string;
  exerciseName: string;
  dateKey: string;
  setNumber: number;
  weightKg?: number;
  repetitions?: number;
  rpe?: number;
  /** Eski kayıtlarda ve geçersiz JSON'da her zaman `[]`. */
  dropSets: WorkoutDropSetPerformance[];
  completedAt: string;
};

export type NewWorkoutProgram = Pick<WorkoutProgram, 'name' | 'days'> & { visual: WorkoutVisual };
export type NewProgramExercise = DistributiveOmit<ProgramExercise, 'id'>;

/**
 * Süre/mesafe egzersizinin tek bir oturumdaki performans kaydı.
 *
 * `workout_activity_records` satırının istemci karşılığıdır. Hedef alanları
 * KAYIT ANINDAKİ snapshot'tır: plan sonradan değişse bile geçmiş kayıt kendi
 * hedefine göre okunabilir.
 *
 * TEMPO SAKLANMAZ. Gerekirse mesafe ve süreden türetilir; bu fazda hiçbir
 * yüzeyde gösterilmez.
 */
export type WorkoutActivityRecord = {
  id: string;
  sessionId: string;
  /** Program veya egzersiz silindiyse NULL'a düşer; kayıt yine de kalır. */
  programExerciseId?: string;
  exerciseName: string;
  trackingMode: 'duration' | 'distance';
  targetDurationSeconds?: number;
  targetDistanceMeters?: number;
  durationSeconds: number;
  distanceMeters?: number;
  rpe?: number;
  completedAt: string;
  /** Kaydın ait olduğu oturumun `workout_date` değeri. */
  dateKey: string;
};

export type DisciplineStatus = 'completed' | 'partial' | 'skipped';
