import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useOptionalRanks } from '@/context/rank-context';
import { useRewards } from '@/context/reward-context';
import { supabase } from '@/lib/supabase';
import {
  DisciplineStatus,
  NewProgramExercise,
  NewWorkoutProgram,
  ProgramExercise,
  Weekday,
  WorkoutDay,
  WorkoutDropSetPerformance,
  WorkoutProgram,
  WorkoutSession,
  WorkoutSetPerformance,
  WorkoutSetRecord,
  WorkoutVisual,
  WorkoutActivityRecord,
  ActivityPerformance,
  isCardioExercise,
  isStrengthExercise,
} from '@/types/workout';
import { toDateKey } from '@/utils/discipline';
import { clearAllActivityTimers } from '@/utils/activity-timer-storage';
import { cancelAllActivityTargetNotifications } from '@/utils/activity-notifications';
import { buildDisciplineStatuses, getSetProgressKey, isScheduledDate } from '@/utils/workout-schedule';
import {
  buildProgramExerciseInsertPayload,
  buildProgramExerciseTargetUpdatePayload,
  parseProgramExerciseRow,
  ProgramExerciseRow,
} from '@/utils/program-exercise';
import {
  ActivityContribution,
  ActivityTotals,
  aggregateActivityTotals,
  applyActivityTotalsDelta,
} from '@/utils/workout-tracking';
import {
  getActualSetCount,
  getDisciplineCountAfterUndo,
  getHighestSetNumber,
} from '@/utils/workout-sets';

/**
 * Bu fazda YALNIZCA strength hedefleri düzenlenebilir; tracking mode değiştiren
 * bir güncelleme yolu bilinçli olarak YOKTUR (sunucudaki
 * `program_exercises_mode_guard` de geçmişi olan egzersizde tür değişimini
 * reddeder).
 */
/**
 * Hedef düzenleme yükü — MOD DEĞİŞTİRMEZ.
 *
 * `trackingMode` yalnızca hangi hedef kolonlarının yazılacağını SEÇER; UPDATE
 * payload'ına hiç konmaz. Sunucudaki `program_exercises_mode_guard` performans
 * kanıtı olan egzersizin türünü zaten reddeder; istemci o yola hiç girmez.
 */
type ExerciseUpdates = {
  visual?: WorkoutVisual;
} & (
  | { trackingMode: 'sets_reps'; targetSets: number; targetReps: string; restSeconds: number }
  | { trackingMode: 'duration'; targetDurationSeconds: number }
  | { trackingMode: 'distance'; targetDistanceMeters: number }
);
type DayUpdates = Partial<Pick<WorkoutDay, 'name' | 'visual' | 'scheduledWeekday' | 'isOffDay'>>;

