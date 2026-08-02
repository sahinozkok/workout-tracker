import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { ThemeColors } from '@/constants/theme';
import { getWeekdayLabel } from '@/constants/weekdays';
import { useProfile } from '@/context/profile-context';
import { useWorkout } from '@/context/workout-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ProgramExercise } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';
import { cancelRestNotification, scheduleRestNotification } from '@/utils/rest-notifications';
import { getSetProgressKey } from '@/utils/workout-schedule';
import { formatDuration, getWorkoutDurationSeconds } from '@/utils/workout-session';
import { getDayVisual, getExerciseVisual } from '@/utils/workout-visual';

export default function WorkoutDayScreen() {
  const { id, dayId } = useLocalSearchParams<{ id: string; dayId: string }>();
  const {
    completeSet,
    completedSetCounts,
    activeProgramId,
    finishWorkout,
    pauseWorkout,
    programs,
    resetCompletedSets,
    resumeWorkout,
    startWorkout,
    undoCompletedSet,
    workoutSessions,
  } = useWorkout();
  const { restTimerEnabled } = useProfile();
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const program = programs.find((item) => item.id === id);
  const day = program?.days.find((item) => item.id === dayId);
  const today = new Date();
  const todayKey = toDateKey(today);
  const workoutSession = workoutSessions.find(
    (session) =>
      session.programId === id &&
      session.dayId === dayId &&
      session.dateKey === todayKey &&
      session.status !== 'completed',
  );
  const [clockNow, setClockNow] = useState(Date.now());
  const [restTimer, setRestTimer] = useState<{ endsAt: number; exerciseName: string }>();

  useEffect(() => {
    if (workoutSession?.status !== 'running' && !restTimer) return;

    setClockNow(Date.now());
    const interval = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [restTimer, workoutSession?.status]);

  if (!program || !day) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Gün bulunamadı' }} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={42} color={colors.textTertiary} />
          <Text style={styles.notFoundTitle}>Program veya antrenman günü bulunamadı.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/programs')}
            style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Programlara dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const selectedProgramId = program.id;
  const selectedDayId = day.id;
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
  const isWorkoutComplete = totalTargetSets > 0 && totalCompletedSets === totalTargetSets;
  const hasProgress = totalCompletedSets > 0;
  const elapsedSeconds = workoutSession ? getWorkoutDurationSeconds(workoutSession, clockNow) : 0;
  const restSecondsRemaining = restTimer ? Math.max(0, Math.ceil((restTimer.endsAt - clockNow) / 1000)) : 0;
  const canCompleteSets = canTrackToday && workoutSession?.status === 'running';

  async function clearRestTimer() {
    setRestTimer(undefined);
    await cancelRestNotification();
  }

  function handleWorkoutToggle() {
    if (!workoutSession) {
      startWorkout(selectedProgramId, selectedDayId, todayKey);
      return;
    }

    if (workoutSession.status === 'running') {
      pauseWorkout(workoutSession.id);
      void clearRestTimer();
      return;
    }

    resumeWorkout(workoutSession.id);
  }

  function handleFinishWorkout() {
    if (!workoutSession) return;

    Alert.alert('Antrenmanı bitir', 'Süre geçmişe kaydedilecek. Antrenmanı bitirmek istiyor musun?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Bitir',
        onPress: () => {
          finishWorkout(workoutSession.id);
          void clearRestTimer();
        },
      },
    ]);
  }

  function handleCompleteSet(exercise: ProgramExercise) {
    completeSet(todayKey, exercise.id, exercise.targetSets);

    const completesWholeWorkout = totalCompletedSets + 1 >= totalTargetSets;
    if (!restTimerEnabled || exercise.restSeconds <= 0 || completesWholeWorkout) return;

    const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
    setRestTimer({ endsAt: Date.now() + exercise.restSeconds * 1000, exerciseName });
    void scheduleRestNotification(exerciseName, exercise.restSeconds);
  }

  if (day.isOffDay) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: day.name }} />
        <View style={styles.restDayContainer}>
          <View style={styles.restDayIcon}>
            <Ionicons name="moon-outline" size={46} color={colors.primaryIcon} />
          </View>
          <Text style={styles.restDayEyebrow}>{getWeekdayLabel(day.scheduledWeekday).toLocaleUpperCase('tr-TR')}</Text>
          <Text style={styles.restDayTitle}>
            {isScheduledToday && isActiveProgram
              ? 'Bugün dinlenme günü'
              : `${getWeekdayLabel(day.scheduledWeekday)} dinlenme günü`}
          </Text>
          <Text style={styles.restDayBody}>
            {isScheduledToday && isActiveProgram
              ? 'Disiplin takviminde bugün otomatik olarak tamamlandı görünür. Dinlenmek de programın bir parçası.'
              : isActiveProgram
                ? 'Bu Off day planlanan tarihe geldiğinde disiplin takviminde otomatik olarak tamamlandı görünür.'
                : 'Bu program aktif değil. Off day yalnızca program aktifken disiplin takvimini etkiler.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: day.name }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.dayVisual}>
              <WorkoutVisualDisplay
                color={colors.accentText}
                size={36}
                visual={getDayVisual(day.visual, dayIndex)}
              />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.eyebrow}>
                {today.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }).toLocaleUpperCase('tr-TR')}
              </Text>
              <Text style={styles.dayName}>{day.name}</Text>
              <Text style={styles.programName}>
                {program.name} · {getWeekdayLabel(day.scheduledWeekday)}
              </Text>
            </View>
          </View>

          <View style={styles.overallProgress}>
            <View style={styles.progressTextRow}>
              <Text style={styles.progressLabel}>Toplam ilerleme</Text>
              <Text style={styles.progressValue}>
                {totalCompletedSets}/{totalTargetSets} set
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${totalTargetSets ? (totalCompletedSets / totalTargetSets) * 100 : 0}%` },
                ]}
              />
            </View>
          </View>

          <View style={styles.workoutControls}>
            <Pressable
              accessibilityRole="button"
              disabled={!canTrackToday || day.exercises.length === 0}
              onPress={handleWorkoutToggle}
              style={({ pressed }) => [
                styles.workoutToggleButton,
                workoutSession?.status === 'running' && styles.workoutPauseButton,
                (!canTrackToday || day.exercises.length === 0) && styles.workoutButtonDisabled,
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name={
                  !workoutSession ? 'play' : workoutSession.status === 'running' ? 'pause' : 'play-forward'
                }
                size={18}
                color={colors.onPrimary}
              />
              <Text style={styles.workoutToggleText}>
                {!workoutSession
                  ? 'Programı başlat'
                  : workoutSession.status === 'running'
                    ? 'Programı durdur'
                    : 'Devam ettir'}
              </Text>
            </Pressable>

            <View style={styles.workoutStopwatch}>
              <Ionicons name="stopwatch-outline" size={16} color={colors.heroText} />
              <Text style={styles.workoutStopwatchText}>{formatDuration(elapsedSeconds)}</Text>
            </View>
          </View>

          {workoutSession && (
            <Pressable
              accessibilityRole="button"
              onPress={handleFinishWorkout}
              style={({ pressed }) => [styles.finishWorkoutButton, pressed && styles.pressed]}>
              <Ionicons name="flag-outline" size={15} color={colors.heroText} />
              <Text style={styles.finishWorkoutText}>Antrenmanı bitir ve süreyi kaydet</Text>
            </Pressable>
          )}
        </View>

        {!canTrackToday && (
          <View style={styles.scheduleNotice}>
            <Ionicons name="calendar-outline" size={22} color={colors.accent} />
            <View style={styles.scheduleNoticeText}>
              <Text style={styles.scheduleNoticeTitle}>
                {isActiveProgram ? 'Bu antrenman bugün planlı değil' : 'Bu program aktif değil'}
              </Text>
              <Text style={styles.scheduleNoticeBody}>
                {isActiveProgram
                  ? `Set takibi ${getWeekdayLabel(day.scheduledWeekday)} günü kullanılabilir.`
                  : 'Set takibi ve disiplin takvimi yalnızca aktif programa göre çalışır.'}
              </Text>
            </View>
          </View>
        )}

        {restTimerEnabled && restTimer && (
          <View style={[styles.restTimerCard, restSecondsRemaining === 0 && styles.restTimerCardFinished]}>
            <View style={styles.restTimerIcon}>
              <Ionicons
                name={restSecondsRemaining === 0 ? 'notifications' : 'timer-outline'}
                size={21}
                color={restSecondsRemaining === 0 ? colors.disciplineCompleted : colors.accentText}
              />
            </View>
            <View style={styles.restTimerText}>
              <Text style={styles.restTimerTitle}>
                {restSecondsRemaining === 0 ? 'Mola bitti' : `${restTimer.exerciseName} molası`}
              </Text>
              <Text style={styles.restTimerCaption}>
                {restSecondsRemaining === 0 ? 'Sıradaki sete hazırsın.' : 'Set tamamlanınca otomatik başladı.'}
              </Text>
            </View>
            <Text style={styles.restTimerValue}>{formatDuration(restSecondsRemaining)}</Text>
            <Pressable
              accessibilityLabel="Mola sayacını kapat"
              accessibilityRole="button"
              onPress={() => void clearRestTimer()}
              style={({ pressed }) => [styles.dismissRestTimer, pressed && styles.pressed]}>
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {isWorkoutComplete && (
          <View style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={28} color={colors.disciplineCompleted} />
            <View style={styles.successText}>
              <Text style={styles.successTitle}>Günün tüm setleri tamamlandı!</Text>
              <Text style={styles.successBody}>Harika iş. Bütün hedef setleri işaretledin.</Text>
            </View>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Egzersizler</Text>
            <Text style={styles.sectionSubtitle}>Bitirdiğin her setten sonra düğmeye dokun.</Text>
          </View>
          {hasProgress && canTrackToday && (
            <Pressable
              accessibilityRole="button"
              onPress={() => resetCompletedSets(todayKey, day.exercises.map((exercise) => exercise.id))}
              style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}>
              <Ionicons name="refresh-outline" size={16} color={colors.danger} />
              <Text style={styles.resetButtonText}>Sıfırla</Text>
            </Pressable>
          )}
        </View>

        {day.exercises.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="barbell-outline" size={30} color={colors.primaryIcon} />
            </View>
            <Text style={styles.emptyTitle}>Bu gün henüz boş</Text>
            <Text style={styles.emptyDescription}>
              Program detayına dönerek bu güne egzersiz ekleyebilirsin.
            </Text>
          </View>
        ) : (
          <View style={styles.exerciseList}>
            {day.exercises.map((exercise, index) => (
              <ExerciseSetCard
                colors={colors}
                completedSets={Math.min(
                  completedSetCounts[getSetProgressKey(todayKey, exercise.id)] ?? 0,
                  exercise.targetSets,
                )}
                disabled={!canCompleteSets}
                disabledLabel={
                  !canTrackToday
                    ? 'Planlı gününde açılır'
                    : !workoutSession
                      ? 'Önce programı başlat'
                      : workoutSession.status === 'paused'
                        ? 'Program durduruldu'
                        : undefined
                }
                exercise={exercise}
                index={index}
                key={exercise.id}
                onCompleteSet={() => handleCompleteSet(exercise)}
                onUndoSet={() => undoCompletedSet(todayKey, exercise.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ExerciseSetCard({
  colors,
  completedSets,
  disabled,
  disabledLabel,
  exercise,
  index,
  onCompleteSet,
  onUndoSet,
}: {
  colors: ThemeColors;
  completedSets: number;
  disabled: boolean;
  disabledLabel?: string;
  exercise: ProgramExercise;
  index: number;
  onCompleteSet: () => void;
  onUndoSet: () => void;
}) {
  const styles = createStyles(colors);
  const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
  const isComplete = completedSets === exercise.targetSets;
  const progress = exercise.targetSets ? (completedSets / exercise.targetSets) * 100 : 0;

  return (
    <View style={[styles.exerciseCard, isComplete && styles.exerciseCardComplete]}>
      <View style={styles.exerciseHeader}>
        <View style={[styles.exerciseVisual, isComplete && styles.exerciseVisualComplete]}>
          <WorkoutVisualDisplay
            color={isComplete ? colors.onPrimary : colors.accentText}
            size={28}
            visual={getExerciseVisual(exercise.visual)}
          />
        </View>
        <View style={styles.exerciseText}>
          <Text style={styles.exerciseOrder}>{index + 1}. EGZERSİZ</Text>
          <Text style={styles.exerciseName}>{exerciseName}</Text>
          <Text style={styles.exerciseTarget}>
            {exercise.targetSets} set × {exercise.targetReps} tekrar · {exercise.restSeconds} sn dinlenme
          </Text>
        </View>
        {isComplete && <Ionicons name="checkmark-circle" size={25} color={colors.disciplineCompleted} />}
      </View>

      <View style={styles.exerciseProgressTrack}>
        <View
          style={[
            styles.exerciseProgressFill,
            isComplete && styles.exerciseProgressFillComplete,
            { width: `${progress}%` },
          ]}
        />
      </View>

      <View style={styles.setControls}>
        <View style={styles.setCountArea}>
          <Text style={[styles.setCount, isComplete && styles.setCountComplete]}>{completedSets}</Text>
          <Text style={styles.setTarget}> / {exercise.targetSets} set</Text>
        </View>

        {completedSets > 0 && !disabled && (
          <Pressable
            accessibilityLabel={`${exerciseName} için son seti geri al`}
            accessibilityRole="button"
            onPress={onUndoSet}
            style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]}>
            <Ionicons name="remove" size={20} color={colors.textSecondary} />
          </Pressable>
        )}

        <Pressable
          accessibilityLabel={`${exerciseName} setini tamamla`}
          accessibilityRole="button"
          disabled={isComplete || disabled}
          onPress={onCompleteSet}
          style={({ pressed }) => [
            styles.completeSetButton,
            isComplete && styles.completeSetButtonDone,
            disabled && styles.completeSetButtonDisabled,
            pressed && styles.pressed,
          ]}>
          <Ionicons name={isComplete ? 'checkmark' : 'add'} size={20} color={colors.onPrimary} />
          <Text style={styles.completeSetButtonText}>
            {isComplete ? 'Tamamlandı' : disabled ? disabledLabel : 'Set tamamla'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { gap: 18, padding: 20, paddingBottom: 42 },
    notFound: { alignItems: 'center', flex: 1, gap: 15, justifyContent: 'center', padding: 30 },
    notFoundTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    primaryButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 17, paddingVertical: 11 },
    primaryButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
    restDayContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 32,
    },
    restDayIcon: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 42,
      height: 84,
      justifyContent: 'center',
      marginBottom: 20,
      width: 84,
    },
    restDayEyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    restDayTitle: { color: colors.text, fontSize: 26, fontWeight: '900', marginTop: 6, textAlign: 'center' },
    restDayBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },
    heroCard: { backgroundColor: colors.primaryStrong, borderRadius: 22, gap: 18, padding: 20 },
    heroTopRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
    dayVisual: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 16,
      height: 62,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 62,
    },
    heroText: { flex: 1 },
    eyebrow: { color: colors.accentBright, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    dayName: { color: colors.onPrimary, fontSize: 24, fontWeight: '900', marginTop: 2 },
    programName: { color: colors.heroText, fontSize: 13, marginTop: 2 },
    overallProgress: { gap: 8 },
    progressTextRow: { flexDirection: 'row', justifyContent: 'space-between' },
    progressLabel: { color: colors.heroText, fontSize: 12, fontWeight: '700' },
    progressValue: { color: colors.onPrimary, fontSize: 12, fontWeight: '900' },
    progressTrack: { backgroundColor: colors.primarySoftBorder, borderRadius: 999, height: 8, overflow: 'hidden' },
    progressFill: { backgroundColor: colors.accentBright, borderRadius: 999, height: '100%' },
    workoutControls: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    workoutToggleButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 7,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    workoutPauseButton: { backgroundColor: colors.accent },
    workoutButtonDisabled: { opacity: 0.45 },
    workoutToggleText: { color: colors.onPrimary, fontSize: 12, fontWeight: '900' },
    workoutStopwatch: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 5,
      marginLeft: 'auto',
      opacity: 0.82,
    },
    workoutStopwatchText: {
      color: colors.heroText,
      fontSize: 14,
      fontVariant: ['tabular-nums'],
      fontWeight: '800',
    },
    finishWorkoutButton: { alignItems: 'center', flexDirection: 'row', gap: 5, paddingTop: 1 },
    finishWorkoutText: { color: colors.heroText, fontSize: 11, fontWeight: '700' },
    scheduleNotice: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      padding: 13,
    },
    scheduleNoticeText: { flex: 1 },
    scheduleNoticeTitle: { color: colors.accentText, fontSize: 13, fontWeight: '900' },
    scheduleNoticeBody: { color: colors.accentText, fontSize: 11, marginTop: 2 },
    restTimerCard: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      padding: 12,
    },
    restTimerCardFinished: { borderColor: colors.disciplineCompleted },
    restTimerIcon: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      height: 38,
      justifyContent: 'center',
      width: 38,
    },
    restTimerText: { flex: 1 },
    restTimerTitle: { color: colors.text, fontSize: 13, fontWeight: '900' },
    restTimerCaption: { color: colors.textSecondary, fontSize: 10, marginTop: 2 },
    restTimerValue: {
      color: colors.accentText,
      fontSize: 18,
      fontVariant: ['tabular-nums'],
      fontWeight: '900',
    },
    dismissRestTimer: { padding: 4 },
    successCard: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.disciplineCompleted,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 11,
      padding: 14,
    },
    successText: { flex: 1 },
    successTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
    successBody: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
    sectionSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
    resetButton: { alignItems: 'center', flexDirection: 'row', gap: 4, padding: 8 },
    resetButtonText: { color: colors.danger, fontSize: 11, fontWeight: '800' },
    emptyState: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      gap: 9,
      padding: 28,
    },
    emptyIcon: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 24,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
    emptyDescription: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    exerciseList: { gap: 13 },
    exerciseCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      gap: 14,
      padding: 15,
    },
    exerciseCardComplete: { borderColor: colors.disciplineCompleted },
    exerciseHeader: { alignItems: 'center', flexDirection: 'row', gap: 11 },
    exerciseVisual: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 12,
      height: 46,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 46,
    },
    exerciseVisualComplete: { backgroundColor: colors.disciplineCompleted },
    exerciseText: { flex: 1 },
    exerciseOrder: { color: colors.textTertiary, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
    exerciseName: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
    exerciseTarget: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 },
    exerciseProgressTrack: { backgroundColor: colors.surfaceMuted, borderRadius: 999, height: 6, overflow: 'hidden' },
    exerciseProgressFill: { backgroundColor: colors.accentBright, borderRadius: 999, height: '100%' },
    exerciseProgressFillComplete: { backgroundColor: colors.disciplineCompleted },
    setControls: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    setCountArea: { alignItems: 'baseline', flex: 1, flexDirection: 'row' },
    setCount: { color: colors.accent, fontSize: 25, fontWeight: '900' },
    setCountComplete: { color: colors.disciplineCompleted },
    setTarget: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    undoButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    completeSetButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 11,
      flexDirection: 'row',
      gap: 5,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    completeSetButtonDone: { backgroundColor: colors.disciplineCompleted },
    completeSetButtonDisabled: { backgroundColor: colors.disciplineSkipped, opacity: 0.65 },
    completeSetButtonText: { color: colors.onPrimary, fontSize: 12, fontWeight: '900' },
    pressed: { opacity: 0.7 },
  });
}
