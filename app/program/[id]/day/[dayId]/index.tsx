import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgramDetailScroll } from '@/components/program-detail-scroll';
import ProgramExerciseList from '@/components/program-exercise-list';
import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { getWeekdayLabel, getWeekdayOptions } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { useWorkout } from '@/context/workout-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  ProgramExercise,
  Weekday,
  WorkoutSetPerformance,
  WorkoutSetRecord,
  WorkoutVisual,
} from '@/types/workout';
import { toDateKey } from '@/utils/discipline';
import {
  cancelRestNotification,
  isRestNotificationScheduled,
  scheduleRestNotification,
} from '@/utils/rest-notifications';
import { getSetProgressKey } from '@/utils/workout-schedule';
import {
  createRestTimer,
  formatRestTimerValue,
  getRestTimerProgress,
  RestTimerState,
} from '@/utils/rest-timer';
import {
  attachRestNotificationId,
  getRestTimerStorageKey,
  loadRestTimer,
  removeRestTimer,
  saveRestTimer,
} from '@/utils/rest-timer-storage';
import { formatDuration, getWorkoutDurationSeconds } from '@/utils/workout-session';
import { DEFAULT_EXERCISE_VISUAL, getDayVisual, getExerciseVisual } from '@/utils/workout-visual';

