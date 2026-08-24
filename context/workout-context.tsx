import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useRewards } from '@/context/reward-context';
import { supabase } from '@/lib/supabase';
import {
  DisciplineStatus,
  NewProgramExercise,
  NewWorkoutProgram,
  ProgramExercise,
  Weekday,
  WorkoutDay,
  WorkoutProgram,
  WorkoutSession,
  WorkoutSetPerformance,
  WorkoutSetRecord,
  WorkoutVisual,
} from '@/types/workout';
import { toDateKey } from '@/utils/discipline';
import { buildDisciplineStatuses, getSetProgressKey, isScheduledDate } from '@/utils/workout-schedule';

type ExerciseUpdates = Partial<Pick<ProgramExercise, 'visual' | 'targetSets' | 'targetReps' | 'restSeconds'>>;
type DayUpdates = Partial<Pick<WorkoutDay, 'name' | 'visual' | 'scheduledWeekday' | 'isOffDay'>>;

type WorkoutContextValue = {
  programs: WorkoutProgram[];
  isProgramsLoading: boolean;
  programsError?: string;
  activeProgramId?: string;
  activeProgramStartedAt?: string;
  disciplineStatuses: Record<string, DisciplineStatus>;
  completedSetCounts: Record<string, number>;
  workoutSessions: WorkoutSession[];
  workoutSets: WorkoutSetRecord[];
  refreshPrograms: () => Promise<void>;
  addProgram: (program: NewWorkoutProgram) => Promise<void>;
  activateProgram: (programId: string) => Promise<void>;
  deleteProgram: (programId: string) => Promise<void>;
  addExerciseToDay: (programId: string, dayId: string, exercise: NewProgramExercise) => Promise<void>;
  removeExerciseFromDay: (programId: string, dayId: string, programExerciseId: string) => Promise<void>;
  reorderExercisesInDay: (programId: string, dayId: string, exercises: ProgramExercise[]) => Promise<void>;
  reorderDays: (programId: string, days: WorkoutDay[]) => Promise<void>;
  updateProgram: (programId: string, updates: { name?: string; visual?: WorkoutVisual }) => Promise<void>;
  updateDay: (programId: string, dayId: string, updates: DayUpdates) => Promise<void>;
  updateExercise: (
    programId: string,
    dayId: string,
    programExerciseId: string,
    updates: ExerciseUpdates,
  ) => Promise<void>;
  completeSet: (
    dateKey: string,
    programExerciseId: string,
    targetSets: number,
    performance: WorkoutSetPerformance,
  ) => Promise<void>;
  undoCompletedSet: (dateKey: string, programExerciseId: string) => Promise<void>;
  resetCompletedSets: (dateKey: string, programExerciseIds: string[]) => Promise<void>;
  startWorkout: (programId: string, dayId: string, dateKey: string) => Promise<void>;
  pauseWorkout: (sessionId: string) => Promise<void>;
  resumeWorkout: (sessionId: string) => Promise<void>;
  finishWorkout: (sessionId: string) => Promise<void>;
  isDateScheduled: (dateKey: string) => boolean;
  cycleDisciplineStatus: (dateKey: string) => Promise<void>;
};

type ProgramRow = {
  id: string;
  name: string;
  visual: unknown;
  is_active: boolean;
  active_from: string | null;
  created_at: string;
};

type ProgramDayRow = {
  id: string;
  program_id: string;
  name: string;
  visual: unknown;
  scheduled_weekday: number;
  is_off_day: boolean;
  position: number;
};

type ProgramExerciseRow = {
  id: string;
  program_day_id: string;
  exercise_id: string | null;
  custom_exercise_name: string | null;
  visual: unknown;
  target_sets: number;
  target_reps: string;
  rest_seconds: number;
  position: number;
};

type WorkoutSessionRow = {
  id: string;
  program_id: string | null;
  program_day_id: string | null;
  workout_date: string;
  status: 'running' | 'paused' | 'completed' | 'cancelled';
  started_at: string;
  last_resumed_at: string | null;
  accumulated_duration_seconds: number;
  completed_at: string | null;
};

type WorkoutSetRow = {
  id: string;
  session_id: string;
  program_exercise_id: string | null;
  exercise_name: string;
  set_number: number;
  weight_kg: number | string | null;
  repetitions: number | null;
  rpe: number | string | null;
  completed_at: string;
};

