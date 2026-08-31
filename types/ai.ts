import { TrainingGoal } from '@/types/profile';

export type WeeklyDisciplineBreakdown = {
  completed: number;
  partial: number;
  skipped: number;
};

/**
 * Bir metriğin geçen haftaya göre GÜVENLİ değişimi.
 *
 * `percent`, önceki değer 0 olduğunda BİLİNÇLİ olarak `undefined` bırakılır:
 * 0 tabanlı bir orandan anlamlı yüzde türetilemez ve `NaN`/`Infinity` asla
 * üretilmez. Önceki değer 0 iken artış yalnızca `delta` ile ifade edilir;
 * görüntüleme katmanı bu durumu ayrı bir metinsel duruma bağlar.
 */
export type WeeklyMetricChange = {
  currentValue: number;
  previousValue: number;
  /** `currentValue - previousValue`. */
  delta: number;
  direction: 'up' | 'down' | 'same';
  /** Yalnızca `previousValue > 0` iken tanımlı; yuvarlanmış tam sayı yüzde. */
  percent?: number;
};

export type WeeklyWorkoutMetrics = {
  activeProgramName?: string;
  averageWorkoutDurationSeconds: number;
  completedSets: number;
  completedWorkouts: number;
  discipline: WeeklyDisciplineBreakdown;
  periodEnd: string;
  periodStart: string;
  previousWeekCompletedSets: number;
  previousWeekCompletedWorkouts: number;
  totalWorkoutDurationSeconds: number;
  trainingGoal: TrainingGoal;
  /** Bu hafta tamamlanan kardiyo/aktivite kaydı sayısı. */
  completedActivities: number;
  /** Kardiyo/aktivite kayıtlarının toplam kayıtlı süresi (saniye). */
  totalActivityDurationSeconds: number;
  /**
   * Mesafe içeren aktivitelerin toplamı. Kanonik birim METREdir; km ve mil gibi
   * farklı görüntüleme birimleri çekirdekte ASLA birbirine eklenmez, dönüşüm
   * yalnızca görüntüleme katmanında yapılır.
   */
  totalActivityDistanceMeters: number;
  /** Mesafe kaydı olan aktivite sayısı; 0 ise mesafe satırı gizlenir. */
  activityDistanceCount: number;
  /** Önceki haftanın toplam antrenman süresi (saniye) — süre değişimi için. */
  previousWeekTotalWorkoutDurationSeconds: number;
  workoutChange: WeeklyMetricChange;
  setChange: WeeklyMetricChange;
  durationChange: WeeklyMetricChange;
};

export type WeeklyWorkoutInsight = {
  generatedAt: string;
  headline: string;
  highlights: string[];
  nextSteps: string[];
  provider: 'deterministic' | 'gemini' | 'mock';
  summary: string;
};

export type ExerciseProgressMetrics = {
  bestRepetitions?: number;
  bestSetVolumeKg?: number;
  bestWeightKg?: number;
  exerciseName: string;
  firstMaxWeightKg?: number;
  latestMaxWeightKg?: number;
  totalSets: number;
  totalVolumeKg: number;
  workoutDays: number;
};

export type ExerciseProgressInsight = WeeklyWorkoutInsight;

export type ChatRole = 'user' | 'assistant';

export type CoachChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  clientMessageId: string;
  // Yalnızca istemci tarafında kullanılır; sunucuda saklanmaz.
  status?: 'sending' | 'sent' | 'failed';
};