export default function WorkoutDayScreen() {
  const { id, dayId } = useLocalSearchParams<{ id: string; dayId: string }>();
  const {
    completeSet,
    completedSetCounts,
    activeProgramId,
    finishWorkout,
    isProgramsLoading,
    pauseWorkout,
    programs,
    removeExerciseFromDay,
    reorderDays,
    reorderExercisesInDay,
    resetCompletedSets,
    resumeWorkout,
    startWorkout,
    undoCompletedSet,
    updateDay,
    updateExercise,
    workoutSessions,
    workoutSets,
  } = useWorkout();
  const { restTimerEnabled } = useProfile();
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = createStyles(colors);
  const weekdayOptions = getWeekdayOptions(locale);
  const program = programs.find((item) => item.id === id);
  const day = program?.days.find((item) => item.id === dayId);
  const today = new Date();
  const todayKey = toDateKey(today);
  const restTimerStorageKey = getRestTimerStorageKey(id, dayId, todayKey);
  const workoutSession = workoutSessions.find(
    (session) =>
      session.programId === id &&
      session.dayId === dayId &&
      session.dateKey === todayKey &&
      session.status !== 'completed',
  );
  const isWorkoutRunning = workoutSession?.status === 'running';
  // Mount durumu YALNIZCA React state yazımını kontrol eder; molanın mantıksal
  // geçerliliği AsyncStorage'daki kaydın `timerId` değerinden okunur.
  const isMountedRef = useRef(true);
  const [clockNow, setClockNow] = useState(Date.now());
  const [restTimer, setRestTimer] = useState<RestTimerState>();
  const [isWorkoutActionPending, setIsWorkoutActionPending] = useState(false);
  const [pendingExerciseId, setPendingExerciseId] = useState<string>();
  const [isDayEditorOpen, setIsDayEditorOpen] = useState(false);
  const [dayNameDraft, setDayNameDraft] = useState('');
  const [dayVisualDraft, setDayVisualDraft] = useState<WorkoutVisual>({ type: 'text', text: '1' });
  const [dayWeekdayDraft, setDayWeekdayDraft] = useState<Weekday>(1);
  const [dayIsOffDraft, setDayIsOffDraft] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editingExerciseName, setEditingExerciseName] = useState('');
  const [exerciseVisualDraft, setExerciseVisualDraft] = useState<WorkoutVisual>(DEFAULT_EXERCISE_VISUAL);
  const [targetSetsDraft, setTargetSetsDraft] = useState('3');
  const [targetRepsDraft, setTargetRepsDraft] = useState('8-10');
  const [restSecondsDraft, setRestSecondsDraft] = useState('90');
  // Yalnızca ekran seçimi; programın kalıcı sırasını değiştirmez.
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>();
  const [weightInput, setWeightInput] = useState('');
  const [repetitionsInput, setRepetitionsInput] = useState('');
  const [rpeInput, setRpeInput] = useState('');
  const [validationError, setValidationError] = useState<string>();
  const [isSetDetailsOpen, setIsSetDetailsOpen] = useState(false);

  // Aktif egzersiz: kullanıcı panelden seçtiyse o, yoksa program sırasındaki
  // ilk tamamlanmamış egzersiz.
  // useMemo: effect bağımlılıklarının her render'da değişmesini engeller.
  const dayExercises = useMemo(() => day?.exercises ?? [], [day?.exercises]);
  // Program sırasındaki ilk tamamlanmamış egzersiz.
  const currentExerciseId = dayExercises.find(
    (exercise) => (completedSetCounts[getSetProgressKey(todayKey, exercise.id)] ?? 0) < exercise.targetSets,
  )?.id;
  const activeExercise =
    dayExercises.find((exercise) => exercise.id === selectedExerciseId) ??
    dayExercises.find((exercise) => exercise.id === currentExerciseId) ??
    dayExercises[0];
  const activeExerciseName = activeExercise
    ? getProgramExerciseName(activeExercise.exerciseId, activeExercise.customExerciseName)
    : '';
  const activeCompletedSets = activeExercise
    ? Math.min(completedSetCounts[getSetProgressKey(todayKey, activeExercise.id)] ?? 0, activeExercise.targetSets)
    : 0;
  const activeSetRecords = activeExercise
    ? workoutSets
        .filter(
          (workoutSet) => workoutSet.dateKey === todayKey && workoutSet.programExerciseId === activeExercise.id,
        )
        .sort((first, second) => first.setNumber - second.setNumber)
    : [];
  const activePreviousRecords = activeExercise
    ? workoutSets
        .filter(
          (workoutSet) => workoutSet.dateKey !== todayKey && workoutSet.programExerciseId === activeExercise.id,
        )
        .sort((first, second) => second.dateKey.localeCompare(first.dateKey))
    : [];
  const activePreviousSet = activePreviousRecords.find(
    (workoutSet) =>
      workoutSet.dateKey === activePreviousRecords[0]?.dateKey &&
      workoutSet.setNumber === activeCompletedSets + 1,
  );
  const isActiveExerciseComplete = Boolean(activeExercise && activeCompletedSets >= activeExercise.targetSets);


  // Panelden seçilen egzersizin son seti tamamlandığında seçim bırakılır ve
  // ekran program sırasındaki ilk tamamlanmamış egzersize geçer. Set kaydı
  // başarısız olursa sayaç artmadığı için seçim korunur.
  useEffect(() => {
    if (!selectedExerciseId) return;

    const selectedExercise = dayExercises.find((exercise) => exercise.id === selectedExerciseId);
    if (!selectedExercise) {
      setSelectedExerciseId(undefined);
      return;
    }

    const completedSets = completedSetCounts[getSetProgressKey(todayKey, selectedExercise.id)] ?? 0;
    if (completedSets >= selectedExercise.targetSets) setSelectedExerciseId(undefined);
  }, [completedSetCounts, dayExercises, selectedExerciseId, todayKey]);

  // Aktif egzersiz veya tamamlanan set değişince giriş alanları önerilen
  // değerlerle tazelenir (önceki antrenmandaki set veya hedef tekrar).
  useEffect(() => {
    setValidationError(undefined);
    setRpeInput('');
    setWeightInput(activePreviousSet?.weightKg?.toString() ?? '');
    const suggestedRepetitions =
      activePreviousSet?.repetitions ?? getFirstTargetRepetition(activeExercise?.targetReps ?? '');
    setRepetitionsInput(suggestedRepetitions?.toString() ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExercise?.id, activeCompletedSets]);


  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // Ekrandan çıkmak molayı bitirmez: yalnızca state güncellemesi durur.
      // Aktif mola, kaydı ve bildirimi çalışmaya devam eder.
      isMountedRef.current = false;
    };
  }, []);

  // Tek bir interval; mola sürerken (fazla süre dahil) veya antrenman
  // çalışırken saniyede bir güncellenir ve temizlenerek sızıntı bırakmaz.
  useEffect(() => {
    if (workoutSession?.status !== 'running' && !restTimer) return;

    setClockNow(Date.now());
    const interval = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [restTimer, workoutSession?.status]);

  // Mola sayacı profil ayarından kapatılırsa ekrandaki sayaç da anında düşer;
  // kayıt ve bildirim temizliğini profil ekranı üstlenir.
  useEffect(() => {
    if (!restTimerEnabled) setRestTimer(undefined);
  }, [restTimerEnabled]);

  // Uygulama yeniden açıldığında kayıtlı mola geri yüklenir. Karar, workout
  // verisi Supabase'den yüklenmeden verilmez; aksi hâlde ilk render'daki
  // geçici `undefined` oturum yüzünden geçerli kayıt silinebilirdi.
  useEffect(() => {
    if (isProgramsLoading) return;

    let isEffectActive = true;

    async function restoreRestTimer() {
      const storedTimer = await loadRestTimer(restTimerStorageKey);
      if (!isEffectActive || !isMountedRef.current) return;
      if (!storedTimer) return;

      // Hydration tamamlandı: oturum çalışmıyorsa kayıt gerçekten bayattır.
      if (!isWorkoutRunning) {
        await Promise.allSettled([
          removeRestTimer(restTimerStorageKey, storedTimer.timerId),
          cancelRestNotification(storedTimer.notificationId),
        ]);
        return;
      }

      // Bildirim zamanı geçtiyse yeniden planlanmaz; kayıt yalnızca sayaç içindir.
      const stillScheduled = await isRestNotificationScheduled(storedTimer.notificationId);
      if (!isEffectActive || !isMountedRef.current) return;

      setClockNow(Date.now());
      setRestTimer(stillScheduled ? storedTimer : { ...storedTimer, notificationId: undefined });
    }

    restoreRestTimer().catch(() => {
      // Sayaç okunamazsa antrenman ekranı normal çalışmaya devam eder.
    });

    return () => {
      isEffectActive = false;
    };
  }, [isProgramsLoading, isWorkoutRunning, restTimerStorageKey]);

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.notFound}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.notFoundTitle}>{t('day.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!program || !day) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: t('day.notFoundTitle') }} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={42} color={colors.textTertiary} />
          <Text style={styles.notFoundTitle}>{t('day.notFound')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/programs')}
            style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{t('programDetail.backToPrograms')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const selectedProgramId = program.id;
  const selectedDayId = day.id;
  const selectedDayExercises = day.exercises;
  const programDays = program.days;
  const dayIndex = program.days.findIndex((item) => item.id === day.id);
  const isScheduledToday = day.scheduledWeekday === today.getDay();
  const isActiveProgram = program.id === activeProgramId;
  const canTrackToday = isScheduledToday && isActiveProgram;
  const totalTargetSets = day.exercises.reduce((total, exercise) => total + exercise.targetSets, 0);
  const totalCompletedSets = day.exercises.reduce(
    (total, exercise) =>
      total +
      Math.min(completedSetCounts[getSetProgressKey(todayKey, exercise.id)] ?? 0, exercise.targetSets),
    0,
  );
  // Aynı programın aynı günü için geçmiş tamamlanmış antrenmanların ortalaması
  // (bugünkü oturum hariç).
  const previousSessions = workoutSessions.filter(
    (session) =>
      session.programId === program.id &&
      session.dayId === day.id &&
      session.dateKey !== todayKey &&
      session.status === 'completed',
  );
  const averageDurationSeconds = previousSessions.length
    ? Math.round(
        previousSessions.reduce((total, session) => total + session.accumulatedDurationSeconds, 0) /
          previousSessions.length,
      )
    : undefined;
  const isWorkoutComplete = totalTargetSets > 0 && totalCompletedSets === totalTargetSets;
  const hasProgress = totalCompletedSets > 0;
  // Antrenman başlamadan önce gün, referans tasarımdaki sade plan görünümünü
  // kullanır; antrenman başlayınca set giriş kartlarına geçilir.
  const isPlanMode = !workoutSession && !hasProgress;
  const elapsedSeconds = workoutSession ? getWorkoutDurationSeconds(workoutSession, clockNow) : 0;
  const restProgress = restTimer ? getRestTimerProgress(restTimer, clockNow) : undefined;
  const canCompleteSets = canTrackToday && workoutSession?.status === 'running';

  async function submitActiveSet() {
    if (!activeExercise || pendingExerciseId) return;

    const repetitions = parseNumberInput(repetitionsInput);
    const weightKg = parseOptionalNumberInput(weightInput);
    const rpe = parseOptionalNumberInput(rpeInput);

    if (repetitions === undefined || !Number.isInteger(repetitions) || repetitions < 0 || repetitions > 1000) {
      setValidationError(t('day.repsValidation'));
      return;
    }

    if (weightKg === null || (weightKg !== undefined && (weightKg < 0 || weightKg > 99999))) {
      setValidationError(t('day.weightValidation'));
      return;
    }

    if (rpe === null || (rpe !== undefined && (rpe < 0 || rpe > 10))) {
      setValidationError(t('day.rpeValidation'));
      return;
    }

    setValidationError(undefined);
    await handleCompleteSet(activeExercise, { repetitions, weightKg, rpe });
  }

  /**
   * Aktif molayı gerçekten bitirir: kayıt silinir, bildirim iptal edilir.
   * Kayıt silindiği için bekleyen bildirim planlaması da geçersiz kalır.
   */
  async function clearRestTimer(timer: RestTimerState | undefined = restTimer) {
    setRestTimer(undefined);
    await Promise.allSettled([
      removeRestTimer(restTimerStorageKey),
      cancelRestNotification(timer?.notificationId),
    ]);
  }

  async function handleWorkoutToggle() {
    setIsWorkoutActionPending(true);
    try {
      void Haptics.selectionAsync();
      if (!workoutSession) {
        await startWorkout(selectedProgramId, selectedDayId, todayKey);
        return;
      }

      if (workoutSession.status === 'running') {
        await pauseWorkout(workoutSession.id);
        void clearRestTimer();
        return;
      }

      await resumeWorkout(workoutSession.id);
    } catch (error) {
      showWorkoutError(t('day.workoutStateFailed'), error, t);
    } finally {
      setIsWorkoutActionPending(false);
    }
  }

  function handleFinishWorkout() {
    if (!workoutSession) return;

    Alert.alert(t('day.finishTitle'), t('day.finishBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('day.finish'),
        onPress: () => {
          void finishCurrentWorkout(workoutSession.id);
        },
      },
    ]);
  }

  async function finishCurrentWorkout(sessionId: string) {
    setIsWorkoutActionPending(true);
    try {
      await finishWorkout(sessionId);
      void clearRestTimer();
    } catch (error) {
      showWorkoutError(t('day.finishFailed'), error, t);
    } finally {
      setIsWorkoutActionPending(false);
    }
  }

  async function handleCompleteSet(exercise: ProgramExercise, performance: WorkoutSetPerformance) {
    setPendingExerciseId(exercise.id);
    try {
      await completeSet(todayKey, exercise.id, exercise.targetSets, performance);

      const completesWholeWorkout = totalCompletedSets + 1 >= totalTargetSets;
      if (completesWholeWorkout) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (workoutSession?.status === 'running') await finishWorkout(workoutSession.id);
        void clearRestTimer();
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (!restTimerEnabled || exercise.restSeconds <= 0) return;

      const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
      // Yeni mola başlamadan önce önceki molanın bildirimi iptal edilir.
      await cancelRestNotification(restTimer?.notificationId);

      const nextRestTimer = createRestTimer(exerciseName, exercise.restSeconds, Date.now());
      setClockNow(Date.now());
      setRestTimer(nextRestTimer);
      // Sıra garanti altına alınır: kimliksiz kayıt, kimlikli kayıttan önce yazılır.
      await saveRestTimer(restTimerStorageKey, nextRestTimer);

      const notificationId = await scheduleRestNotification(exercise.restSeconds, {
        body: t('rest.notificationBody', { name: exerciseName }),
        title: t('rest.notificationTitle'),
      });

      if (!notificationId) return;

      // Kimlik yalnızca aynı mola hâlâ kayıtlıysa eklenir. Ekrandan çıkılmış
      // olsa bile kayıt güncellenir; böylece bildirim sonradan iptal edilebilir.
      const isAttached = await attachRestNotificationId(
        restTimerStorageKey,
        nextRestTimer.timerId,
        notificationId,
      );

      if (!isAttached) {
        // Mola bu sırada bitti/durduruldu, yenisi başladı veya ayar kapatıldı.
        await cancelRestNotification(notificationId);
        return;
      }

      if (isMountedRef.current) {
        setRestTimer((current) =>
          current?.timerId === nextRestTimer.timerId ? { ...current, notificationId } : current,
        );
      }
    } catch (error) {
      showWorkoutError(t('day.setSaveFailed'), error, t);
    } finally {
      setPendingExerciseId(undefined);
    }
  }

  async function handleUndoSet(exercise: ProgramExercise) {
    setPendingExerciseId(exercise.id);
    try {
      await undoCompletedSet(todayKey, exercise.id);
    } catch (error) {
      showWorkoutError(t('day.setUndoFailed'), error, t);
    } finally {
      setPendingExerciseId(undefined);
    }
  }

  async function handleResetSets() {
    setIsWorkoutActionPending(true);
    try {
      await resetCompletedSets(
        todayKey,
        selectedDayExercises.map((exercise) => exercise.id),
      );
      void clearRestTimer();
    } catch (error) {
      showWorkoutError(t('day.resetFailed'), error, t);
    } finally {
      setIsWorkoutActionPending(false);
    }
  }

  function openDayEditor() {
    if (!day) return;
    setDayNameDraft(day.name);
    setDayVisualDraft(getDayVisual(day.visual, dayIndex));
    setDayWeekdayDraft(day.scheduledWeekday ?? weekdayOptions[dayIndex % weekdayOptions.length].value);
    setDayIsOffDraft(day.isOffDay ?? false);
    setIsDayEditorOpen(true);
  }

  async function saveDayChanges() {
    const trimmedName = dayNameDraft.trim();
    if (!trimmedName) {
      Alert.alert(t('day.dayNameRequiredTitle'), t('day.dayNameRequiredBody'));
      return;
    }

    const weekdayAlreadyUsed = programDays.some(
      (programDay) => programDay.id !== selectedDayId && programDay.scheduledWeekday === dayWeekdayDraft,
    );
    if (weekdayAlreadyUsed) {
      Alert.alert(t('day.weekdayUsedTitle'), t('day.weekdayUsedBody', { weekday: getWeekdayLabel(dayWeekdayDraft, locale) }));
      return;
    }

    try {
      await updateDay(selectedProgramId, selectedDayId, {
        isOffDay: dayIsOffDraft,
        name: trimmedName,
        scheduledWeekday: dayWeekdayDraft,
        visual: dayVisualDraft,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsDayEditorOpen(false);
    } catch (error) {
      showWorkoutError(t('day.updateFailed'), error, t);
    }
  }

  async function moveDay(direction: -1 | 1) {
    const targetIndex = dayIndex + direction;
    if (targetIndex < 0 || targetIndex >= programDays.length) return;

    const reorderedDays = [...programDays];
    [reorderedDays[dayIndex], reorderedDays[targetIndex]] = [reorderedDays[targetIndex], reorderedDays[dayIndex]];
    try {
      void Haptics.selectionAsync();
      await reorderDays(selectedProgramId, reorderedDays);
    } catch (error) {
      showWorkoutError(t('day.reorderFailed'), error, t);
    }
  }

  function openExerciseEditor(exercise: ProgramExercise, exerciseName: string) {
    setEditingExerciseId(exercise.id);
    setEditingExerciseName(exerciseName);
    setExerciseVisualDraft(getExerciseVisual(exercise.visual));
    setTargetSetsDraft(String(exercise.targetSets));
    setTargetRepsDraft(exercise.targetReps);
    setRestSecondsDraft(String(exercise.restSeconds));
  }

  async function saveExerciseChanges() {
    if (!editingExerciseId) return;

    const targetSets = Number(targetSetsDraft);
    const restSeconds = Number(restSecondsDraft);
    const targetReps = targetRepsDraft.trim();

    if (!Number.isInteger(targetSets) || targetSets < 1 || targetSets > 20) {
      Alert.alert(t('day.setsInvalidTitle'), t('day.setsInvalidBody'));
      return;
    }

    if (!/^\d{1,2}(-\d{1,2})?$/.test(targetReps)) {
      Alert.alert(t('day.repsInvalidTitle'), t('day.repsInvalidBody'));
      return;
    }

    if (!Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 600) {
      Alert.alert(t('day.restInvalidTitle'), t('day.restInvalidBody'));
      return;
    }

    try {
      await updateExercise(selectedProgramId, selectedDayId, editingExerciseId, {
        restSeconds,
        targetReps,
        targetSets,
        visual: exerciseVisualDraft,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditingExerciseId(null);
    } catch (error) {
      showWorkoutError(t('day.exerciseUpdateFailed'), error, t);
    }
  }

  function confirmRemoveExercise() {
    if (!editingExerciseId) return;
    const exerciseId = editingExerciseId;

    Alert.alert(t('day.removeExercise'), t('day.removeExerciseBody', { name: editingExerciseName }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          setEditingExerciseId(null);
          void removeExerciseFromDay(selectedProgramId, selectedDayId, exerciseId).catch((error) =>
            showWorkoutError(t('day.removeFailed'), error, t),
          );
        },
      },
    ]);
  }

  /** Gün işlemleri referans gövdeyi bozmamak için başlık menüsünde tutulur. */
  function openDayMenu() {
    Alert.alert(day?.name ?? '', t('day.dayOptions'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('day.editDay'), onPress: openDayEditor },
      ...(dayIndex > 0 ? [{ text: t('day.moveUp'), onPress: () => void moveDay(-1) }] : []),
      ...(dayIndex < programDays.length - 1
        ? [{ text: t('day.moveDown'), onPress: () => void moveDay(1) }]
        : []),
    ]);
  }

  const dayHeaderButton = (
    <Pressable
      accessibilityLabel={t('day.dayOptions')}
      accessibilityRole="button"
      hitSlop={10}
      onPress={openDayMenu}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
      <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
    </Pressable>
  );

  const daySummaryRow = (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryText}>
        {t('day.summary', { exercises: day.exercises.length, sets: totalTargetSets })}
      </Text>
      {!day.isOffDay && (
        <Pressable
          accessibilityLabel={t('day.addExerciseLabel')}
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: '/program/[id]/day/[dayId]/add-exercise',
              params: { id: selectedProgramId, dayId: selectedDayId },
            })
          }
          style={({ pressed }) => [styles.addExerciseButton, pressed && styles.pressed]}>
          <Text style={styles.addExerciseText}>{t('day.addExercise')}</Text>
        </Pressable>
      )}
    </View>
  );

  const dayEditor = isDayEditorOpen && (
    <View style={styles.editor}>
      <Text style={styles.editorTitle}>{t('day.editDay')}</Text>
      <View style={styles.field}>
        <Text style={styles.label}>{t('day.dayName')}</Text>
        <TextInput
          autoFocus
          maxLength={30}
          onChangeText={setDayNameDraft}
          placeholder={t('day.dayName')}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          style={styles.input}
          value={dayNameDraft}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t('day.calendarDay')}</Text>
        <ScrollView contentContainerStyle={styles.weekdayOptions} horizontal showsHorizontalScrollIndicator={false}>
          {weekdayOptions.map((option) => {
            const selected = dayWeekdayDraft === option.value;
            const usedByOtherDay = programDays.some(
              (programDay) => programDay.id !== selectedDayId && programDay.scheduledWeekday === option.value,
            );

            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: usedByOtherDay }}
                disabled={usedByOtherDay}
                key={option.value}
                onPress={() => setDayWeekdayDraft(option.value)}
                style={({ pressed }) => [
                  styles.weekdayOption,
                  selected && styles.weekdayOptionSelected,
                  usedByOtherDay && styles.weekdayOptionDisabled,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.weekdayOptionText, selected && styles.weekdayOptionTextSelected]}>
                  {option.shortLabel}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>{t('day.offDay')}</Text>
          <Text style={styles.caption}>{t('day.offDayCaption')}</Text>
        </View>
        <Switch
          onValueChange={setDayIsOffDraft}
          trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
          value={dayIsOffDraft}
        />
      </View>

      <WorkoutVisualPicker onSelect={setDayVisualDraft} selectedVisual={dayVisualDraft} />

      <View style={styles.editorActions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsDayEditorOpen(false)}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void saveDayChanges()}
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
          <Text style={styles.saveButtonText}>{t('common.save')}</Text>
        </Pressable>
      </View>
    </View>
  );

  if (day.isOffDay) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: day.name }} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {daySummaryRow}
          {dayEditor}
          <View style={styles.restDayContainer}>
            <Ionicons name="moon-outline" size={32} color={colors.textTertiary} />
            <Text style={styles.restDayEyebrow}>
              {getWeekdayLabel(day.scheduledWeekday, locale).toLocaleUpperCase(locale)}
            </Text>
            <Text style={styles.restDayTitle}>
              {isScheduledToday && isActiveProgram
                ? t('day.restDayToday')
                : t('day.restDayOther', { weekday: getWeekdayLabel(day.scheduledWeekday, locale) })}
            </Text>
            <Text style={styles.restDayBody}>
              {isScheduledToday && isActiveProgram
                ? t('day.restDayTodayBody')
                : isActiveProgram
                  ? t('day.restDayActiveBody')
                  : t('day.restDayInactiveBody')}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={isPlanMode ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen
        options={
          isPlanMode
            ? { headerRight: () => dayHeaderButton, headerShown: true, title: day.name }
            : { headerShown: false }
        }
      />
      <View style={styles.workoutScreen}>
      {!isPlanMode && (
        <>
          <View style={styles.workoutTopBar}>
            <Pressable
              accessibilityLabel={t('common.back')}
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.topBarButton, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>

            <Pressable
              accessibilityHint={t('a11y.toggleTimer')}
              accessibilityLabel={t('day.setsProgress', {
                completed: totalCompletedSets,
                total: totalTargetSets,
              })}
              accessibilityRole="button"
              disabled={!workoutSession || isWorkoutActionPending}
              onPress={() => void handleWorkoutToggle()}
              style={({ pressed }) => [styles.topBarCenter, pressed && styles.pressed]}>
              <Text style={styles.topBarStatus}>
                {t('day.setsProgress', { completed: totalCompletedSets, total: totalTargetSets })} ·{' '}
                {formatDuration(elapsedSeconds)}
                {workoutSession?.status === 'paused' ? ` · ${t('day.resumeWorkout')}` : ''}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={isWorkoutActionPending || !workoutSession}
              hitSlop={8}
              onPress={handleFinishWorkout}
              style={({ pressed }) => [styles.topBarButton, pressed && styles.pressed]}>
              <Text style={styles.topBarFinish}>{t('day.finish')}</Text>
            </Pressable>
          </View>

          <View style={styles.topBarProgressTrack}>
            <View
              style={[
                styles.topBarProgressFill,
                { width: `${totalTargetSets ? (totalCompletedSets / totalTargetSets) * 100 : 0}%` },
              ]}
            />
          </View>
        </>
      )}
      <ProgramDetailScroll
        contentContainerStyle={[styles.content, restTimerEnabled && restTimer && styles.contentWithRestTimer]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {daySummaryRow}
        {dayEditor}

        {editingExerciseId && (
          <View style={styles.editor}>
            <Text style={styles.editorTitle}>{t('day.editExercise')}</Text>
            <Text style={styles.editorSubtitle}>{editingExerciseName}</Text>

            <View style={styles.targetFields}>
              <ExerciseTargetInput
                colors={colors}
                label={t('day.sets')}
                onChangeText={setTargetSetsDraft}
                value={targetSetsDraft}
              />
              <ExerciseTargetInput
                colors={colors}
                keyboardType="default"
                label={t('day.reps')}
                onChangeText={setTargetRepsDraft}
                value={targetRepsDraft}
              />
              <ExerciseTargetInput
                colors={colors}
                label={t('day.rest')}
                onChangeText={setRestSecondsDraft}
                value={restSecondsDraft}
              />
            </View>

            <WorkoutVisualPicker onSelect={setExerciseVisualDraft} selectedVisual={exerciseVisualDraft} />

            <View style={styles.editorActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditingExerciseId(null)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void saveExerciseChanges()}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
                <Text style={styles.saveButtonText}>{t('common.save')}</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={confirmRemoveExercise}
              style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}>
              <Text style={styles.removeButtonText}>{t('day.removeExercise')}</Text>
            </Pressable>
          </View>
        )}

        {isPlanMode ? (
          <>
            {day.exercises.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="barbell-outline" size={30} color={colors.textTertiary} />
                <Text style={styles.emptyTitle}>{t('day.emptyTitle')}</Text>
                <Text style={styles.emptyDescription}>{t('day.emptyBody')}</Text>
              </View>
            ) : (
              <ProgramExerciseList
                exercises={day.exercises}
                onEdit={openExerciseEditor}
                onRemove={() => undefined}
                onReorder={(exercises) => {
                  void reorderExercisesInDay(selectedProgramId, selectedDayId, exercises).catch((error) =>
                    showWorkoutError(t('day.exerciseReorderFailed'), error, t),
                  );
                }}
              />
            )}

            {!canTrackToday && (
              <View style={styles.scheduleNotice}>
                <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                <View style={styles.scheduleNoticeText}>
                  <Text style={styles.scheduleNoticeTitle}>
                    {isActiveProgram ? t('day.notScheduledTitle') : t('day.notActiveProgramTitle')}
                  </Text>
                  <Text style={styles.scheduleNoticeBody}>
                    {isActiveProgram
                      ? t('day.notScheduledBody', { weekday: getWeekdayLabel(day.scheduledWeekday, locale) })
                      : t('day.notActiveProgramBody')}
                  </Text>
                </View>
              </View>
            )}

            {canTrackToday && day.exercises.length > 0 && (
              <Pressable
                accessibilityRole="button"
                disabled={isWorkoutActionPending}
                onPress={() => void handleWorkoutToggle()}
                style={({ pressed }) => [styles.startWorkoutButton, pressed && styles.pressed]}>
                {isWorkoutActionPending ? (
                  <ActivityIndicator color={colors.background} size="small" />
                ) : (
                  <Ionicons name="play" size={16} color={colors.background} />
                )}
                <Text style={styles.startWorkoutText}>{t('day.startWorkout')}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            {!canTrackToday && (
              <View style={styles.scheduleNotice}>
                <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                <View style={styles.scheduleNoticeText}>
                  <Text style={styles.scheduleNoticeTitle}>
                    {isActiveProgram ? t('day.notScheduledTitle') : t('day.notActiveProgramTitle')}
                  </Text>
                  <Text style={styles.scheduleNoticeBody}>
                    {isActiveProgram
                      ? t('day.notScheduledBody', { weekday: getWeekdayLabel(day.scheduledWeekday, locale) })
                      : t('day.notActiveProgramBody')}
                  </Text>
                </View>
              </View>
            )}

            {isWorkoutComplete && (
              <View style={styles.successCard}>
                <Ionicons name="checkmark-circle" size={20} color={colors.disciplineCompleted} />
                <View style={styles.successText}>
                  <Text style={styles.successTitle}>{t('day.allSetsDone')}</Text>
                  <Text style={styles.successBody}>{t('day.allSetsDoneBody')}</Text>
                </View>
              </View>
            )}

            {activeExercise && (
              <View style={styles.activeSetBlock}>
                <Text style={styles.activeSetLabel}>
                  {t('day.setOfTotal', {
                    current: Math.min(activeCompletedSets + 1, activeExercise.targetSets),
                    total: activeExercise.targetSets,
                  })}
                </Text>
                <Text numberOfLines={2} style={styles.activeExerciseName}>
                  {activeExerciseName}
                </Text>

                <View style={styles.activeValues}>
                  <View style={styles.valueGroup}>
                    <TextInput
                      accessibilityLabel={t('day.kg')}
                      editable={canCompleteSets && !pendingExerciseId}
                      keyboardType="decimal-pad"
                      maxLength={8}
                      onChangeText={setWeightInput}
                      placeholder="—"
                      placeholderTextColor={colors.textTertiary}
                      selectTextOnFocus
                      style={styles.valueInput}
                      value={weightInput}
                    />
                    <Text style={styles.valueUnit}>{t('day.kgUnit')}</Text>
                  </View>
                  <View style={styles.valueGroup}>
                    <TextInput
                      accessibilityLabel={t('day.repsShort')}
                      editable={canCompleteSets && !pendingExerciseId}
                      keyboardType="number-pad"
                      maxLength={5}
                      onChangeText={setRepetitionsInput}
                      placeholder={activeExercise.targetReps}
                      placeholderTextColor={colors.textTertiary}
                      selectTextOnFocus
                      style={styles.valueInput}
                      value={repetitionsInput}
                    />
                    <Text style={styles.valueUnit}>{t('day.repsUnit')}</Text>
                  </View>
                </View>

                {validationError && <Text style={styles.validationError}>{validationError}</Text>}

                <Pressable
                  accessibilityLabel={t('day.completeSetLabel', { name: activeExerciseName })}
                  accessibilityRole="button"
                  disabled={!canCompleteSets || Boolean(pendingExerciseId) || isActiveExerciseComplete}
                  onPress={() => void submitActiveSet()}
                  style={({ pressed }) => [
                    styles.completeSetPill,
                    (!canCompleteSets || Boolean(pendingExerciseId) || isActiveExerciseComplete) &&
                      styles.completeSetPillDisabled,
                    pressed && styles.pressed,
                  ]}>
                  {pendingExerciseId === activeExercise.id ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Text style={styles.completeSetPillText}>
                      {isActiveExerciseComplete
                        ? t('day.completed')
                        : canCompleteSets
                          ? t('day.completeSet')
                          : !workoutSession
                            ? t('day.startFirst')
                            : workoutSession.status === 'paused'
                              ? t('day.workoutPaused')
                              : t('day.availableOnScheduledDay')}
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isSetDetailsOpen }}
                  hitSlop={8}
                  onPress={() => setIsSetDetailsOpen((current) => !current)}
                  style={({ pressed }) => [styles.detailsToggle, pressed && styles.pressed]}>
                  <Text style={styles.detailsToggleText}>{t('day.details')}</Text>
                  <Ionicons
                    name={isSetDetailsOpen ? 'chevron-up' : 'chevron-down'}
                    size={13}
                    color={colors.textSecondary}
                  />
                </Pressable>

                {isSetDetailsOpen && (
                  <View style={styles.detailsArea}>
                    {activePreviousSet && (
                      <Text style={styles.previousSetText}>
                        {t('day.previousSet', { value: formatSetPerformance(activePreviousSet, t, locale) })}
                      </Text>
                    )}

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{t('day.rpe')}</Text>
                      <TextInput
                        accessibilityLabel={t('day.rpe')}
                        editable={canCompleteSets && !pendingExerciseId}
                        keyboardType="decimal-pad"
                        maxLength={4}
                        onChangeText={setRpeInput}
                        placeholder={t('day.optional')}
                        placeholderTextColor={colors.textTertiary}
                        style={styles.detailInput}
                        value={rpeInput}
                      />
                    </View>

                    {activeSetRecords.length > 0 && (
                      <View style={styles.completedSetList}>
                        {activeSetRecords.map((workoutSet) => (
                          <View key={workoutSet.id} style={styles.completedSetRow}>
                            <Text style={styles.completedSetNumberText}>
                              {t('day.setLabel', { number: workoutSet.setNumber })}
                            </Text>
                            <Text style={styles.completedSetValue}>
                              {workoutSet.weightKg === undefined
                                ? t('day.bodyweightLabel')
                                : `${formatDecimal(workoutSet.weightKg, locale)} kg`}
                            </Text>
                            <Text style={styles.completedSetValue}>
                              {workoutSet.repetitions === undefined
                                ? t('day.noDetail')
                                : t('day.repsValue', { count: workoutSet.repetitions })}
                            </Text>
                            {workoutSet.rpe !== undefined && (
                              <Text style={styles.completedSetRpe}>
                                RPE {formatDecimal(workoutSet.rpe, locale)}
                              </Text>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={styles.detailActions}>
                      {activeCompletedSets > 0 && canCompleteSets && (
                        <Pressable
                          accessibilityLabel={t('day.undoSetLabel', { name: activeExerciseName })}
                          accessibilityRole="button"
                          disabled={Boolean(pendingExerciseId)}
                          onPress={() => void handleUndoSet(activeExercise)}
                          style={({ pressed }) => [styles.detailButton, pressed && styles.pressed]}>
                          <Ionicons name="arrow-undo-outline" size={14} color={colors.text} />
                          <Text style={styles.detailButtonText}>{t('day.setLabel', { number: activeCompletedSets })}</Text>
                        </Pressable>
                      )}
                      {hasProgress && canTrackToday && (
                        <Pressable
                          accessibilityRole="button"
                          disabled={isWorkoutActionPending}
                          onPress={() => void handleResetSets()}
                          style={({ pressed }) => [styles.detailButton, pressed && styles.pressed]}>
                          <Text style={styles.resetButtonText}>{t('day.reset')}</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            {averageDurationSeconds !== undefined && (
              <Text style={styles.averageDuration}>
                {t('day.averageDuration', { duration: formatDuration(averageDurationSeconds) })}
              </Text>
            )}

            <View style={styles.allExercisesPanel}>
              <View style={styles.panelGrabber} />
              <Text style={styles.panelTitle}>{t('day.allExercises')}</Text>

              {day.exercises.map((exercise) => {
                const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
                const completedSets = Math.min(
                  completedSetCounts[getSetProgressKey(todayKey, exercise.id)] ?? 0,
                  exercise.targetSets,
                );
                const isComplete = completedSets >= exercise.targetSets;
                const isActive = exercise.id === activeExercise?.id;

                return (
                  <Pressable
                    accessibilityLabel={t('a11y.selectExercise', { name: exerciseName })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    key={exercise.id}
                    onPress={() => setSelectedExerciseId(exercise.id)}
                    style={({ pressed }) => [styles.panelRow, pressed && styles.pressed]}>
                    <View style={styles.panelMarker}>
                      {isActive && <Ionicons name="caret-forward" size={11} color={colors.primary} />}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.panelExerciseName,
                        isActive && styles.panelExerciseNameActive,
                        isComplete && styles.panelExerciseNameComplete,
                      ]}>
                      {exerciseName}
                    </Text>
                    <Text style={[styles.panelSetCount, isComplete && styles.panelSetCountComplete]}>
                      {completedSets}/{exercise.targetSets}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ProgramDetailScroll>
      {restTimerEnabled && restTimer && restProgress && (
        <View
          accessibilityLabel={
            restProgress.isOvertime
              ? t('rest.accessibilityOvertime', { seconds: restProgress.overtimeSeconds })
              : t('rest.accessibilityRemaining', {
                  name: restTimer.exerciseName,
                  seconds: restProgress.remainingSeconds,
                })
          }
          accessibilityRole="timer"
          style={[styles.restTimerCard, restProgress.isOvertime && styles.restTimerCardFinished]}>
          <View style={styles.restTimerIcon}>
            <Ionicons
              name={restProgress.isOvertime ? 'notifications' : 'timer-outline'}
              size={20}
              color={restProgress.isOvertime ? colors.accent : colors.textSecondary}
            />
          </View>
          <View style={styles.restTimerText}>
            <Text style={styles.restTimerTitle}>
              {restProgress.isOvertime
                ? t('rest.finishedTitle')
                : t('rest.title', { name: restTimer.exerciseName })}
            </Text>
            <Text style={styles.restTimerCaption}>
              {restProgress.isOvertime
                ? t('rest.overtimeCaption', { overtime: formatDuration(restProgress.overtimeSeconds) })
                : t('rest.caption')}
            </Text>
          </View>
          <Text style={[styles.restTimerValue, restProgress.isOvertime && styles.restTimerValueOvertime]}>
            {formatRestTimerValue(restProgress)}
          </Text>
          <Pressable
            accessibilityLabel={t('rest.dismiss')}
            accessibilityRole="button"
            onPress={() => void clearRestTimer()}
            style={({ pressed }) => [styles.dismissRestTimer, pressed && styles.pressed]}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}
      </View>
    </SafeAreaView>
  );
}

function showWorkoutError(title: string, error: unknown, t: (key: string) => string) {
  Alert.alert(title, error instanceof Error ? error.message : t('common.networkError'));
}

function ExerciseTargetInput({
  colors,
  keyboardType = 'number-pad',
  label,
  onChangeText,
  value,
}: {
  colors: ThemeColors;
  keyboardType?: 'number-pad' | 'default';
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.targetField}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        keyboardType={keyboardType}
        maxLength={5}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function getFirstTargetRepetition(targetReps: string) {
  const match = targetReps.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function parseNumberInput(value: string) {
  const normalizedValue = value.trim().replace(',', '.');
  if (!normalizedValue) return undefined;
  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function parseOptionalNumberInput(value: string) {
  if (!value.trim()) return undefined;
  const parsedValue = parseNumberInput(value);
  return parsedValue === undefined ? null : parsedValue;
}

function formatDecimal(value: number, locale: string) {
  return value.toLocaleString(locale, { maximumFractionDigits: 2 });
}

function formatSetPerformance(
  workoutSet: WorkoutSetRecord,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
) {
  const parts = [
    workoutSet.weightKg === undefined ? t('day.bodyweight') : `${formatDecimal(workoutSet.weightKg, locale)} kg`,
    workoutSet.repetitions === undefined ? undefined : t('day.repsValue', { count: workoutSet.repetitions }),
    workoutSet.rpe === undefined ? undefined : `RPE ${formatDecimal(workoutSet.rpe, locale)}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    activeSetBlock: { alignItems: 'center', gap: 10, paddingTop: 18 },
    activeSetLabel: { color: colors.primary, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
    activeExerciseName: { color: colors.text, fontSize: 24, fontWeight: '600', textAlign: 'center' },
    activeValues: { alignItems: 'baseline', flexDirection: 'row', gap: 20, marginTop: 6 },
    valueGroup: { alignItems: 'baseline', flexDirection: 'row', gap: 4 },
    valueInput: {
      color: colors.text,
      fontSize: 38,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
      minWidth: 62,
      paddingVertical: 4,
      textAlign: 'center',
    },
    valueUnit: { color: colors.textSecondary, fontSize: 13 },
    completeSetPill: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: colors.text,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 52,
      minWidth: 200,
      paddingHorizontal: 32,
    },
    completeSetPillDisabled: { backgroundColor: colors.surfaceMuted },
    completeSetPillText: { color: colors.background, fontSize: 16, fontWeight: '600' },
    detailsToggle: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 5,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
    },
    detailsToggleText: { color: colors.textSecondary, fontSize: 13 },
    detailsArea: { alignSelf: 'stretch', gap: 12 },
    detailRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    detailLabel: { color: colors.textSecondary, fontSize: 13, width: 46 },
    detailInput: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusSmall,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      flex: 1,
      fontSize: 15,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 12,
    },
    detailActions: { flexDirection: 'row', gap: 10 },
    detailButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 16,
    },
    detailButtonText: { color: colors.text, fontSize: 13 },
    allExercisesPanel: {
      backgroundColor: colors.card,
      borderColor: colors.separator,
      borderRadius: Layout.radiusLarge,
      borderWidth: StyleSheet.hairlineWidth,
      marginTop: 22,
      paddingBottom: 6,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    panelGrabber: {
      alignSelf: 'center',
      backgroundColor: colors.textTertiary,
      borderRadius: 2,
      height: 3,
      marginBottom: 12,
      width: 34,
    },
    panelTitle: { color: colors.textSecondary, ...Type.eyebrow, marginBottom: 4 },
    panelRow: {
      alignItems: 'center',
      borderTopColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      minHeight: Layout.minTouchSize,
    },
    panelMarker: { alignItems: 'center', width: 12 },
    panelExerciseName: { color: colors.textSecondary, flex: 1, fontSize: 15 },
    panelExerciseNameActive: { color: colors.text, fontWeight: '500' },
    panelExerciseNameComplete: { color: colors.disciplineCompleted },
    panelSetCount: { color: colors.textTertiary, fontSize: 13, fontVariant: ['tabular-nums'] },
    panelSetCountComplete: { color: colors.disciplineCompleted },
    workoutTopBar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 10,
    },
    topBarButton: { alignItems: 'center', height: Layout.minTouchSize, justifyContent: 'center', width: Layout.minTouchSize },
    topBarCenter: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: Layout.minTouchSize },
    topBarStatus: { color: colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
    topBarFinish: { color: colors.primary, fontSize: 16, fontWeight: '500' },
    topBarProgressTrack: { backgroundColor: colors.surfaceMuted, height: 2, marginHorizontal: Layout.screenPadding },
    topBarProgressFill: { backgroundColor: colors.text, height: '100%' },
    safeArea: { backgroundColor: colors.background, flex: 1 },
    workoutScreen: { flex: 1 },
    content: { gap: 18, paddingBottom: 44, paddingHorizontal: Layout.screenPadding, paddingTop: 12 },
    contentWithRestTimer: { paddingBottom: 120 },
    notFound: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 30 },
    notFoundTitle: { color: colors.text, fontSize: 17, fontWeight: '500', textAlign: 'center' },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },

    headerButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
    summaryRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: Layout.minTouchSize,
    },
    summaryText: { color: colors.textSecondary, ...Type.caption, flexShrink: 1 },
    controlsRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    controlGroup: { flexDirection: 'row', gap: 8 },
    controlButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusSmall,
      height: 36,
      justifyContent: 'center',
      width: 40,
    },
    controlButtonDisabled: { opacity: 0.35 },
    addExerciseButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: 18,
    },
    addExerciseText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },

    editor: {
      borderColor: colors.separator,
      borderRadius: Layout.radiusLarge,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 14,
      padding: 16,
    },
    editorTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    editorSubtitle: { color: colors.textSecondary, ...Type.caption, marginTop: -8 },
    field: { gap: 8 },
    label: { color: colors.textSecondary, fontSize: 13 },
    caption: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: 46,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    targetFields: { flexDirection: 'row', gap: 10 },
    targetField: { flex: 1, gap: 6 },
    weekdayOptions: { gap: 8 },
    weekdayOption: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: 14,
    },
    weekdayOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    weekdayOptionDisabled: { opacity: 0.3 },
    weekdayOptionText: { color: colors.textSecondary, fontSize: 13 },
    weekdayOptionTextSelected: { color: colors.onPrimary, fontWeight: '500' },
    switchRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    switchText: { flex: 1, gap: 2 },
    editorActions: { flexDirection: 'row', gap: 10 },
    secondaryButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 20,
    },
    secondaryButtonText: { color: colors.text, fontSize: 15 },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      flex: 1,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
    },
    saveButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
    removeButton: { alignItems: 'center', justifyContent: 'center', minHeight: 36 },
    removeButtonText: { color: colors.danger, fontSize: 14, fontWeight: '500' },

    startWorkoutButton: {
      alignItems: 'center',
      alignSelf: 'stretch',
      backgroundColor: colors.text,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    startWorkoutText: { color: colors.background, fontSize: 15, fontWeight: '600' },

    workoutHeader: { gap: 12 },
    progressTextRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    progressLabel: { color: colors.textSecondary, ...Type.caption },
    progressValue: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '500' },
    progressTrack: { backgroundColor: colors.surfaceMuted, borderRadius: 2, height: 3, overflow: 'hidden' },
    progressFill: { backgroundColor: colors.primary, borderRadius: 2, height: '100%' },
    workoutControls: { alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 4 },
    workoutToggleButton: {
      alignItems: 'center',
      backgroundColor: colors.text,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    workoutPauseButton: { backgroundColor: colors.surfaceMuted },
    workoutButtonDisabled: { opacity: 0.4 },
    workoutToggleText: { color: colors.background, fontSize: 15, fontWeight: '600' },
    workoutStopwatch: { flex: 1 },
    workoutStopwatchText: {
      color: colors.text,
      fontSize: 22,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
    },
    averageDuration: { color: colors.textTertiary, ...Type.footnote, marginTop: 18, textAlign: 'center' },
    finishWorkoutButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 6,
      minHeight: 36,
    },
    finishWorkoutText: { color: colors.textSecondary, fontSize: 13 },

    scheduleNotice: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
    scheduleNoticeText: { flex: 1, gap: 2 },
    scheduleNoticeTitle: { color: colors.text, fontSize: 14, fontWeight: '500' },
    scheduleNoticeBody: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    successCard: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
    successText: { flex: 1, gap: 2 },
    successTitle: { color: colors.text, fontSize: 14, fontWeight: '500' },
    successBody: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },

    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    sectionTitle: { color: colors.text, ...Type.sectionTitle },
    sectionSubtitle: { color: colors.textSecondary, ...Type.caption },
    resetButton: { alignItems: 'center', justifyContent: 'center', minHeight: 32 },
    resetButtonText: { color: colors.danger, fontSize: 14 },
    emptyState: { alignItems: 'center', gap: 8, paddingVertical: 34 },
    emptyIcon: { alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '500' },
    emptyDescription: {
      color: colors.textSecondary,
      ...Type.caption,
      lineHeight: 19,
      paddingHorizontal: 20,
      textAlign: 'center',
    },
    exerciseList: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },

    exerciseCard: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      gap: 12,
      paddingVertical: 16,
    },
    exerciseCardCurrent: {},
    exerciseCardComplete: { opacity: 0.65 },
    exerciseHeader: { alignItems: 'center', flexDirection: 'row', gap: 14 },
    exerciseVisual: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: Layout.radiusSmall,
      height: 34,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 34,
    },
    exerciseVisualComplete: { backgroundColor: colors.disciplineCompleted },
    exerciseText: { flex: 1, gap: 3 },
    exerciseOrder: { color: colors.textTertiary, ...Type.eyebrow },
    exerciseName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    exerciseTarget: { color: colors.textSecondary, ...Type.caption },
    exerciseProgressTrack: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 2,
      height: 3,
      overflow: 'hidden',
    },
    exerciseProgressFill: { backgroundColor: colors.primary, borderRadius: 2, height: '100%' },
    exerciseProgressFillComplete: { backgroundColor: colors.disciplineCompleted },
    completedSetList: { gap: 6 },
    completedSetRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    completedSetNumber: { alignItems: 'center', flexDirection: 'row', gap: 4, width: 62 },
    completedSetNumberText: { color: colors.textTertiary, fontSize: 10, fontWeight: '600' },
    completedSetValue: { color: colors.textSecondary, fontSize: 12 },
    completedSetRpe: { color: colors.textTertiary, fontSize: 11 },
    setEntryArea: { gap: 10 },
    nextSetRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    nextSetTitle: { color: colors.text, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
    previousSetText: { color: colors.textTertiary, flex: 1, fontSize: 11 },
    setInputRow: { flexDirection: 'row', gap: 10 },
    setInputGroup: { flex: 1, gap: 6 },
    setInputLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
    setInput: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusSmall,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: 44,
      paddingHorizontal: 12,
      textAlign: 'center',
    },
    setInputDisabled: { opacity: 0.45 },
    validationError: { color: colors.danger, fontSize: 12 },
    setControls: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    setCountArea: { alignItems: 'baseline', flexDirection: 'row', flex: 1 },
    setCount: { color: colors.text, fontSize: 18, fontWeight: '500' },
    setCountComplete: { color: colors.disciplineCompleted },
    setTarget: { color: colors.textSecondary, fontSize: 13 },
    undoButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    completeSetButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 18,
    },
    completeSetButtonDone: { backgroundColor: colors.disciplineCompleted },
    completeSetButtonDisabled: { backgroundColor: colors.surfaceMuted },
    completeSetButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },

    restDayContainer: { alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 40 },
    restDayIcon: { alignItems: 'center', justifyContent: 'center' },
    restDayEyebrow: { color: colors.textTertiary, ...Type.eyebrow, marginTop: 4 },
    restDayTitle: { color: colors.text, fontSize: 19, fontWeight: '500', textAlign: 'center' },
    restDayBody: {
      color: colors.textSecondary,
      ...Type.caption,
      lineHeight: 19,
      textAlign: 'center',
    },

    restTimerCard: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: Layout.radiusLarge,
      bottom: 16,
      flexDirection: 'row',
      gap: 12,
      left: Layout.screenPadding,
      padding: 14,
      position: 'absolute',
      right: Layout.screenPadding,
    },
    restTimerCardFinished: { backgroundColor: colors.surfaceMuted },
    restTimerIcon: { alignItems: 'center', justifyContent: 'center' },
    restTimerText: { flex: 1, gap: 2 },
    restTimerTitle: { color: colors.text, fontSize: 14, fontWeight: '500' },
    restTimerCaption: { color: colors.textSecondary, ...Type.footnote },
    restTimerValue: {
      color: colors.text,
      fontSize: 20,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
    },
    restTimerValueOvertime: { color: colors.accent, fontWeight: '500' },
    dismissRestTimer: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
    pressed: { opacity: 0.6 },
  });
}
