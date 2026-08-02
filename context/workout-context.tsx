import { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

import {
  DisciplineStatus,
  NewProgramExercise,
  NewWorkoutProgram,
  ProgramExercise,
  WorkoutDay,
  WorkoutProgram,
  WorkoutSession,
  WorkoutVisual,
} from '@/types/workout';
import { buildDisciplineStatuses, getSetProgressKey, isScheduledDate } from '@/utils/workout-schedule';
import { toDateKey } from '@/utils/discipline';

type ExerciseUpdates = Partial<Pick<ProgramExercise, 'visual' | 'targetSets' | 'targetReps' | 'restSeconds'>>;
type DayUpdates = Partial<Pick<WorkoutDay, 'name' | 'visual' | 'scheduledWeekday' | 'isOffDay'>>;

type WorkoutContextValue = {
  programs: WorkoutProgram[];
  activeProgramId?: string;
  activeProgramStartedAt?: string;
  disciplineStatuses: Record<string, DisciplineStatus>;
  completedSetCounts: Record<string, number>;
  workoutSessions: WorkoutSession[];
  addProgram: (program: NewWorkoutProgram) => void;
  activateProgram: (programId: string) => void;
  addExerciseToDay: (programId: string, dayId: string, exercise: NewProgramExercise) => void;
  removeExerciseFromDay: (programId: string, dayId: string, programExerciseId: string) => void;
  reorderExercisesInDay: (programId: string, dayId: string, exercises: ProgramExercise[]) => void;
  reorderDays: (programId: string, days: WorkoutDay[]) => void;
  updateProgram: (programId: string, updates: { name?: string; visual?: WorkoutVisual }) => void;
  updateDay: (programId: string, dayId: string, updates: DayUpdates) => void;
  updateExercise: (
    programId: string,
    dayId: string,
    programExerciseId: string,
    updates: ExerciseUpdates,
  ) => void;
  completeSet: (dateKey: string, programExerciseId: string, targetSets: number) => void;
  undoCompletedSet: (dateKey: string, programExerciseId: string) => void;
  resetCompletedSets: (dateKey: string, programExerciseIds: string[]) => void;
  startWorkout: (programId: string, dayId: string, dateKey: string) => void;
  pauseWorkout: (sessionId: string) => void;
  resumeWorkout: (sessionId: string) => void;
  finishWorkout: (sessionId: string) => void;
  isDateScheduled: (dateKey: string) => boolean;
  cycleDisciplineStatus: (dateKey: string) => void;
};

const WorkoutContext = createContext<WorkoutContextValue | undefined>(undefined);

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function WorkoutProvider({ children }: PropsWithChildren) {
  const [programs, setPrograms] = useState<WorkoutProgram[]>([]);
  const [activeProgramId, setActiveProgramId] = useState<string>();
  const [activeProgramStartedAt, setActiveProgramStartedAt] = useState<string>();
  const [manualDisciplineStatuses, setManualDisciplineStatuses] = useState<Record<string, DisciplineStatus>>({});
  const [completedSetCounts, setCompletedSetCounts] = useState<Record<string, number>>({});
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const disciplineStatuses = useMemo(
    () =>
      buildDisciplineStatuses(
        manualDisciplineStatuses,
        activeProgram,
        activeProgramStartedAt,
        completedSetCounts,
      ),
    [activeProgram, activeProgramStartedAt, completedSetCounts, manualDisciplineStatuses],
  );

  function addProgram(program: NewWorkoutProgram) {
    const newProgram: WorkoutProgram = {
      ...program,
      id: createId(),
      createdAt: new Date().toISOString(),
    };

    setPrograms((currentPrograms) => [newProgram, ...currentPrograms]);

    if (!activeProgramId) {
      setActiveProgramId(newProgram.id);
      setActiveProgramStartedAt(toDateKey(new Date()));
    }
  }

  function activateProgram(programId: string) {
    setActiveProgramId(programId);
    setActiveProgramStartedAt(toDateKey(new Date()));
  }

  function addExerciseToDay(programId: string, dayId: string, exercise: NewProgramExercise) {
    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => {
        if (program.id !== programId) {
          return program;
        }

        return {
          ...program,
          days: program.days.map((day) => {
            if (day.id !== dayId) {
              return day;
            }

            return {
              ...day,
              exercises: [...day.exercises, { ...exercise, id: createId() }],
            };
          }),
        };
      }),
    );
  }

  function removeExerciseFromDay(programId: string, dayId: string, programExerciseId: string) {
    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => {
        if (program.id !== programId) {
          return program;
        }

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

  function reorderExercisesInDay(programId: string, dayId: string, exercises: ProgramExercise[]) {
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

  function reorderDays(programId: string, days: WorkoutDay[]) {
    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => (program.id === programId ? { ...program, days } : program)),
    );
  }

  function updateProgram(programId: string, updates: { name?: string; visual?: WorkoutVisual }) {
    setPrograms((currentPrograms) =>
      currentPrograms.map((program) => (program.id === programId ? { ...program, ...updates } : program)),
    );
  }

  function updateDay(programId: string, dayId: string, updates: DayUpdates) {
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

  function updateExercise(
    programId: string,
    dayId: string,
    programExerciseId: string,
    updates: ExerciseUpdates,
  ) {
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

  function completeSet(dateKey: string, programExerciseId: string, targetSets: number) {
    const progressKey = getSetProgressKey(dateKey, programExerciseId);
    setCompletedSetCounts((currentCounts) => ({
      ...currentCounts,
      [progressKey]: Math.min((currentCounts[progressKey] ?? 0) + 1, targetSets),
    }));
  }

  function undoCompletedSet(dateKey: string, programExerciseId: string) {
    const progressKey = getSetProgressKey(dateKey, programExerciseId);
    setCompletedSetCounts((currentCounts) => ({
      ...currentCounts,
      [progressKey]: Math.max((currentCounts[progressKey] ?? 0) - 1, 0),
    }));
  }

  function resetCompletedSets(dateKey: string, programExerciseIds: string[]) {
    setCompletedSetCounts((currentCounts) => {
      const nextCounts = { ...currentCounts };
      programExerciseIds.forEach((exerciseId) => delete nextCounts[getSetProgressKey(dateKey, exerciseId)]);
      return nextCounts;
    });
  }

  function startWorkout(programId: string, dayId: string, dateKey: string) {
    const startedAt = new Date().toISOString();
    setWorkoutSessions((currentSessions) => [
      {
        id: createId(),
        programId,
        dayId,
        dateKey,
        status: 'running',
        startedAt,
        lastResumedAt: startedAt,
        accumulatedDurationSeconds: 0,
      },
      ...currentSessions,
    ]);
  }

  function pauseWorkout(sessionId: string) {
    const pausedAt = Date.now();
    setWorkoutSessions((currentSessions) =>
      currentSessions.map((session) => {
        if (session.id !== sessionId || session.status !== 'running') return session;

        const runningSeconds = session.lastResumedAt
          ? Math.max(0, Math.floor((pausedAt - new Date(session.lastResumedAt).getTime()) / 1000))
          : 0;

        return {
          ...session,
          status: 'paused',
          lastResumedAt: undefined,
          accumulatedDurationSeconds: session.accumulatedDurationSeconds + runningSeconds,
        };
      }),
    );
  }

  function resumeWorkout(sessionId: string) {
    const resumedAt = new Date().toISOString();
    setWorkoutSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === sessionId && session.status === 'paused'
          ? { ...session, status: 'running', lastResumedAt: resumedAt }
          : session,
      ),
    );
  }

  function finishWorkout(sessionId: string) {
    const completedAt = new Date();
    setWorkoutSessions((currentSessions) =>
      currentSessions.map((session) => {
        if (session.id !== sessionId || session.status === 'completed') return session;

        const runningSeconds =
          session.status === 'running' && session.lastResumedAt
            ? Math.max(0, Math.floor((completedAt.getTime() - new Date(session.lastResumedAt).getTime()) / 1000))
            : 0;

        return {
          ...session,
          status: 'completed',
          lastResumedAt: undefined,
          accumulatedDurationSeconds: session.accumulatedDurationSeconds + runningSeconds,
          completedAt: completedAt.toISOString(),
        };
      }),
    );
  }

  function cycleDisciplineStatus(dateKey: string) {
    setManualDisciplineStatuses((currentStatuses) => {
      const currentStatus = currentStatuses[dateKey];

      if (!currentStatus) return { ...currentStatuses, [dateKey]: 'completed' };
      if (currentStatus === 'completed') return { ...currentStatuses, [dateKey]: 'partial' };
      if (currentStatus === 'partial') return { ...currentStatuses, [dateKey]: 'skipped' };

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
      activeProgramId,
      activeProgramStartedAt,
      disciplineStatuses,
      completedSetCounts,
      workoutSessions,
      addProgram,
      activateProgram,
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
      programs,
      workoutSessions,
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