type ManualDisciplineStatusRow = {
  discipline_date: string;
  status: DisciplineStatus;
};

/** Sunucunun dondurduğu geçmiş; istemci bu tabloya YAZAMAZ (yalnızca SELECT). */
type DisciplineHistoryRow = {
  discipline_date: string;
  status: DisciplineStatus;
};

const WorkoutContext = createContext<WorkoutContextValue | undefined>(undefined);

function parseVisual(value: unknown): WorkoutVisual | undefined {
  if (!value || typeof value !== 'object' || !('type' in value)) return undefined;

  const visual = value as Record<string, unknown>;
  if (visual.type === 'icon' && typeof visual.icon === 'string') return value as WorkoutVisual;
  if (visual.type === 'text' && typeof visual.text === 'string') return value as WorkoutVisual;
  if (visual.type === 'image' && typeof visual.uri === 'string') return value as WorkoutVisual;

  return undefined;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Beklenmeyen bir veritabanı hatası oluştu.';
}

export function WorkoutProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { syncWorkoutDay } = useRewards();
  const [programs, setPrograms] = useState<WorkoutProgram[]>([]);
  const [isProgramsLoading, setIsProgramsLoading] = useState(true);
  const [programsError, setProgramsError] = useState<string>();
  const [activeProgramId, setActiveProgramId] = useState<string>();
  const [activeProgramStartedAt, setActiveProgramStartedAt] = useState<string>();
  const [manualDisciplineStatuses, setManualDisciplineStatuses] = useState<Record<string, DisciplineStatus>>({});
  const [disciplineHistory, setDisciplineHistory] = useState<Record<string, DisciplineStatus>>({});
  const [completedSetCounts, setCompletedSetCounts] = useState<Record<string, number>>({});
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [workoutSets, setWorkoutSets] = useState<WorkoutSetRecord[]>([]);
  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const disciplineStatuses = useMemo(
    () =>
      buildDisciplineStatuses(
        disciplineHistory,
        manualDisciplineStatuses,
        activeProgram,
        activeProgramStartedAt,
        completedSetCounts,
      ),
    [activeProgram, activeProgramStartedAt, completedSetCounts, disciplineHistory, manualDisciplineStatuses],
  );

  const refreshPrograms = useCallback(async () => {
    if (!user) {
      setPrograms([]);
      setActiveProgramId(undefined);
      setActiveProgramStartedAt(undefined);
      setManualDisciplineStatuses({});
      setDisciplineHistory({});
      setCompletedSetCounts({});
      setWorkoutSessions([]);
      setWorkoutSets([]);
      setProgramsError(undefined);
      setIsProgramsLoading(false);
      return;
    }

    setIsProgramsLoading(true);
    setProgramsError(undefined);

    try {
      const { data: programData, error: programError } = await supabase
        .from('programs')
        .select('id, name, visual, is_active, active_from, created_at')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });

      if (programError) throw programError;

      const programRows = (programData ?? []) as ProgramRow[];
      const programIds = programRows.map((program) => program.id);
      let dayRows: ProgramDayRow[] = [];
      let exerciseRows: ProgramExerciseRow[] = [];

      if (programIds.length > 0) {
        const { data: dayData, error: dayError } = await supabase
          .from('program_days')
          .select('id, program_id, name, visual, scheduled_weekday, is_off_day, position')
          .in('program_id', programIds)
          .order('position', { ascending: true });

        if (dayError) throw dayError;
        dayRows = (dayData ?? []) as ProgramDayRow[];

        const dayIds = dayRows.map((day) => day.id);
        if (dayIds.length > 0) {
          const { data: exerciseData, error: exerciseError } = await supabase
            .from('program_exercises')
            .select(
              'id, program_day_id, exercise_id, custom_exercise_name, visual, target_sets, target_reps, rest_seconds, position',
            )
            .in('program_day_id', dayIds)
            .order('position', { ascending: true });

          if (exerciseError) throw exerciseError;
          exerciseRows = (exerciseData ?? []) as ProgramExerciseRow[];
        }
      }

      const loadedPrograms = programRows.map<WorkoutProgram>((programRow) => ({
        id: programRow.id,
        name: programRow.name,
        visual: parseVisual(programRow.visual),
        createdAt: programRow.created_at,
        days: dayRows
          .filter((dayRow) => dayRow.program_id === programRow.id)
          .sort((first, second) => first.position - second.position)
          .map<WorkoutDay>((dayRow) => ({
            id: dayRow.id,
            name: dayRow.name,
            visual: parseVisual(dayRow.visual),
            scheduledWeekday: dayRow.scheduled_weekday as Weekday,
            isOffDay: dayRow.is_off_day,
            exercises: exerciseRows
              .filter((exerciseRow) => exerciseRow.program_day_id === dayRow.id)
              .sort((first, second) => first.position - second.position)
              .map<ProgramExercise>((exerciseRow) => ({
                id: exerciseRow.id,
                exerciseId: exerciseRow.exercise_id ?? undefined,
                customExerciseName: exerciseRow.custom_exercise_name ?? undefined,
                visual: parseVisual(exerciseRow.visual),
                targetSets: exerciseRow.target_sets,
                targetReps: exerciseRow.target_reps,
                restSeconds: exerciseRow.rest_seconds,
              })),
          })),
      }));

      const [sessionsResult, manualStatusesResult, historyResult] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select(
            'id, program_id, program_day_id, workout_date, status, started_at, last_resumed_at, accumulated_duration_seconds, completed_at',
          )
          .eq('user_id', user.id)
          .in('status', ['running', 'paused', 'completed'])
          .order('started_at', { ascending: false }),
        supabase
          .from('manual_discipline_statuses')
          .select('discipline_date, status')
          .eq('user_id', user.id),
        supabase
          .from('discipline_day_history')
          .select('discipline_date, status')
          .eq('user_id', user.id),
      ]);

      if (sessionsResult.error) throw sessionsResult.error;
      if (manualStatusesResult.error) throw manualStatusesResult.error;
      if (historyResult.error) throw historyResult.error;

      const sessionRows = (sessionsResult.data ?? []) as WorkoutSessionRow[];
      let workoutSetRows: WorkoutSetRow[] = [];
      const sessionIds = sessionRows.map((session) => session.id);

      if (sessionIds.length > 0) {
        const { data: setData, error: setError } = await supabase
          .from('workout_sets')
          .select(
            'id, session_id, program_exercise_id, exercise_name, set_number, weight_kg, repetitions, rpe, completed_at',
          )
          .in('session_id', sessionIds);

        if (setError) throw setError;
        workoutSetRows = (setData ?? []) as WorkoutSetRow[];
      }

      const sessionDateById = new Map(sessionRows.map((session) => [session.id, session.workout_date]));
      const loadedSetCounts = workoutSetRows.reduce<Record<string, number>>((counts, workoutSet) => {
        if (!workoutSet.program_exercise_id) return counts;
        const dateKey = sessionDateById.get(workoutSet.session_id);
        if (!dateKey) return counts;

        const progressKey = getSetProgressKey(dateKey, workoutSet.program_exercise_id);
        counts[progressKey] = (counts[progressKey] ?? 0) + 1;
        return counts;
      }, {});

      const loadedWorkoutSets = workoutSetRows.flatMap<WorkoutSetRecord>((workoutSet) => {
        const dateKey = sessionDateById.get(workoutSet.session_id);
        if (!dateKey) return [];

        return [{
          id: workoutSet.id,
          sessionId: workoutSet.session_id,
          programExerciseId: workoutSet.program_exercise_id ?? undefined,
          exerciseName: workoutSet.exercise_name,
          dateKey,
          setNumber: workoutSet.set_number,
          weightKg: workoutSet.weight_kg === null ? undefined : Number(workoutSet.weight_kg),
          repetitions: workoutSet.repetitions ?? undefined,
          rpe: workoutSet.rpe === null ? undefined : Number(workoutSet.rpe),
          completedAt: workoutSet.completed_at,
        }];
      });

      const loadedSessions = sessionRows
        .filter((session) => session.status !== 'cancelled')
        .map<WorkoutSession>((session) => ({
          id: session.id,
          programId: session.program_id ?? '',
          dayId: session.program_day_id ?? '',
          dateKey: session.workout_date,
          status: session.status as WorkoutSession['status'],
          startedAt: session.started_at,
          lastResumedAt: session.last_resumed_at ?? undefined,
          accumulatedDurationSeconds: session.accumulated_duration_seconds,
          completedAt: session.completed_at ?? undefined,
        }));

      const loadedManualStatuses = ((manualStatusesResult.data ?? []) as ManualDisciplineStatusRow[]).reduce<
        Record<string, DisciplineStatus>
      >((statuses, row) => {
        statuses[row.discipline_date] = row.status;
        return statuses;
      }, {});

      const loadedHistory = ((historyResult.data ?? []) as DisciplineHistoryRow[]).reduce<
        Record<string, DisciplineStatus>
      >((statuses, row) => {
        statuses[row.discipline_date] = row.status;
        return statuses;
      }, {});

      const activeRow = programRows.find((program) => program.is_active);
      setPrograms(loadedPrograms);
      setActiveProgramId(activeRow?.id);
      setActiveProgramStartedAt(activeRow?.active_from ?? undefined);
      setWorkoutSessions(loadedSessions);
      setWorkoutSets(loadedWorkoutSets);
      setCompletedSetCounts(loadedSetCounts);
      setManualDisciplineStatuses(loadedManualStatuses);
      setDisciplineHistory(loadedHistory);
    } catch (error) {
      setProgramsError(getErrorMessage(error));
    } finally {
      setIsProgramsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshPrograms();
  }, [refreshPrograms]);

  async function addProgram(program: NewWorkoutProgram) {
    if (!user) throw new Error('Program kaydetmek için giriş yapmalısın.');

    const { data: programRow, error: programError } = await supabase
      .from('programs')
      .insert({ owner_id: user.id, name: program.name, visual: program.visual })
      .select('id, name, visual, created_at')
      .single();

    if (programError) throw programError;

    const { data: dayData, error: dayError } = await supabase
      .from('program_days')
      .insert(
        program.days.map((day, position) => ({
          program_id: programRow.id,
          name: day.name,
          visual: day.visual ?? null,
          scheduled_weekday: day.scheduledWeekday,
          is_off_day: day.isOffDay ?? false,
          position,
        })),
      )
      .select('id, name, visual, scheduled_weekday, is_off_day, position');

    if (dayError) {
      await supabase.from('programs').delete().eq('id', programRow.id);
      throw dayError;
    }

    const createdProgram: WorkoutProgram = {
      id: programRow.id,
      name: programRow.name,
      visual: parseVisual(programRow.visual),
      createdAt: programRow.created_at,
      days: (dayData ?? [])
        .sort((first, second) => first.position - second.position)
        .map((dayRow) => ({
          id: dayRow.id,
          name: dayRow.name,
          visual: parseVisual(dayRow.visual),
          scheduledWeekday: dayRow.scheduled_weekday as Weekday,
          isOffDay: dayRow.is_off_day,
          exercises: [],
        })),
    };

    setPrograms((currentPrograms) => [createdProgram, ...currentPrograms]);

    if (!activeProgramId) {
      // `client_today`: program değişmeden ÖNCE eski programın bekleyen
      // günlerini uzlaştırırken kullanılacak üst sınır. Sunucu bu tarihi ±1
      // gün olarak doğrular; tutarları yine kendisi hesaplar.
      const { error: activationError } = await supabase.rpc('activate_program', {
        client_today: toDateKey(new Date()),
        target_program_id: createdProgram.id,
      });
      if (activationError) throw activationError;
      // Bkz. `activateProgram`: aktif program bilgisi ve dondurulmuş geçmiş
      // sunucudan tek seferde okunur.
      await refreshPrograms();
    }
  }

  async function activateProgram(programId: string) {
    // Bkz. `addProgram`: eski programın bekleyen günleri ve GÖRÜNTÜLEME
    // geçmişi, program değişmeden önce sunucuda dondurulur.
    const { error } = await supabase.rpc('activate_program', {
      client_today: toDateKey(new Date()),
      target_program_id: programId,
    });
    if (error) throw error;

    /**
     * Yerel `activeProgramStartedAt` BİLİNÇLİ olarak elle ileri alınmaz.
     * Eskiden bu satır, sunucudan dondurulmuş geçmiş gelmeden önce yeni
     * başlangıç tarihini uygulayıp takvimi bir anlığına sıfır gösteriyordu.
     * Artık aktif program, başlangıç tarihi ve `discipline_day_history`
     * sunucudan TEK seferde okunur; ara durumda takvim boşalmaz.
     */
    await refreshPrograms();
  }

  async function deleteProgram(programId: string) {
    const { error } = await supabase.from('programs').delete().eq('id', programId);
    if (error) throw error;

    setPrograms((currentPrograms) => currentPrograms.filter((program) => program.id !== programId));
    if (activeProgramId === programId) {
      setActiveProgramId(undefined);
      setActiveProgramStartedAt(undefined);
      // Silme tetikleyicisi geçmişi silinmeden ÖNCE dondurur; dondurulan
      // günler ancak yeniden okunduğunda takvime geri gelir.
      await refreshPrograms();
    }
  }

  async function addExerciseToDay(programId: string, dayId: string, exercise: NewProgramExercise) {
    const day = programs.find((program) => program.id === programId)?.days.find((item) => item.id === dayId);
    if (!day) throw new Error('Egzersizin ekleneceği gün bulunamadı.');

    const { data, error } = await supabase
      .from('program_exercises')
      .insert({
        program_day_id: dayId,
        exercise_id: exercise.exerciseId ?? null,
        custom_exercise_name: exercise.customExerciseName ?? null,
        visual: exercise.visual ?? null,
        target_sets: exercise.targetSets,
        target_reps: exercise.targetReps,
        rest_seconds: exercise.restSeconds,
        position: day.exercises.length,
      })
      .select('id')
      .single();

    if (error) throw error;

    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => {
        if (program.id !== programId) return program;

        return {
          ...program,
          days: program.days.map((currentDay) =>
            currentDay.id === dayId
              ? { ...currentDay, exercises: [...currentDay.exercises, { ...exercise, id: data.id }] }
              : currentDay,
          ),
        };
      }),
    );
  }

  async function removeExerciseFromDay(programId: string, dayId: string, programExerciseId: string) {
    const { error } = await supabase.from('program_exercises').delete().eq('id', programExerciseId);
    if (error) throw error;

    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => {
        if (program.id !== programId) return program;

        return {
          ...program,
          days: program.days.map((day) =>
            day.id === dayId
              ? { ...day, exercises: day.exercises.filter((exercise) => exercise.id !== programExerciseId) }
              : day,
          ),
        };
      }),
    );
  }

  async function reorderExercisesInDay(programId: string, dayId: string, exercises: ProgramExercise[]) {
    const results = await Promise.all(
      exercises.map((exercise, position) =>
        supabase.from('program_exercises').update({ position }).eq('id', exercise.id),
      ),
    );
    const failedResult = results.find((result) => result.error);
    if (failedResult?.error) throw failedResult.error;

    setPrograms((currentPrograms) =>
      currentPrograms.map((program) =>
        program.id === programId
          ? {
              ...program,
              days: program.days.map((day) => (day.id === dayId ? { ...day, exercises } : day)),
            }
          : program,
      ),
    );
  }

  async function reorderDays(programId: string, days: WorkoutDay[]) {
    const results = await Promise.all(
      days.map((day, position) => supabase.from('program_days').update({ position }).eq('id', day.id)),
    );
    const failedResult = results.find((result) => result.error);
    if (failedResult?.error) throw failedResult.error;

    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => (program.id === programId ? { ...program, days } : program)),
    );
  }

  async function updateProgram(programId: string, updates: { name?: string; visual?: WorkoutVisual }) {
    const databaseUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) databaseUpdates.name = updates.name;
    if (updates.visual !== undefined) databaseUpdates.visual = updates.visual;

    const { error } = await supabase.from('programs').update(databaseUpdates).eq('id', programId);
    if (error) throw error;

    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => (program.id === programId ? { ...program, ...updates } : program)),
    );
  }

  async function updateDay(programId: string, dayId: string, updates: DayUpdates) {
    const databaseUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) databaseUpdates.name = updates.name;
    if (updates.visual !== undefined) databaseUpdates.visual = updates.visual;
    if (updates.scheduledWeekday !== undefined) databaseUpdates.scheduled_weekday = updates.scheduledWeekday;
    if (updates.isOffDay !== undefined) databaseUpdates.is_off_day = updates.isOffDay;

    const { error } = await supabase.from('program_days').update(databaseUpdates).eq('id', dayId);
    if (error) throw error;

    setPrograms((currentPrograms) =>
      currentPrograms.map((program) =>
        program.id === programId
          ? {
              ...program,
              days: program.days.map((day) => (day.id === dayId ? { ...day, ...updates } : day)),
            }
          : program,
      ),
    );
  }

  async function updateExercise(
    programId: string,
    dayId: string,
    programExerciseId: string,
    updates: ExerciseUpdates,
  ) {
    const databaseUpdates: Record<string, unknown> = {};
    if (updates.visual !== undefined) databaseUpdates.visual = updates.visual;
    if (updates.targetSets !== undefined) databaseUpdates.target_sets = updates.targetSets;
    if (updates.targetReps !== undefined) databaseUpdates.target_reps = updates.targetReps;
    if (updates.restSeconds !== undefined) databaseUpdates.rest_seconds = updates.restSeconds;

    const { error } = await supabase.from('program_exercises').update(databaseUpdates).eq('id', programExerciseId);
    if (error) throw error;

    setPrograms((currentPrograms) =>
      currentPrograms.map((program) =>
        program.id === programId
          ? {
              ...program,
              days: program.days.map((day) =>
                day.id === dayId
                  ? {
                      ...day,
                      exercises: day.exercises.map((exercise) =>
                        exercise.id === programExerciseId ? { ...exercise, ...updates } : exercise,
                      ),
                    }
                  : day,
              ),
            }
          : program,
      ),
    );
  }

  async function completeSet(
    dateKey: string,
    programExerciseId: string,
    targetSets: number,
    performance: WorkoutSetPerformance,
  ) {
    const progressKey = getSetProgressKey(dateKey, programExerciseId);
    const currentCount = completedSetCounts[progressKey] ?? 0;
    if (currentCount >= targetSets) return;

    const program = programs.find((item) =>
      item.days.some((day) => day.exercises.some((exercise) => exercise.id === programExerciseId)),
    );
    const day = program?.days.find((item) =>
      item.exercises.some((exercise) => exercise.id === programExerciseId),
    );
    const exercise = day?.exercises.find((item) => item.id === programExerciseId);
    const session = workoutSessions.find(
      (item) =>
        item.programId === program?.id &&
        item.dayId === day?.id &&
        item.dateKey === dateKey &&
        item.status === 'running',
    );

    if (!exercise || !session) throw new Error('Seti kaydetmek için antrenmanı başlatmalısın.');
    const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);

    const { data, error } = await supabase
      .from('workout_sets')
      .insert({
        session_id: session.id,
        program_exercise_id: programExerciseId,
        exercise_name: exerciseName,
        set_number: currentCount + 1,
        weight_kg: performance.weightKg ?? null,
        repetitions: performance.repetitions,
        rpe: performance.rpe ?? null,
      })
      .select('id, completed_at')
      .single();

    if (error) throw error;

    setWorkoutSets((currentSets) => [
      ...currentSets,
      {
        id: data.id,
        sessionId: session.id,
        programExerciseId,
        exerciseName,
        dateKey,
        setNumber: currentCount + 1,
        ...performance,
        completedAt: data.completed_at,
      },
    ]);

    setCompletedSetCounts((currentCounts) => ({
      ...currentCounts,
      [progressKey]: Math.min((currentCounts[progressKey] ?? 0) + 1, targetSets),
    }));

    /**
     * Ödüller **yalnızca** set gerçekten kalıcı olarak kaydedildikten sonra
     * uzlaştırılır: yukarıdaki insert hata verirse buraya hiç gelinmez.
     *
     * Tek çağrıdır ve set + gün tamamlama + streak bonusunu sunucuda aynı
     * transaction'da hesaplar; son sette birbiriyle yarışan üç istek oluşmaz.
     * Tekrar çağrılması güvenlidir: defter idempotent olduğu için çift dokunma
     * ve ağ tekrarı ikinci ödül üretmez. Ödül çağrısı bilinçli olarak
     * beklenmez — kronometre, mola ve antrenman akışı hiçbir koşulda ağ
     * cevabına bağlı kalmaz.
     */
    void syncWorkoutDay(toDateKey(new Date()), dateKey);
  }

  async function undoCompletedSet(dateKey: string, programExerciseId: string) {
    const progressKey = getSetProgressKey(dateKey, programExerciseId);
    const currentCount = completedSetCounts[progressKey] ?? 0;
    if (currentCount === 0) return;

    const program = programs.find((item) =>
      item.days.some((day) => day.exercises.some((exercise) => exercise.id === programExerciseId)),
    );
    const day = program?.days.find((item) =>
      item.exercises.some((exercise) => exercise.id === programExerciseId),
    );
    const session = workoutSessions.find(
      (item) =>
        item.programId === program?.id &&
        item.dayId === day?.id &&
        item.dateKey === dateKey &&
        item.status === 'running',
    );
    if (!session) throw new Error('Setin bağlı olduğu aktif antrenman bulunamadı.');

    const { error } = await supabase
      .from('workout_sets')
      .delete()
      .eq('session_id', session.id)
      .eq('program_exercise_id', programExerciseId)
      .eq('set_number', currentCount);

    if (error) throw error;

    setWorkoutSets((currentSets) =>
      currentSets.filter(
        (workoutSet) =>
          !(
            workoutSet.sessionId === session.id &&
            workoutSet.programExerciseId === programExerciseId &&
            workoutSet.setNumber === currentCount
          ),
      ),
    );

    setCompletedSetCounts((currentCounts) => ({
      ...currentCounts,
      [progressKey]: Math.max((currentCounts[progressKey] ?? 0) - 1, 0),
    }));
  }

  async function resetCompletedSets(dateKey: string, programExerciseIds: string[]) {
    if (programExerciseIds.length === 0) return;
    const sessionIds = workoutSessions.filter((session) => session.dateKey === dateKey).map((session) => session.id);

    if (sessionIds.length > 0) {
      const { error } = await supabase
        .from('workout_sets')
        .delete()
        .in('session_id', sessionIds)
        .in('program_exercise_id', programExerciseIds);

      if (error) throw error;
    }

    setCompletedSetCounts((currentCounts) => {
      const nextCounts = { ...currentCounts };
      programExerciseIds.forEach((exerciseId) => delete nextCounts[getSetProgressKey(dateKey, exerciseId)]);
      return nextCounts;
    });
    setWorkoutSets((currentSets) =>
      currentSets.filter(
        (workoutSet) =>
          workoutSet.dateKey !== dateKey ||
          !workoutSet.programExerciseId ||
          !programExerciseIds.includes(workoutSet.programExerciseId),
      ),
    );
  }

  async function startWorkout(programId: string, dayId: string, dateKey: string) {
    if (!user) throw new Error('Antrenman başlatmak için giriş yapmalısın.');

    const startedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: user.id,
        program_id: programId,
        program_day_id: dayId,
        workout_date: dateKey,
        status: 'running',
        started_at: startedAt,
        last_resumed_at: startedAt,
        accumulated_duration_seconds: 0,
      })
      .select('id, started_at, last_resumed_at')
      .single();

    if (error) throw error;

    setWorkoutSessions((currentSessions) => [
      {
        id: data.id,
        programId,
        dayId,
        dateKey,
        status: 'running',
        startedAt: data.started_at,
        lastResumedAt: data.last_resumed_at ?? data.started_at,
        accumulatedDurationSeconds: 0,
      },
      ...currentSessions,
    ]);
  }

  async function pauseWorkout(sessionId: string) {
    const pausedAt = Date.now();
    const session = workoutSessions.find((item) => item.id === sessionId);
    if (!session || session.status !== 'running') return;

    const runningSeconds = session.lastResumedAt
      ? Math.max(0, Math.floor((pausedAt - new Date(session.lastResumedAt).getTime()) / 1000))
      : 0;
    const accumulatedDurationSeconds = session.accumulatedDurationSeconds + runningSeconds;

    const { error } = await supabase
      .from('workout_sessions')
      .update({
        status: 'paused',
        last_resumed_at: null,
        accumulated_duration_seconds: accumulatedDurationSeconds,
      })
      .eq('id', sessionId);

    if (error) throw error;

    setWorkoutSessions((currentSessions) =>
      currentSessions.map((currentSession) =>
        currentSession.id === sessionId
          ? {
              ...currentSession,
              status: 'paused',
              lastResumedAt: undefined,
              accumulatedDurationSeconds,
            }
          : currentSession,
      ),
    );
  }

  async function resumeWorkout(sessionId: string) {
    const resumedAt = new Date().toISOString();
    const { error } = await supabase
      .from('workout_sessions')
      .update({ status: 'running', last_resumed_at: resumedAt })
      .eq('id', sessionId);

    if (error) throw error;

    setWorkoutSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === sessionId && session.status === 'paused'
          ? { ...session, status: 'running', lastResumedAt: resumedAt }
          : session,
      ),
    );
  }

  async function finishWorkout(sessionId: string) {
    const completedAt = new Date();
    const session = workoutSessions.find((item) => item.id === sessionId);
    if (!session || session.status === 'completed') return;

    const runningSeconds =
      session.status === 'running' && session.lastResumedAt
        ? Math.max(0, Math.floor((completedAt.getTime() - new Date(session.lastResumedAt).getTime()) / 1000))
        : 0;
    const accumulatedDurationSeconds = session.accumulatedDurationSeconds + runningSeconds;

    const { error } = await supabase
      .from('workout_sessions')
      .update({
        status: 'completed',
        last_resumed_at: null,
        accumulated_duration_seconds: accumulatedDurationSeconds,
        completed_at: completedAt.toISOString(),
      })
      .eq('id', sessionId);

    if (error) throw error;

    setWorkoutSessions((currentSessions) =>
      currentSessions.map((currentSession) =>
        currentSession.id === sessionId
          ? {
              ...currentSession,
              status: 'completed',
              lastResumedAt: undefined,
              accumulatedDurationSeconds,
              completedAt: completedAt.toISOString(),
            }
          : currentSession,
      ),
    );
  }

  async function cycleDisciplineStatus(dateKey: string) {
    if (!user) throw new Error('Takvimi değiştirmek için giriş yapmalısın.');

    const currentStatus = manualDisciplineStatuses[dateKey];
    const nextStatus: DisciplineStatus | undefined =
      !currentStatus
        ? 'completed'
        : currentStatus === 'completed'
          ? 'partial'
          : currentStatus === 'partial'
            ? 'skipped'
            : undefined;

    if (nextStatus) {
      const { error } = await supabase.from('manual_discipline_statuses').upsert(
        {
          user_id: user.id,
          discipline_date: dateKey,
          status: nextStatus,
        },
        { onConflict: 'user_id,discipline_date' },
      );
      if (error) throw error;
      setManualDisciplineStatuses((currentStatuses) => ({ ...currentStatuses, [dateKey]: nextStatus }));
      return;
    }

    const { error } = await supabase
      .from('manual_discipline_statuses')
      .delete()
      .eq('user_id', user.id)
      .eq('discipline_date', dateKey);
    if (error) throw error;

    setManualDisciplineStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      delete nextStatuses[dateKey];
      return nextStatuses;
    });
  }

  function isDateScheduledForProgram(dateKey: string) {
    return isScheduledDate(dateKey, activeProgram, activeProgramStartedAt);
  }

  const value = useMemo(
    () => ({
      programs,
      isProgramsLoading,
      programsError,
      activeProgramId,
      activeProgramStartedAt,
      disciplineStatuses,
      completedSetCounts,
      workoutSessions,
      workoutSets,
      refreshPrograms,
      addProgram,
      activateProgram,
      deleteProgram,
      addExerciseToDay,
      removeExerciseFromDay,
      reorderExercisesInDay,
      reorderDays,
      updateProgram,
      updateDay,
      updateExercise,
      completeSet,
      undoCompletedSet,
      resetCompletedSets,
      startWorkout,
      pauseWorkout,
      resumeWorkout,
      finishWorkout,
      isDateScheduled: isDateScheduledForProgram,
      cycleDisciplineStatus,
    }),
    [
      activeProgramId,
      activeProgramStartedAt,
      completedSetCounts,
      disciplineStatuses,
      isProgramsLoading,
      programs,
      programsError,
      refreshPrograms,
      workoutSessions,
      workoutSets,
    ],
  );

  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>;
}

export function useWorkout() {
  const context = useContext(WorkoutContext);

  if (!context) {
    throw new Error('useWorkout, WorkoutProvider içinde kullanılmalıdır.');
  }

  return context;
}