type WorkoutContextValue = {
  programs: WorkoutProgram[];
  isProgramsLoading: boolean;
  programsError?: string;
  activeProgramId?: string;
  activeProgramStartedAt?: string;
  disciplineStatuses: Record<string, DisciplineStatus>;
  completedSetCounts: Record<string, number>;
  /**
   * Disiplin KANITI — `completedSetCounts` ile simetriktir ve aynı gerekçeyle
   * silinmiş oturumları DA içerir. Takvim ve gün özeti bunu kullanır; kullanıcıya
   * görünen liste için `workoutActivityRecords` vardır.
   */
  activityTotals: Record<string, ActivityTotals>;
  workoutSessions: WorkoutSession[];
  workoutSets: WorkoutSetRecord[];
  /**
   * Salt okunur. Silinmiş oturumların kayıtlarını içermez. Bu fazda yazma
   * API'si YOKTUR; kardiyo kaydı oluşturma/düzenleme/silme sonraki fazdadır.
   */
  workoutActivityRecords: WorkoutActivityRecord[];
  refreshPrograms: () => Promise<void>;
  addProgram: (program: NewWorkoutProgram) => Promise<void>;
  activateProgram: (programId: string) => Promise<void>;
  deleteProgram: (programId: string) => Promise<void>;
  reorderPrograms: (programs: WorkoutProgram[]) => Promise<void>;
  deleteWorkoutSession: (sessionId: string) => Promise<void>;
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
  /**
   * Kardiyo kaydını OLUŞTURUR ya da GÜNCELLER.
   *
   * Aynı `session_id + program_exercise_id` için kayıt varsa UPDATE edilir;
   * ikinci satır ASLA oluşmaz. Dönen `activityTotals`, kayıt kalıcı olduktan
   * SONRAKİ gerçek toplamdır: çağıran taraf otomatik bitiş kararını henüz
   * yazılmamış React state'ine değil bu değere dayandırır.
   */
  saveActivityRecord: (
    dateKey: string,
    programExerciseId: string,
    performance: ActivityPerformance,
  ) => Promise<{ record: WorkoutActivityRecord; activityTotals: Record<string, ActivityTotals> }>;
  /** Kardiyo kaydını siler ve toplamları anında düzeltir. */
  deleteActivityRecord: (recordId: string) => Promise<void>;
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
  /** Kullanıcı içi el ile sıralama; küçük değer üstte. */
  sort_order: number | null;
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

/**
 * Aktivite kaydı satırı — canlı `workout_activity_records` şemasıyla birebir.
 * `rpe` numeric olduğu için Supabase string döndürebilir.
 */
type WorkoutActivityRecordRow = {
  id: string;
  session_id: string;
  program_exercise_id: string | null;
  exercise_name: string;
  tracking_mode: 'duration' | 'distance';
  target_duration_seconds: number | null;
  target_distance_meters: number | null;
  duration_seconds: number;
  distance_meters: number | null;
  rpe: number | string | null;
  completed_at: string;
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
  /** Soft delete. Dolu satır geçmişten ve analitikten gizlenir. */
  deleted_at: string | null;
};

type WorkoutSetRow = {
  drop_sets: unknown;
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

/**
 * Supabase'den gelen `drop_sets` değeri GÜVENİLMEZ kabul edilir: eski kayıtlar
 * `null` olabilir, elle düzenlenmiş bir satır beklenmedik şekil taşıyabilir.
 * Geçersiz her durumda boş dizi döner; ekran ve analitik asla patlamaz.
 */
function parseDropSets(value: unknown): WorkoutDropSetPerformance[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap<WorkoutDropSetPerformance>((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as { repetitions?: unknown; weightKg?: unknown };

    const repetitions = Number(candidate.repetitions);
    if (!Number.isInteger(repetitions) || repetitions < 0 || repetitions > 1000) return [];

    if (candidate.weightKg === undefined || candidate.weightKg === null) return [{ repetitions }];

    const weightKg = Number(candidate.weightKg);
    if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 99999) return [];

    return [{ repetitions, weightKg }];
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Beklenmeyen bir veritabanı hatası oluştu.';
}

export function WorkoutProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { syncWorkoutDay } = useRewards();
  /**
   * Sezonluk rank AYRI bir sistemdir ve XP/gül akışına hiç karışmaz.
   * `useOptionalRanks` bilinçlidir: rank sağlayıcısı bir sebeple mount
   * edilmemişse antrenman akışı hata vermeden çalışmaya devam eder — rank
   * yalnızca bir göstergedir, set kaydını veya kronometreyi engelleyemez.
   */
  const ranks = useOptionalRanks();
  const syncRank = ranks?.syncRank;
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
  /** Kullanıcıya görünen aktivite kayıtları — silinmiş oturumlar hariç. */
  const [workoutActivityRecords, setWorkoutActivityRecords] = useState<WorkoutActivityRecord[]>([]);
  /** Disiplin KANITI — silinmiş oturumlar dahil, gün+egzersiz düzeyinde toplanmış. */
  const [activityTotals, setActivityTotals] = useState<Record<string, ActivityTotals>>({});
  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const disciplineStatuses = useMemo(
    () =>
      buildDisciplineStatuses(
        disciplineHistory,
        manualDisciplineStatuses,
        activeProgram,
        activeProgramStartedAt,
        completedSetCounts,
        activityTotals,
      ),
    [
      activeProgram,
      activeProgramStartedAt,
      activityTotals,
      completedSetCounts,
      disciplineHistory,
      manualDisciplineStatuses,
    ],
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
      setWorkoutActivityRecords([]);
      setActivityTotals({});
      /**
       * Kardiyo kronometreleri de temizlenir: kayıt AsyncStorage'da yaşadığı
       * için oturum kapansa bile kalırdı ve başka bir hesap açıldığında yabancı
       * bir ölçüm geri yüklenirdi. Yalnız kendi ön eki silinir; mola kayıtları
       * ve profil/tema/dil verileri etkilenmez.
       */
      void clearAllActivityTimers();
      void cancelAllActivityTargetNotifications();
      setProgramsError(undefined);
      setIsProgramsLoading(false);
      return;
    }

    setIsProgramsLoading(true);
    setProgramsError(undefined);

    try {
      const { data: programData, error: programError } = await supabase
        .from('programs')
        .select('id, name, visual, is_active, active_from, created_at, sort_order')
        .eq('owner_id', user.id)
        // `sort_order` kullanıcının el ile belirlediği sıradır. `created_at`
        // yalnızca eşitlik bozucudur (migration öncesi satırlar için güvence).
        .order('sort_order', { ascending: true, nullsFirst: false })
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
              'id, program_day_id, exercise_id, custom_exercise_name, visual, tracking_mode, target_sets, target_reps, target_duration_seconds, target_distance_meters, rest_seconds, position',
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
              /**
               * TEK, saf ve test edilebilir parser. Sözleşmeyi ihlal eden bir
               * satır sessizce varsayılana çevrilmez: `ProgramExerciseContractError`
               * fırlatır ve mevcut `programsError` yoluna düşer.
               */
              .map<ProgramExercise>((exerciseRow) =>
                parseProgramExerciseRow(exerciseRow, parseVisual),
              ),
          })),
      }));

      const [sessionsResult, manualStatusesResult, historyResult] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select(
            'id, program_id, program_day_id, workout_date, status, started_at, last_resumed_at, accumulated_duration_seconds, completed_at, deleted_at',
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
      let activityRows: WorkoutActivityRecordRow[] = [];
      const sessionIds = sessionRows.map((session) => session.id);

      if (sessionIds.length > 0) {
        const { data: setData, error: setError } = await supabase
          .from('workout_sets')
          .select(
            'id, session_id, program_exercise_id, exercise_name, set_number, weight_kg, repetitions, rpe, drop_sets, completed_at',
          )
          .in('session_id', sessionIds);

        if (setError) throw setError;
        workoutSetRows = (setData ?? []) as WorkoutSetRow[];

        const { data: activityData, error: activityError } = await supabase
          .from('workout_activity_records')
          .select(
            'id, session_id, program_exercise_id, exercise_name, tracking_mode, target_duration_seconds, target_distance_meters, duration_seconds, distance_meters, rpe, completed_at',
          )
          .in('session_id', sessionIds);

        if (activityError) throw activityError;
        activityRows = (activityData ?? []) as WorkoutActivityRecordRow[];
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

      /**
       * SOFT DELETE SINIRI.
       *
       * `loadedSetCounts` (yukarıda) BİLİNÇLİ olarak bütün session'lardan
       * üretilir — silinmiş antrenmanlar dahil. O sayaç disiplin takviminin
       * kanıtıdır: filtrelenseydi antrenman silindiği anda o günün yeşil/turuncu
       * rengi ve streak geçmişi değişirdi.
       *
       * Aşağıdaki iki koleksiyon ise kullanıcıya görünen geçmiş ve BÜTÜN
       * analitiklerin (Geçmiş listesi, süre/egzersiz sayıları, egzersiz
       * gelişimi, rekorlar, hacim, AI bağlamı) tek kaynağıdır; silinmiş
       * session'lar buradan çıkarılır.
       */
      const deletedSessionIds = new Set(
        sessionRows.filter((session) => session.deleted_at).map((session) => session.id),
      );

      const loadedWorkoutSets = workoutSetRows.flatMap<WorkoutSetRecord>((workoutSet) => {
        const dateKey = sessionDateById.get(workoutSet.session_id);
        if (!dateKey) return [];
        if (deletedSessionIds.has(workoutSet.session_id)) return [];

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
          dropSets: parseDropSets(workoutSet.drop_sets),
          completedAt: workoutSet.completed_at,
        }];
      });

      /**
       * AKTİVİTE KAYITLARI — soft-delete sınırı setlerle BİREBİR aynıdır.
       *
       * `loadedActivityTotals` disiplin/takvim KANITIDIR ve BÜTÜN oturumlardan
       * üretilir (silinmiş antrenmanlar dahil): filtrelenseydi bir antrenman
       * silindiği anda o günün takvim rengi ve streak geçmişi değişirdi — tam
       * olarak `loadedSetCounts` için de geçerli olan gerekçe.
       *
       * `loadedActivityRecords` ise kullanıcıya görünecek koleksiyondur ve
       * silinmiş oturumların kayıtlarını İÇERMEZ; ileride history/progress
       * bunu kullanacak. Bu fazda hiçbir ekran onu okumaz.
       */
      const toActivityRecord = (
        row: WorkoutActivityRecordRow,
        dateKey: string,
      ): WorkoutActivityRecord => ({
        id: row.id,
        sessionId: row.session_id,
        programExerciseId: row.program_exercise_id ?? undefined,
        exerciseName: row.exercise_name,
        trackingMode: row.tracking_mode,
        targetDurationSeconds: row.target_duration_seconds ?? undefined,
        targetDistanceMeters: row.target_distance_meters ?? undefined,
        durationSeconds: row.duration_seconds,
        distanceMeters: row.distance_meters ?? undefined,
        rpe: row.rpe === null ? undefined : Number(row.rpe),
        completedAt: row.completed_at,
        dateKey,
      });

      const disciplineActivityRecords = activityRows.flatMap<WorkoutActivityRecord>((row) => {
        const dateKey = sessionDateById.get(row.session_id);
        if (!dateKey) return [];
        return [toActivityRecord(row, dateKey)];
      });

      const loadedActivityTotals = aggregateActivityTotals(disciplineActivityRecords);

      const loadedActivityRecords = disciplineActivityRecords.filter(
        (record) => !deletedSessionIds.has(record.sessionId),
      );

      const loadedSessions = sessionRows
        .filter((session) => session.status !== 'cancelled' && !session.deleted_at)
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
      setWorkoutActivityRecords(loadedActivityRecords);
      setActivityTotals(loadedActivityTotals);
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

    /**
     * Sunucudaki `programs_set_sort_order` tetikleyicisi yeni programa
     * `max(sort_order) + 1` verir, yani program sahibinin listesinin SONUNA
     * eklenir. Yerel state de aynı yere eklenmelidir; başa eklenirse program
     * önce üstte görünüp ilk yenilemede sona sıçrardı.
     * Mevcut programların sırası değişmez.
     */
    setPrograms((currentPrograms) => [...currentPrograms, createdProgram]);

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

  /**
   * Programları verilen sırayla kalıcı kılar.
   *
   * Optimistik: liste hemen güncellenir. RPC hata verirse ÖNCEKİ sıra geri
   * yüklenir ve hata çağırana iletilir (ekran yerelleştirilmiş uyarıyı gösterir).
   * Sunucu tarafında dizi kullanıcının programlarının tamamını içermeli ve
   * hepsi ona ait olmalıdır; aksi hâlde hiçbir satır yazılmaz.
   */
  async function reorderPrograms(reorderedPrograms: WorkoutProgram[]) {
    const previousPrograms = programs;
    setPrograms(reorderedPrograms);

    const { error } = await supabase.rpc('reorder_programs', {
      program_ids: reorderedPrograms.map((program) => program.id),
    });

    if (error) {
      setPrograms(previousPrograms);
      throw error;
    }
  }

  /**
   * Antrenmanı geçmişten ve analitikten kaldırır (soft delete).
   *
   * Setler ve session satırı sunucuda KALIR: o günün disiplin durumu, streak
   * geçmişi ve daha önce verilmiş ödüller değişmez. Optimistik kaldırma
   * başarısız olursa satır geri gelir.
   */
  async function deleteWorkoutSession(sessionId: string) {
    const previousSessions = workoutSessions;
    const previousSets = workoutSets;
    /**
     * AKTİVİTE KAYITLARI da yerel olarak ayrılır — setlerle AYNI kural.
     *
     * `activityTotals` bilinçli olarak DOKUNULMADAN bırakılır: o disiplin ve
     * ödül KANITIDIR ve sunucu tarafı da silinmiş oturumları kanıta dahil eder
     * (`exercise_done_units(..., exclude_deleted => false)`). Filtrelenseydi bir
     * antrenman silindiği anda o günün takvim rengi ve streak geçmişi değişirdi.
     */
    const previousActivityRecords = workoutActivityRecords;
    setWorkoutSessions((current) => current.filter((session) => session.id !== sessionId));
    setWorkoutSets((current) => current.filter((workoutSet) => workoutSet.sessionId !== sessionId));
    setWorkoutActivityRecords((current) => current.filter((record) => record.sessionId !== sessionId));

    const { error } = await supabase.rpc('soft_delete_workout_session', { session_id: sessionId });

    if (error) {
      setWorkoutSessions(previousSessions);
      setWorkoutSets(previousSets);
      setWorkoutActivityRecords(previousActivityRecords);
      throw error;
    }

    /**
     * Silinen antrenman rank kanıtı olmaktan çıkar: sunucu bir sonraki
     * uzlaştırmada ona bağlı RP için telafi satırı yazar. Disiplin takvimi,
     * streak geçmişi ve daha önce verilmiş XP ödülleri DEĞİŞMEZ (setler
     * sunucuda duruyor, takvim fonksiyonları `deleted_at` okumuyor).
     */
    void syncRank?.();
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
      /**
       * Yük türü AÇIKÇA yazar: her modda kendi hedef kolonları dolar, diğerleri
       * açıkça `null` kalır ve kardiyoda `rest_seconds` 0 olur. Varsayılana
       * güvenilmez — sözleşme tek yerde, `utils/program-exercise.ts` içinde.
       */
      .insert(
        buildProgramExerciseInsertPayload(exercise, {
          programDayId: dayId,
          position: day.exercises.length,
        }),
      )
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
    const databaseUpdates = buildProgramExerciseTargetUpdatePayload(updates);
    if (updates.visual !== undefined) databaseUpdates.visual = updates.visual;

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
                        // Yalnız AYNI türdeki egzersiz iyimser olarak güncellenir;
                        // tür uyuşmazsa yerel durum bozulmadan bırakılır.
                        exercise.id === programExerciseId &&
                        exercise.trackingMode === updates.trackingMode
                          ? ({ ...exercise, ...updates } as ProgramExercise)
                          : exercise,
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
    /**
     * Set akışı YALNIZCA `sets_reps` içindir. Kardiyo kimliği buraya sızarsa
     * Supabase'in RLS reddine bırakmak yerine istemcide ANLAŞILIR bir hata
     * üretilir — sunucu tarafı da `workout_sets_insert_own` politikasında
     * `tracking_mode = 'sets_reps'` şartıyla aynı kuralı zorlar.
     */
    if (!isStrengthExercise(exercise)) {
      throw new Error('Bu egzersiz set/tekrar ile takip edilmiyor; set kaydedilemez.');
    }
    const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);

    /**
     * Yeni set numarası, hedefe CLAMP EDİLMİŞ sayaçtan değil, aktif oturumdaki
     * GERÇEK en yüksek set numarasından türetilir. Hedefi 3 olan bir egzersize
     * 4. set eklendiğinde `completedSetCounts` 3'te sabit kaldığı için
     * `currentCount + 1` yeniden 4 üretip benzersizliği bozardı.
     */
    const nextSetNumber = getHighestSetNumber(workoutSets, session.id, programExerciseId) + 1;
    const dropSets = performance.dropSets ?? [];

    const { data, error } = await supabase
      .from('workout_sets')
      .insert({
        session_id: session.id,
        program_exercise_id: programExerciseId,
        exercise_name: exerciseName,
        set_number: nextSetNumber,
        weight_kg: performance.weightKg ?? null,
        repetitions: performance.repetitions,
        rpe: performance.rpe ?? null,
        // Drop setler ana satırın içinde; ayrı set satırı OLUŞTURULMAZ.
        drop_sets: dropSets,
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
        setNumber: nextSetNumber,
        ...performance,
        dropSets,
        completedAt: data.completed_at,
      },
    ]);

    /**
     * Disiplin/plan sayacı hedefe CLAMP EDİLMEYE devam eder: hedefin üstündeki
     * ekstra setler takvimde fazladan ilerleme üretmez. `currentCount` yalnızca
     * bu clamp için kullanılır, set numarası için değil.
     */
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
    /**
     * Rank uzlaştırması. XP çağrısından BAĞIMSIZDIR ve ayrıca beklenmez.
     * Sunucu defteri idempotent olduğu için tekrar çağrılması RP'yi ikinci kez
     * yazmaz; kısmi → tam geçişte yalnızca aradaki fark eklenir.
     */
    void syncRank?.();
  }

  async function undoCompletedSet(dateKey: string, programExerciseId: string) {
    const progressKey = getSetProgressKey(dateKey, programExerciseId);
    if ((completedSetCounts[progressKey] ?? 0) === 0) return;

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

    /**
     * Silinecek set, hedefe clamp edilmiş sayaçtan DEĞİL, oturumdaki gerçek en
     * yüksek set numarasından bulunur. Hedefi 3 olan egzersizde 4/3 durumunda
     * sayaç 3'te sabittir; eski davranış 4. yerine 3. seti silerdi.
     * Ana satır silindiğinde `drop_sets` JSON alanı da doğal olarak gider.
     */
    const lastSetNumber = getHighestSetNumber(workoutSets, session.id, programExerciseId);
    if (lastSetNumber === 0) return;

    // Hedef, disiplin sayacını yeniden hesaplamak için gerekir.
    const exercise = day?.exercises.find((item) => item.id === programExerciseId);

    /**
     * Geri alma da YALNIZCA set akışına aittir. Kardiyo kimliği buraya sızarsa
     * `workout_sets` üzerinde anlamsız bir DELETE denemek yerine istemcide
     * anlaşılır hata üretilir.
     */
    if (exercise && !isStrengthExercise(exercise)) {
      throw new Error('Bu egzersiz set/tekrar ile takip edilmiyor; set geri alınamaz.');
    }

    const { error } = await supabase
      .from('workout_sets')
      .delete()
      .eq('session_id', session.id)
      .eq('program_exercise_id', programExerciseId)
      .eq('set_number', lastSetNumber);

    if (error) throw error;

    setWorkoutSets((currentSets) =>
      currentSets.filter(
        (workoutSet) =>
          !(
            workoutSet.sessionId === session.id &&
            workoutSet.programExerciseId === programExerciseId &&
            workoutSet.setNumber === lastSetNumber
          ),
      ),
    );

    /**
     * Sayaç, mevcut değerden 1 ÇIKARILARAK değil, KALAN gerçek set sayısının
     * hedefe clamp'iyle yeniden hesaplanır.
     *
     * 4/3 durumunda sayaç zaten 3'te sabittir; 4. set silinince gerçek sayı 3
     * olur ve sayaç 3 KALMALIDIR. Eski çıkarma onu 2'ye düşürüp o günün
     * disiplin ilerlemesini haksız yere geri alıyordu.
     */
    const remainingActualSetCount = Math.max(
      getActualSetCount(workoutSets, session.id, programExerciseId) - 1,
      0,
    );
    const targetSets = exercise?.targetSets;

    setCompletedSetCounts((currentCounts) => ({
      ...currentCounts,
      [progressKey]:
        targetSets === undefined
          ? Math.max((currentCounts[progressKey] ?? 0) - 1, 0)
          : getDisciplineCountAfterUndo(remainingActualSetCount, targetSets),
    }));
  }

  /**
   * KARDİYO KAYDI — oluştur ya da güncelle.
   *
   * Sahiplik istemcide de doğrulanır: egzersiz kullanıcının programında
   * bulunmalı, kardiyo türünde olmalı ve o gün için mevcut oturum sözleşmesine
   * uyan bir antrenman bulunmalıdır. Sunucudaki RLS zinciri aynı kuralı zorlar;
   * istemci kontrolü kullanıcıyı anlaşılmaz bir `permission denied` yerine
   * okunur bir hataya düşürmek içindir.
   */
  async function saveActivityRecord(
    dateKey: string,
    programExerciseId: string,
    performance: ActivityPerformance,
  ) {
    const program = programs.find((item) =>
      item.days.some((day) => day.exercises.some((exercise) => exercise.id === programExerciseId)),
    );
    const day = program?.days.find((item) =>
      item.exercises.some((exercise) => exercise.id === programExerciseId),
    );
    const exercise = day?.exercises.find((item) => item.id === programExerciseId);

    if (!exercise) throw new Error('Aktivitenin bağlı olduğu egzersiz bulunamadı.');
    if (!isCardioExercise(exercise)) {
      throw new Error('Bu egzersiz süre/mesafe ile takip edilmiyor; aktivite kaydedilemez.');
    }

    /**
     * Oturum sözleşmesi set akışıyla AYNIDIR: yeni bir akış tasarlanmaz.
     * `running` oturum aranır; kullanıcı tamamlanmış bir oturuma dönüp kayıt
     * eklemek isterse ekran önce `resumeWorkout` çağırır, tıpkı ekstra set
     * akışında olduğu gibi.
     */
    const session = workoutSessions.find(
      (item) =>
        item.programId === program?.id &&
        item.dayId === day?.id &&
        item.dateKey === dateKey &&
        item.status === 'running',
    );
    if (!session) throw new Error('Aktiviteyi kaydetmek için antrenmanı başlatmalısın.');

    const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
    const existing = workoutActivityRecords.find(
      (record) => record.sessionId === session.id && record.programExerciseId === programExerciseId,
    );

    const performancePayload = {
      duration_seconds: performance.durationSeconds,
      distance_meters: performance.distanceMeters ?? null,
      rpe: performance.rpe ?? null,
      completed_at: new Date().toISOString(),
    };

    let saved: WorkoutActivityRecord;

    if (existing) {
      /**
       * GÜNCELLEME — yalnız performans alanları.
       *
       * Kimlik (`session_id`, `program_exercise_id`) ve snapshot alanları
       * (`tracking_mode`, `exercise_name`, hedefler) yük'e HİÇ konmaz; sunucudaki
       * `workout_activity_records_guard` bunları değiştirmeyi zaten reddeder.
       * İkinci bir satır oluşmaz.
       */
      const { data, error } = await supabase
        .from('workout_activity_records')
        .update(performancePayload)
        .eq('id', existing.id)
        .select('completed_at')
        .single();

      if (error) throw error;

      saved = {
        ...existing,
        durationSeconds: performance.durationSeconds,
        distanceMeters: performance.distanceMeters,
        rpe: performance.rpe,
        completedAt: data.completed_at,
      };
    } else {
      /** YENİ KAYIT — snapshot alanları burada, yalnız bir kez yazılır. */
      const { data, error } = await supabase
        .from('workout_activity_records')
        .insert({
          session_id: session.id,
          program_exercise_id: programExerciseId,
          exercise_name: exerciseName,
          tracking_mode: exercise.trackingMode,
          target_duration_seconds:
            exercise.trackingMode === 'duration' ? exercise.targetDurationSeconds : null,
          target_distance_meters:
            exercise.trackingMode === 'distance' ? exercise.targetDistanceMeters : null,
          ...performancePayload,
        })
        .select('id, completed_at')
        .single();

      if (error) throw error;

      saved = {
        id: data.id,
        sessionId: session.id,
        programExerciseId,
        exerciseName,
        trackingMode: exercise.trackingMode,
        targetDurationSeconds:
          exercise.trackingMode === 'duration' ? exercise.targetDurationSeconds : undefined,
        targetDistanceMeters:
          exercise.trackingMode === 'distance' ? exercise.targetDistanceMeters : undefined,
        durationSeconds: performance.durationSeconds,
        distanceMeters: performance.distanceMeters,
        rpe: performance.rpe,
        completedAt: data.completed_at,
        dateKey,
      };
    }

    const toContribution = (record: WorkoutActivityRecord): ActivityContribution => ({
      dateKey: record.dateKey,
      programExerciseId: record.programExerciseId,
      durationSeconds: record.durationSeconds,
      distanceMeters: record.distanceMeters,
    });

    /**
     * Toplamlar YENİDEN YÜKLENMEDEN düzeltilir: eski katkı çıkarılır, yeni katkı
     * eklenir. Aynı günün başka oturumlarındaki katkılar aynı anahtarda durduğu
     * için korunur. Öngörülen değer çağırana DÖNDÜRÜLÜR; otomatik bitiş kararı
     * henüz yazılmamış state'e değil buna dayanır.
     */
    const projectedTotals = applyActivityTotalsDelta(
      activityTotals,
      existing ? toContribution(existing) : undefined,
      toContribution(saved),
    );

    setActivityTotals(projectedTotals);
    setWorkoutActivityRecords((current) =>
      existing
        ? current.map((record) => (record.id === saved.id ? saved : record))
        : [...current, saved],
    );

    /**
     * Ödül ve rank uzlaştırması set akışıyla BİREBİR aynı sırada ve aynı
     * biçimde (beklenmeden) tetiklenir: kayıt kalıcı olmadan buraya gelinmez,
     * sunucu defteri idempotent olduğu için tekrar çağrı çift ödül üretmez.
     */
    void syncWorkoutDay(toDateKey(new Date()), dateKey);
    void syncRank?.();

    return { record: saved, activityTotals: projectedTotals };
  }

  /**
   * KARDİYO KAYDINI SİLER.
   *
   * Daha önce verilmiş XP/gül GERİ ALINMAZ — `reward_ledger` append-only'dir ve
   * bu davranış mevcut set undo ile BİREBİR tutarlıdır (`undoCompletedSet` de
   * ödül geri almaz). Rank kanıtı bir sonraki uzlaştırmada sunucu tarafından
   * yeniden hesaplanır.
   */
  async function deleteActivityRecord(recordId: string) {
    const existing = workoutActivityRecords.find((record) => record.id === recordId);
    if (!existing) return;

    const { error } = await supabase.from('workout_activity_records').delete().eq('id', recordId);
    if (error) throw error;

    setActivityTotals((current) =>
      applyActivityTotalsDelta(
        current,
        {
          dateKey: existing.dateKey,
          programExerciseId: existing.programExerciseId,
          durationSeconds: existing.durationSeconds,
          distanceMeters: existing.distanceMeters,
        },
        undefined,
      ),
    );
    setWorkoutActivityRecords((current) => current.filter((record) => record.id !== recordId));

    void syncRank?.();
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
    const session = workoutSessions.find((item) => item.id === sessionId);
    if (!session || (session.status !== 'paused' && session.status !== 'completed')) return;

    const { error } = await supabase
      .from('workout_sessions')
      .update({
        status: 'running',
        last_resumed_at: resumedAt,
        // Bütün planlı setler tamamlandığında oturum otomatik kapanır.
        // Kullanıcı ekstra set için devam ederse aynı oturum yeniden açılır.
        completed_at: null,
      })
      .eq('id', sessionId);

    if (error) throw error;

    setWorkoutSessions((currentSessions) =>
      currentSessions.map((currentSession) =>
        currentSession.id === sessionId
          ? {
              ...currentSession,
              status: 'running',
              lastResumedAt: resumedAt,
              completedAt: undefined,
            }
          : currentSession,
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

  /**
   * Provider değeri doğrudan üretilir. Buradaki işlemler render içinde
   * tanımlandığı için eksik bir `useMemo` bağımlılığı eski state'i yakalayan
   * fonksiyonları tüketicilere taşırdı. Özellikle aktivite INSERT'inden sonra
   * eski kayıt listesini gören ikinci işlem yeniden INSERT deneyebilirdi.
   */
  const value: WorkoutContextValue = {
    programs,
    isProgramsLoading,
    programsError,
    activeProgramId,
    activeProgramStartedAt,
    disciplineStatuses,
    completedSetCounts,
    workoutSessions,
    workoutSets,
    workoutActivityRecords,
    activityTotals,
    refreshPrograms,
    addProgram,
    activateProgram,
    deleteProgram,
    deleteWorkoutSession,
    reorderPrograms,
    addExerciseToDay,
    removeExerciseFromDay,
    reorderExercisesInDay,
    reorderDays,
    updateProgram,
    updateDay,
    updateExercise,
    completeSet,
    undoCompletedSet,
    saveActivityRecord,
    deleteActivityRecord,
    resetCompletedSets,
    startWorkout,
    pauseWorkout,
    resumeWorkout,
    finishWorkout,
    isDateScheduled: isDateScheduledForProgram,
    cycleDisciplineStatus,
  };

  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>;
}

export function useWorkout() {
  const context = useContext(WorkoutContext);

  if (!context) {
    throw new Error('useWorkout, WorkoutProvider içinde kullanılmalıdır.');
  }

  return context;
}
