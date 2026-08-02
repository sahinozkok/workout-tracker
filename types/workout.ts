export type ExerciseDefinition = {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
};

export type ProgramExercise = {
  id: string;
  exerciseId?: string;
  customExerciseName?: string;
  visual?: WorkoutVisual;
  targetSets: number;
  targetReps: string;
  restSeconds: number;
};

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

export type NewWorkoutProgram = Pick<WorkoutProgram, 'name' | 'days'> & { visual: WorkoutVisual };
export type NewProgramExercise = Omit<ProgramExercise, 'id'>;

export type DisciplineStatus = 'completed' | 'partial' | 'skipped';
