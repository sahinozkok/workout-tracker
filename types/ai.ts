import { TrainingGoal } from '@/types/profile';

export type WeeklyDisciplineBreakdown = {
  completed: number;
  partial: number;
  skipped: number;
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
